import { Inject, Injectable } from '@nestjs/common';
import { highestTier } from '@erp/permissions';
import type { Session, User } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ABSOLUTE_TIMEOUT_MS, IDLE_TIMEOUT_MS, LAST_SEEN_REFRESH_MS } from './auth.constants.js';
import type { AuthContext } from './auth.types.js';
import { generateSessionToken, hashToken } from './tokens.js';

export interface ResolvedSession {
  session: Session;
  user: User;
}

@Injectable()
export class SessionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async create(
    userId: string,
    ipAddress: string | undefined,
    userAgent: string | undefined,
  ): Promise<{ token: string; session: Session }> {
    const token = generateSessionToken();
    const session = await this.prisma.session.create({
      data: {
        userId,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + ABSOLUTE_TIMEOUT_MS),
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
    return { token, session };
  }

  /** Finds a live session for a cookie token: not revoked, within both timeouts, for an active user. */
  async resolve(token: string, options: { touch?: boolean } = {}): Promise<ResolvedSession | null> {
    const now = Date.now();
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt) return null;
    if (session.expiresAt.getTime() <= now) return null;
    if (session.lastSeenAt.getTime() <= now - IDLE_TIMEOUT_MS) return null;
    if (session.user.status !== 'ACTIVE') return null;
    if (options.touch !== false && session.lastSeenAt.getTime() < now - LAST_SEEN_REFRESH_MS) {
      await this.prisma.session.update({
        where: { id: session.id },
        data: { lastSeenAt: new Date(now) },
      });
    }
    const { user, ...rest } = session;
    return { session: rest, user };
  }

  async loadAccess(user: User, sessionId: string): Promise<AuthContext> {
    const [roleRows, branchRows] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { userId: user.id },
        include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
      }),
      this.prisma.userBranch.findMany({ where: { userId: user.id }, include: { branch: true } }),
    ]);
    const roles = roleRows.map((row) => row.role.name).sort();
    const isSuperAdmin = roles.includes('SUPER_ADMIN');
    const permissions = [
      ...new Set(
        roleRows.flatMap((row) => row.role.rolePermissions.map((rp) => rp.permission.code)),
      ),
    ].sort();
    const assigned = branchRows.map((row) => row.branch).filter((branch) => branch.isActive);
    const branches = isSuperAdmin
      ? await this.prisma.branch.findMany({ where: { isActive: true }, orderBy: { code: 'asc' } })
      : assigned;
    return {
      userId: user.id,
      username: user.username,
      fullName: user.fullName,
      email: user.email,
      sessionId,
      roles,
      tier: highestTier(roleRows.map((row) => row.role.tier)),
      permissions,
      branches: branches.map((b) => ({ id: b.id, code: b.code, name: b.name })),
      branchIds: branches.map((b) => b.id),
      isSuperAdmin,
      mustChangePassword: user.mustChangePassword,
    };
  }
}
