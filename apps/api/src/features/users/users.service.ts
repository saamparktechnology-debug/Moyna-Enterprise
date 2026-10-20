import { Inject, Injectable } from '@nestjs/common';
import {
  CreateUserRequestSchema,
  UpdateUserRequestSchema,
  USER_SORT_FIELDS,
  UserListQuerySchema,
} from '@erp/contracts';
import type { CreateUserResponse, User, UserListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BranchAccessError,
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import {
  buildPage,
  containsAny,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext, RequestInfo } from '../auth/auth.types.js';
import { PasswordService } from '../auth/password.service.js';
import { primaryRole, targetOf, toUserDto, USER_INCLUDE } from './user-dto.js';
import type { UserRow } from './user-dto.js';
import {
  canAssignBranch,
  canAssignRole,
  canDeactivate,
  canManage,
  canSee,
  resultingBranches,
} from './user-policy.js';
import type { Actor } from './user-policy.js';

const actorOf = (auth: AuthContext): Actor => ({
  userId: auth.userId,
  tier: auth.tier,
  branchIds: auth.branchIds,
});
const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PasswordService) private readonly passwords: PasswordService,
  ) {}

  async list(auth: AuthContext, rawQuery: unknown): Promise<UserListResponse> {
    const query = UserListQuerySchema.parse(rawQuery);
    const where: Prisma.UserWhereInput = {
      AND: [
        auth.isSuperAdmin
          ? {}
          : {
              OR: [
                { id: auth.userId },
                { userBranches: { some: { branchId: { in: auth.branchIds } } } },
              ],
            },
        query.status === 'all' ? {} : { status: query.status === 'active' ? 'ACTIVE' : 'INACTIVE' },
        query.roleId ? { userRoles: { some: { roleId: query.roleId } } } : {},
        query.branchId ? { userBranches: { some: { branchId: query.branchId } } } : {},
        containsAny(['username', 'fullName', 'email'], query.search) ?? {},
      ],
    };
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        include: USER_INCLUDE,
        orderBy: toOrderBy(USER_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' }),
        ...toSkipTake(query),
      }),
    ]);
    const actor = actorOf(auth);
    return buildPage(
      rows.map((row) => toUserDto(row, actor)),
      total,
      query,
    );
  }

  async get(auth: AuthContext, id: string): Promise<User> {
    const row = await this.prisma.user.findUnique({ where: { id }, include: USER_INCLUDE });
    const actor = actorOf(auth);
    if (!row || !canSee(actor, targetOf(row))) throw new NotFoundError('User', id);
    return toUserDto(row, actor);
  }

  async create(info: RequestInfo, auth: AuthContext, body: unknown): Promise<CreateUserResponse> {
    const input = CreateUserRequestSchema.parse(body);
    const actor = actorOf(auth);
    const role = await this.prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role)
      throw new ValidationFailedError('Choose a role', [
        { field: 'roleId', message: 'Choose a role' },
      ]);
    if (!canAssignRole(actor, role.tier))
      throw new ForbiddenError('You cannot give someone this role');
    await this.assertBranchesAssignable(actor, input.branchIds);
    await this.assertUnique(input.username, input.email);

    const temporaryPassword = this.passwords.generateTemporaryPassword();
    const passwordHash = await this.passwords.hash(temporaryPassword);
    try {
      const created = await this.transactions.run(async (tx) => {
        const row = await tx.user.create({
          data: {
            username: input.username,
            email: input.email,
            fullName: input.fullName,
            passwordHash,
            mustChangePassword: true,
            passwordChangedAt: new Date(),
            createdBy: auth.userId,
            userRoles: { create: { roleId: role.id } },
            userBranches: { create: input.branchIds.map((branchId) => ({ branchId })) },
          },
          include: USER_INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'USER_CREATED',
          entityType: 'User',
          entityId: row.id,
          newValue: {
            username: row.username,
            fullName: row.fullName,
            email: row.email,
            role: role.name,
            branchIds: input.branchIds,
          },
        });
        return row;
      });
      return { user: toUserDto(created, actor), temporaryPassword };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw this.duplicate([]);
      throw error;
    }
  }

  async update(info: RequestInfo, auth: AuthContext, id: string, body: unknown): Promise<User> {
    const input = UpdateUserRequestSchema.parse(body);
    const actor = actorOf(auth);
    try {
      return await this.transactions.run(async (tx) => {
        const row = await this.lock(tx, id, actor);
        const target = targetOf(row);
        const currentRole = primaryRole(row);
        const isSelf = row.id === auth.userId;

        if (isSelf) {
          if (input.roleId !== currentRole?.id || !sameSet(input.branchIds, target.branchIds)) {
            throw new ForbiddenError('You cannot change your own role or branches');
          }
        } else if (!canManage(actor, target)) {
          throw new ForbiddenError('You cannot manage this user');
        }

        let role = currentRole;
        if (input.roleId !== currentRole?.id) {
          role = await tx.role.findUnique({ where: { id: input.roleId } });
          if (!role)
            throw new ValidationFailedError('Choose a role', [
              { field: 'roleId', message: 'Choose a role' },
            ]);
          if (!canAssignRole(actor, role.tier))
            throw new ForbiddenError('You cannot give someone this role');
        }

        const finalBranchIds = isSelf
          ? target.branchIds
          : resultingBranches(actor, target.branchIds, input.branchIds);
        if (!isSelf) await this.assertBranchesAssignable(actor, input.branchIds);
        if (finalBranchIds.length === 0) {
          throw new ValidationFailedError('Choose at least one branch', [
            { field: 'branchIds', message: 'Choose at least one branch' },
          ]);
        }
        if (input.email !== row.email) await this.assertUnique(null, input.email, row.id);

        const unchanged =
          input.fullName === row.fullName &&
          input.email === row.email &&
          role?.id === currentRole?.id &&
          sameSet(finalBranchIds, target.branchIds);
        if (unchanged) return toUserDto(row, actor);

        const bumped = await tx.user.updateMany({
          where: { id, rowVersion: input.rowVersion },
          data: { fullName: input.fullName, email: input.email, updatedBy: auth.userId },
        });
        if (bumped.count === 0) throw this.staleVersion();

        if (role && role.id !== currentRole?.id) {
          await tx.userRole.deleteMany({ where: { userId: id } });
          await tx.userRole.create({ data: { userId: id, roleId: role.id } });
        }
        const removed = target.branchIds.filter((branchId) => !finalBranchIds.includes(branchId));
        const added = finalBranchIds.filter((branchId) => !target.branchIds.includes(branchId));
        if (removed.length > 0)
          await tx.userBranch.deleteMany({ where: { userId: id, branchId: { in: removed } } });
        if (added.length > 0)
          await tx.userBranch.createMany({
            data: added.map((branchId) => ({ userId: id, branchId })),
          });

        await this.audit.record(tx, {
          action: 'USER_UPDATED',
          entityType: 'User',
          entityId: id,
          oldValue: {
            fullName: row.fullName,
            email: row.email,
            role: currentRole?.name ?? null,
            branchIds: target.branchIds,
          },
          newValue: {
            fullName: input.fullName,
            email: input.email,
            role: role?.name ?? null,
            branchIds: finalBranchIds,
          },
        });
        return toUserDto(await this.reload(tx, id), actor);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw this.duplicate([]);
      throw error;
    }
  }

  async deactivate(info: RequestInfo, auth: AuthContext, id: string): Promise<User> {
    const actor = actorOf(auth);
    return this.transactions.run(async (tx) => {
      const row = await this.lock(tx, id, actor);
      const target = targetOf(row);
      if (row.id === auth.userId)
        throw new BusinessRuleError('You cannot deactivate your own account');
      if (!canManage(actor, target)) throw new ForbiddenError('You cannot manage this user');
      if (!canDeactivate(actor, target)) {
        throw new ForbiddenError(
          'This person also works in branches you do not manage. Ask a Super Admin to deactivate them.',
        );
      }
      if (row.status === 'INACTIVE') return toUserDto(row, actor);
      await tx.user.update({ where: { id }, data: { status: 'INACTIVE', updatedBy: auth.userId } });
      await tx.session.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record(tx, { action: 'USER_DEACTIVATED', entityType: 'User', entityId: id });
      return toUserDto(await this.reload(tx, id), actor);
    });
  }

  async reactivate(info: RequestInfo, auth: AuthContext, id: string): Promise<User> {
    const actor = actorOf(auth);
    return this.transactions.run(async (tx) => {
      const row = await this.lock(tx, id, actor);
      if (row.id === auth.userId || !canManage(actor, targetOf(row)))
        throw new ForbiddenError('You cannot manage this user');
      if (row.status === 'ACTIVE') return toUserDto(row, actor);
      await tx.user.update({
        where: { id },
        data: { status: 'ACTIVE', failedLoginCount: 0, lockedUntil: null, updatedBy: auth.userId },
      });
      await this.audit.record(tx, { action: 'USER_REACTIVATED', entityType: 'User', entityId: id });
      return toUserDto(await this.reload(tx, id), actor);
    });
  }

  private async lock(tx: TxClient, id: string, actor: Actor): Promise<UserRow> {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await tx.user.findUnique({ where: { id }, include: USER_INCLUDE });
    if (!row || !canSee(actor, targetOf(row))) throw new NotFoundError('User', id);
    return row;
  }

  private reload(tx: TxClient, id: string): Promise<UserRow> {
    return tx.user.findUniqueOrThrow({ where: { id }, include: USER_INCLUDE });
  }

  private async assertBranchesAssignable(
    actor: Actor,
    branchIds: readonly string[],
  ): Promise<void> {
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: [...branchIds] }, isActive: true },
    });
    if (branches.length !== new Set(branchIds).size) {
      throw new ValidationFailedError('Choose active branches', [
        { field: 'branchIds', message: 'One or more branches do not exist or are switched off' },
      ]);
    }
    if (!branchIds.every((branchId) => canAssignBranch(actor, branchId)))
      throw new BranchAccessError();
  }

  private async assertUnique(
    username: string | null,
    email: string,
    exceptId?: string,
  ): Promise<void> {
    const clashes = await this.prisma.user.findMany({
      where: {
        ...(exceptId ? { id: { not: exceptId } } : {}),
        OR: [
          ...(username ? [{ username: { equals: username, mode: 'insensitive' as const } }] : []),
          { email: { equals: email, mode: 'insensitive' as const } },
        ],
      },
      select: { username: true, email: true },
    });
    if (clashes.length === 0) return;
    const details = [];
    if (username && clashes.some((row) => row.username.toLowerCase() === username.toLowerCase()))
      details.push({ field: 'username', message: 'This username is already taken' });
    if (clashes.some((row) => row.email.toLowerCase() === email.toLowerCase()))
      details.push({ field: 'email', message: 'This email is already used by another account' });
    throw this.duplicate(details);
  }

  private duplicate(details: { field: string; message: string }[]): ConflictError {
    return new ConflictError('That username or email is already in use', details);
  }

  private staleVersion(): ConflictError {
    return new ConflictError('Someone else changed this user. Reload and try again.');
  }
}
