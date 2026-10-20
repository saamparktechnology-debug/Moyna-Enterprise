import { Inject, Injectable } from '@nestjs/common';
import { CreateRoleRequestSchema, UpdateRoleRequestSchema } from '@erp/contracts';
import type { PermissionGroup, Role } from '@erp/contracts';
import { canManageTier, RESERVED_PERMISSIONS } from '@erp/permissions';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext, RequestInfo } from '../auth/auth.types.js';

const ROLE_INCLUDE = {
  rolePermissions: { include: { permission: true } },
  _count: { select: { userRoles: true } },
} satisfies Prisma.RoleInclude;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof ROLE_INCLUDE }>;

const isReserved = (code: string): boolean =>
  (RESERVED_PERMISSIONS as readonly string[]).includes(code);
const visibleTo = (auth: AuthContext, tier: RoleRow['tier']): boolean =>
  auth.tier === 'SUPER_ADMIN' || canManageTier(auth.tier, tier);

function toDto(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    tier: row.tier,
    isSystem: row.isSystem,
    editable: row.tier !== 'SUPER_ADMIN',
    permissionCodes: row.rolePermissions.map((entry) => entry.permission.code).sort(),
    userCount: row._count.userRoles,
    rowVersion: row.rowVersion,
  };
}

@Injectable()
export class RolesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext): Promise<Role[]> {
    const rows = await this.prisma.role.findMany({
      include: ROLE_INCLUDE,
      orderBy: { name: 'asc' },
    });
    return rows.filter((row) => visibleTo(auth, row.tier)).map(toDto);
  }

  async get(auth: AuthContext, id: string): Promise<Role> {
    const row = await this.prisma.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
    if (!row || !visibleTo(auth, row.tier)) throw new NotFoundError('Role', id);
    return toDto(row);
  }

  async permissions(): Promise<PermissionGroup[]> {
    const rows = await this.prisma.permission.findMany({
      orderBy: [{ module: 'asc' }, { code: 'asc' }],
    });
    const groups = new Map<string, PermissionGroup>();
    for (const row of rows) {
      const group = groups.get(row.module) ?? { module: row.module, permissions: [] };
      group.permissions.push({
        code: row.code,
        description: row.description ?? row.code,
        reserved: isReserved(row.code),
      });
      groups.set(row.module, group);
    }
    return [...groups.values()];
  }

  async create(info: RequestInfo, auth: AuthContext, body: unknown): Promise<Role> {
    const input = CreateRoleRequestSchema.parse(body);
    await this.assertNameFree(input.name);
    const permissionIds = await this.resolvePermissions(input.permissionCodes);
    try {
      return await this.transactions.run(async (tx) => {
        const row = await tx.role.create({
          data: {
            name: input.name,
            description: input.description,
            tier: input.tier,
            isSystem: false,
            createdBy: auth.userId,
          },
        });
        await tx.rolePermission.createMany({
          data: permissionIds.map((permissionId) => ({ roleId: row.id, permissionId })),
        });
        await this.audit.record(tx, {
          action: 'ROLE_CREATED',
          entityType: 'Role',
          entityId: row.id,
          newValue: {
            name: row.name,
            tier: row.tier,
            description: row.description,
            permissionCodes: [...input.permissionCodes].sort(),
          },
        });
        return toDto(await this.reload(tx, row.id));
      });
    } catch (error) {
      throw this.asConflict(error);
    }
  }

  async update(info: RequestInfo, auth: AuthContext, id: string, body: unknown): Promise<Role> {
    const input = UpdateRoleRequestSchema.parse(body);
    try {
      return await this.transactions.run(async (tx) => {
        await tx.$queryRaw`SELECT id FROM roles WHERE id = ${id}::uuid FOR UPDATE`;
        const row = await tx.role.findUnique({ where: { id }, include: ROLE_INCLUDE });
        if (!row || !visibleTo(auth, row.tier)) throw new NotFoundError('Role', id);
        if (row.tier === 'SUPER_ADMIN')
          throw new ForbiddenError('The Super Admin role cannot be changed');
        if (row.isSystem && input.name !== row.name) {
          throw new ValidationFailedError('System roles cannot be renamed', [
            { field: 'name', message: 'System roles cannot be renamed' },
          ]);
        }
        if (input.name !== row.name) await this.assertNameFree(input.name, id);
        const permissionIds = await this.resolvePermissions(input.permissionCodes);

        const current = row.rolePermissions.map((entry) => entry.permission.code);
        const added = input.permissionCodes.filter((code) => !current.includes(code));
        const removed = current.filter((code) => !input.permissionCodes.includes(code));
        if (
          input.name === row.name &&
          input.description === row.description &&
          added.length === 0 &&
          removed.length === 0
        )
          return toDto(row);

        const bumped = await tx.role.updateMany({
          where: { id, rowVersion: input.rowVersion },
          data: { name: input.name, description: input.description, updatedBy: auth.userId },
        });
        if (bumped.count === 0)
          throw new ConflictError('Someone else changed this role. Reload and try again.');

        if (removed.length > 0)
          await tx.rolePermission.deleteMany({
            where: { roleId: id, permission: { code: { in: removed } } },
          });
        if (added.length > 0) {
          const byCode = new Map(
            (await tx.permission.findMany({ where: { code: { in: added } } })).map((p) => [
              p.code,
              p.id,
            ]),
          );
          await tx.rolePermission.createMany({
            data: added.map((code) => ({
              roleId: id,
              permissionId: byCode.get(code) ?? permissionIds[0]!,
            })),
          });
        }
        await this.audit.record(tx, {
          action: 'ROLE_UPDATED',
          entityType: 'Role',
          entityId: id,
          oldValue: { name: row.name, description: row.description },
          newValue: {
            name: input.name,
            description: input.description,
            permissionsAdded: added.sort(),
            permissionsRemoved: removed.sort(),
          },
        });
        return toDto(await this.reload(tx, id));
      });
    } catch (error) {
      throw this.asConflict(error);
    }
  }

  private reload(tx: TxClient, id: string): Promise<RoleRow> {
    return tx.role.findUniqueOrThrow({ where: { id }, include: ROLE_INCLUDE });
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const clash = await this.prisma.role.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    });
    if (clash)
      throw new ConflictError('A role with this name already exists', [
        { field: 'name', message: 'A role with this name already exists' },
      ]);
  }

  private async resolvePermissions(codes: readonly string[]): Promise<string[]> {
    const rows = await this.prisma.permission.findMany({ where: { code: { in: [...codes] } } });
    const known = new Set(rows.map((row) => row.code));
    const unknown = codes.filter((code) => !known.has(code));
    if (unknown.length > 0) {
      throw new ValidationFailedError('Unknown permission', [
        { field: 'permissionCodes', message: `Unknown permission: ${unknown.join(', ')}` },
      ]);
    }
    const reserved = codes.filter(isReserved);
    if (reserved.length > 0) {
      throw new ValidationFailedError('Reserved permission', [
        {
          field: 'permissionCodes',
          message: `${reserved.join(', ')} can only belong to the Super Admin role`,
        },
      ]);
    }
    return rows.map((row) => row.id);
  }

  private asConflict(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return new ConflictError('A role with this name already exists', [
        { field: 'name', message: 'A role with this name already exists' },
      ]);
    }
    return error;
  }
}
