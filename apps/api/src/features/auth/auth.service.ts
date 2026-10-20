import { Inject, Injectable } from '@nestjs/common';
import { ChangePasswordRequestSchema, LoginRequestSchema } from '@erp/contracts';
import { highestTier } from '@erp/permissions';
import type { ResetPasswordResponse, SessionResponse } from '@erp/contracts';
import type { Session, User } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { APP_CONFIG } from '../../common/config/config.module.js';
import type { Env } from '../../common/config/env.js';
import {
  BusinessRuleError,
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthenticatedError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import {
  GENERIC_LOGIN_ERROR,
  IP_FAILURE_LIMIT,
  IP_WINDOW_MS,
  LOCKOUT_MS,
  MAX_FAILED_LOGINS,
} from './auth.constants.js';
import type { AuthContext, RequestInfo } from './auth.types.js';
import { canManage } from '../users/user-policy.js';
import { checkPasswordPolicy } from './password-policy.js';
import { PasswordService } from './password.service.js';
import { SessionService } from './session.service.js';
import { csrfTokenFor } from './tokens.js';

export interface IssuedSession {
  token: string;
  maxAgeMs: number;
  response: SessionResponse;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  async login(info: RequestInfo, body: unknown): Promise<IssuedSession> {
    const { username, password } = LoginRequestSchema.parse(body);
    await this.assertIpNotThrottled(info.ipAddress);

    const user = await this.prisma.user.findFirst({
      where: { username: { equals: username, mode: 'insensitive' } },
    });
    const passwordOk = await this.passwords.verify(
      user?.passwordHash ?? (await this.passwords.dummyHash()),
      password,
    );

    if (!user || user.status !== 'ACTIVE') {
      await this.recordLoginFailure(info, user, user ? 'inactive' : 'unknown_user');
      throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
    }
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      await this.audited(info, user.id, (tx) =>
        this.audit.record(tx, {
          action: 'LOGIN_FAILED',
          entityType: 'User',
          entityId: user.id,
          newValue: { reason: 'locked' },
        }),
      );
      const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
      throw new TooManyRequestsError(
        `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      );
    }
    if (!passwordOk) {
      await this.recordLoginFailure(info, user, 'wrong_password');
      throw new UnauthenticatedError(GENERIC_LOGIN_ERROR);
    }

    const issued = await this.audited(info, user.id, async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
      });
      await this.audit.record(tx, { action: 'LOGIN', entityType: 'User', entityId: user.id });
      return this.issueSession(user, info);
    });
    return issued;
  }

  async logout(info: RequestInfo, token: string | undefined): Promise<void> {
    if (!token) return;
    const resolved = await this.sessions.resolve(token, { touch: false });
    if (!resolved) return;
    await this.audited(info, resolved.user.id, async (tx) => {
      await tx.session.updateMany({
        where: { id: resolved.session.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'LOGOUT',
        entityType: 'User',
        entityId: resolved.user.id,
      });
    });
  }

  async currentSession(auth: AuthContext): Promise<SessionResponse> {
    const session = await this.prisma.session.findUniqueOrThrow({ where: { id: auth.sessionId } });
    return this.toResponse(auth, session);
  }

  async changePassword(
    info: RequestInfo,
    auth: AuthContext,
    body: unknown,
  ): Promise<IssuedSession> {
    const { currentPassword, newPassword } = ChangePasswordRequestSchema.parse(body);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: auth.userId } });

    if (!(await this.passwords.verify(user.passwordHash, currentPassword))) {
      await this.recordLoginFailure(info, user, 'wrong_current_password');
      throw new ValidationFailedError('The current password is incorrect', [
        { field: 'currentPassword', message: 'Current password is incorrect' },
      ]);
    }
    const problems = checkPasswordPolicy({
      password: newPassword,
      username: user.username,
      email: user.email,
      currentPassword,
    });
    if (problems.length > 0)
      throw new ValidationFailedError('Choose a stronger password', problems);

    const passwordHash = await this.passwords.hash(newPassword);
    return this.audited(info, user.id, async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'PASSWORD_CHANGED',
        entityType: 'User',
        entityId: user.id,
      });
      return this.issueSession({ ...user, mustChangePassword: false }, info);
    });
  }

  async resetPassword(
    info: RequestInfo,
    actor: AuthContext,
    targetId: string,
  ): Promise<ResetPasswordResponse> {
    if (targetId === actor.userId)
      throw new BusinessRuleError('Use "Change password" for your own account');
    const target = await this.prisma.user.findUnique({
      where: { id: targetId },
      include: { userRoles: { include: { role: true } }, userBranches: true },
    });
    if (!target) throw new NotFoundError('User', targetId);

    const allowed = canManage(
      { userId: actor.userId, tier: actor.tier, branchIds: actor.branchIds },
      {
        userId: target.id,
        tier: highestTier(target.userRoles.map((row) => row.role.tier)),
        branchIds: target.userBranches.map((row) => row.branchId),
      },
    );
    if (!allowed) throw new ForbiddenError();

    const temporaryPassword = this.passwords.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    await this.audited(info, actor.userId, async (tx) => {
      await tx.user.update({
        where: { id: target.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          mustChangePassword: true,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, {
        action: 'PASSWORD_RESET',
        entityType: 'User',
        entityId: target.id,
      });
    });
    return { temporaryPassword };
  }

  private async issueSession(user: User, info: RequestInfo): Promise<IssuedSession> {
    const { token, session } = await this.sessions.create(user.id, info.ipAddress, info.userAgent);
    const auth = await this.sessions.loadAccess(user, session.id);
    return {
      token,
      maxAgeMs: session.expiresAt.getTime() - Date.now(),
      response: this.toResponse(auth, session),
    };
  }

  private toResponse(auth: AuthContext, session: Session): SessionResponse {
    return {
      user: {
        id: auth.userId,
        username: auth.username,
        fullName: auth.fullName,
        email: auth.email,
        roles: auth.roles,
        permissions: auth.permissions,
        branches: auth.branches,
        isSuperAdmin: auth.isSuperAdmin,
        mustChangePassword: auth.mustChangePassword,
      },
      csrfToken: csrfTokenFor(this.env.SESSION_SECRET, session.id),
      expiresAt: session.expiresAt.toISOString(),
    };
  }

  private audited<T>(
    info: RequestInfo,
    actorId: string | null,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    return this.contexts.run({ userId: actorId, branchIds: [], isSuperAdmin: false, ...info }, () =>
      this.transactions.run(fn),
    );
  }

  private async recordLoginFailure(
    info: RequestInfo,
    user: User | null,
    reason: string,
  ): Promise<void> {
    await this.audited(info, user?.id ?? null, async (tx) => {
      if (user) {
        await tx.$queryRaw`
          UPDATE users
          SET failed_login_count = failed_login_count + 1,
              locked_until = CASE WHEN failed_login_count + 1 >= ${MAX_FAILED_LOGINS}
                                  THEN CURRENT_TIMESTAMP + (${LOCKOUT_MS}::int * interval '1 millisecond')
                                  ELSE locked_until END
          WHERE id = ${user.id}::uuid`;
      }
      await this.audit.record(tx, {
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id ?? null,
        newValue: { reason },
      });
    });
  }

  private async assertIpNotThrottled(ipAddress: string | undefined): Promise<void> {
    if (!ipAddress) return;
    const since = new Date(Date.now() - IP_WINDOW_MS);
    const rows = await this.contexts.runAsSystem(() =>
      this.transactions.run(
        (tx) => tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM audit_log
        WHERE action = 'LOGIN_FAILED' AND ip_address = ${ipAddress} AND created_at > ${since}`,
      ),
    );
    if ((rows[0]?.n ?? 0) >= IP_FAILURE_LIMIT) {
      throw new TooManyRequestsError(
        'Too many failed sign-in attempts from this address. Try again later.',
      );
    }
  }
}
