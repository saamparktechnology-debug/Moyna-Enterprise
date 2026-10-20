import { Inject, Injectable } from '@nestjs/common';
import { AuditLogQuerySchema } from '@erp/contracts';
import type { AuditEntry, AuditFacets, AuditLogResponse, UserActivity } from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { BranchAccessError, NotFoundError } from '../../common/errors/domain-errors.js';
import { buildPage, escapeLike, toSkipTake } from '../../common/pagination/pagination.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';

const DAY_MS = 86_400_000;
const FACET_LIMIT = 300;

/** The start of a calendar day in India, as an instant. */
const startOfDay = (date: string): Date => new Date(`${date}T00:00:00.000+05:30`);

/**
 * Reads the audit log. Row-level security decides which rows exist for the caller: a branch user sees the actions of
 * their own branches, a Super Admin sees everything, including actions that belong to no branch (sign-ins and so on).
 */
@Injectable()
export class AuditViewerService {
  constructor(@Inject(TransactionService) private readonly transactions: TransactionService) {}

  async list(auth: AuthContext, rawQuery: unknown): Promise<AuditLogResponse> {
    const query = AuditLogQuerySchema.parse(rawQuery);
    if (query.branchId && !auth.isSuperAdmin && !auth.branchIds.includes(query.branchId))
      throw new BranchAccessError();
    const range: Prisma.DateTimeFilter = {
      ...(query.from ? { gte: startOfDay(query.from) } : {}),
      ...(query.to ? { lt: new Date(startOfDay(query.to).getTime() + DAY_MS) } : {}),
    };
    const q = query.q ? escapeLike(query.q) : null;
    const where: Prisma.AuditLogWhereInput = {
      ...(query.actorId ? { actorId: query.actorId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
      ...(query.entityId ? { entityId: query.entityId } : {}),
      ...(Object.keys(range).length > 0 ? { createdAt: range } : {}),
      ...(q
        ? {
            OR: [
              { action: { contains: q, mode: 'insensitive' } },
              { entityType: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const field = query.sortBy ?? 'createdAt';
    const orderBy: Prisma.AuditLogOrderByWithRelationInput[] = [
      { [field]: query.sortOrder },
      { id: 'asc' },
    ];

    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.auditLog.findMany({ where, orderBy, ...toSkipTake(query) }),
        tx.auditLog.count({ where }),
      ]);
      const actorIds = [
        ...new Set(rows.map((row) => row.actorId).filter((id): id is string => !!id)),
      ];
      const branchIds = [
        ...new Set(rows.map((row) => row.branchId).filter((id): id is string => !!id)),
      ];
      const [users, branches] = await Promise.all([
        tx.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } }),
        tx.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, code: true } }),
      ]);
      const names = new Map(users.map((user) => [user.id, user.fullName]));
      const codes = new Map(branches.map((branch) => [branch.id, branch.code]));
      const items: AuditEntry[] = rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        actorId: row.actorId,
        actorName: row.actorId ? (names.get(row.actorId) ?? null) : null,
        branchId: row.branchId,
        branchCode: row.branchId ? (codes.get(row.branchId) ?? null) : null,
        action: row.action,
        entityType: row.entityType,
        entityId: row.entityId,
        oldValue: row.oldValue ?? null,
        newValue: row.newValue ?? null,
        ipAddress: row.ipAddress,
        requestId: row.requestId,
      }));
      return buildPage(items, total, query);
    });
  }

  /** The actions and record types seen so far, for the filter lists. */
  async facets(): Promise<AuditFacets> {
    return this.transactions.run(async (tx) => {
      const [actions, entityTypes] = await Promise.all([
        tx.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' }, take: FACET_LIMIT }),
        tx.auditLog.groupBy({
          by: ['entityType'],
          orderBy: { entityType: 'asc' },
          take: FACET_LIMIT,
        }),
      ]);
      return {
        actions: actions.map((row) => row.action),
        entityTypes: entityTypes.map((row) => row.entityType),
      };
    });
  }

  /** What one person has been doing: when they last signed in, how many sessions are open, and their recent actions. */
  async userActivity(userId: string): Promise<UserActivity> {
    const since = new Date(Date.now() - 30 * DAY_MS);
    return this.transactions.run(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, fullName: true, username: true, status: true, lastLoginAt: true },
      });
      if (!user) throw new NotFoundError('User', userId);
      const [sessions, count, top] = await Promise.all([
        tx.session.count({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } } }),
        tx.auditLog.count({ where: { actorId: userId, createdAt: { gte: since } } }),
        tx.auditLog.groupBy({
          by: ['action'],
          where: { actorId: userId, createdAt: { gte: since } },
          _count: { _all: true },
          orderBy: [{ _count: { action: 'desc' } }, { action: 'asc' }],
          take: 5,
        }),
      ]);
      return {
        userId: user.id,
        fullName: user.fullName,
        username: user.username,
        status: user.status,
        lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
        activeSessions: sessions,
        actionsLast30Days: count,
        topActions: top.map((row) => ({ action: row.action, count: row._count._all })),
      };
    });
  }
}
