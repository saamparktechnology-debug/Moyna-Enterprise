import { Inject, Injectable } from '@nestjs/common';
import {
  CreateSupplierRequestSchema,
  RecordSupplierPaymentRequestSchema,
  SUPPLIER_SORT_FIELDS,
  SupplierLedgerQuerySchema,
  SupplierListQuerySchema,
  UpdateSupplierRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type {
  Supplier,
  SupplierBalance,
  SupplierDetail,
  SupplierLedgerResponse,
  SupplierListResponse,
  SupplierPayment,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  BusinessRuleError,
  ConflictError,
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
import type { AuthContext } from '../auth/auth.types.js';
import { supplierBalance, supplierLedger } from './purchasing-queries.js';
import type { SupplierBalanceRow } from './purchasing-queries.js';

type Row = Prisma.SupplierGetPayload<Record<string, never>>;

const toDto = (row: Row): Supplier => ({
  id: row.id,
  name: row.name,
  gstin: row.gstin,
  phone: row.phone,
  stateCode: row.stateCode,
  isActive: row.isActive,
  rowVersion: row.rowVersion,
});

const toBalanceDto = (supplierId: string, balance: SupplierBalanceRow): SupplierBalance => ({
  supplierId,
  charged: balance.charged.toFixed(2),
  credited: balance.credited.toFixed(2),
  paid: balance.paid.toFixed(2),
  outstanding: balance.outstanding.toFixed(2),
});

@Injectable()
export class SuppliersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  async list(rawQuery: unknown): Promise<SupplierListResponse> {
    const query = SupplierListQuerySchema.parse(rawQuery);
    const filters: Prisma.SupplierWhereInput[] = [];
    if (query.status !== 'all') filters.push({ isActive: query.status === 'active' });
    const found = containsAny(['name', 'gstin', 'phone'], query.search);
    if (found) filters.push(found);
    const where: Prisma.SupplierWhereInput = { AND: filters };
    const orderBy = toOrderBy(SUPPLIER_SORT_FIELDS, query, { field: 'name', order: 'asc' });
    const [rows, total] = await Promise.all([
      this.prisma.supplier.findMany({ where, orderBy, ...toSkipTake(query) }),
      this.prisma.supplier.count({ where }),
    ]);
    return buildPage(rows.map(toDto), total, query);
  }

  async get(id: string): Promise<SupplierDetail> {
    return this.transactions.run(async (tx) => {
      const row = await tx.supplier.findUnique({ where: { id } });
      if (!row) throw new NotFoundError('Supplier', id);
      return { ...toDto(row), balance: toBalanceDto(id, await supplierBalance(tx, id)) };
    });
  }

  async create(auth: AuthContext, body: unknown): Promise<Supplier> {
    const input = CreateSupplierRequestSchema.parse(body);
    await this.assertState(input.stateCode);
    try {
      return await this.transactions.run(async (tx) => {
        const row = await tx.supplier.create({
          data: { ...input, createdBy: auth.userId, updatedBy: auth.userId },
        });
        await this.audit.record(tx, {
          action: 'SUPPLIER_CREATED',
          entityType: 'Supplier',
          entityId: row.id,
          newValue: { name: row.name, gstin: row.gstin },
        });
        return toDto(row);
      });
    } catch (error) {
      throw this.explain(error);
    }
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<Supplier> {
    const input = UpdateSupplierRequestSchema.parse(body);
    const { rowVersion, ...changes } = input;
    await this.assertState(changes.stateCode);
    try {
      return await this.transactions.run(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM suppliers WHERE id = ${id}::uuid FOR UPDATE`;
        if (rows.length === 0) throw new NotFoundError('Supplier', id);
        const current = await tx.supplier.findUniqueOrThrow({ where: { id } });
        if (current.rowVersion !== rowVersion)
          throw new ConflictError(
            'This supplier was changed by someone else. Reload it and try again',
          );
        const next = {
          name: changes.name ?? current.name,
          gstin: changes.gstin === undefined ? current.gstin : changes.gstin,
          phone: changes.phone === undefined ? current.phone : changes.phone,
          stateCode: changes.stateCode === undefined ? current.stateCode : changes.stateCode,
          isActive: changes.isActive ?? current.isActive,
        };
        if (next.gstin) this.assertGstinMatchesState(next.gstin, next.stateCode);
        const unchanged = (Object.keys(next) as (keyof typeof next)[]).every(
          (key) => next[key] === current[key],
        );
        if (unchanged) return toDto(current);
        if (current.isActive && !next.isActive) {
          const open = await tx.$queryRaw<
            { found: boolean }[]
          >`SELECT supplier_has_open_orders(${id}::uuid) AS found`;
          if (open[0]?.found)
            throw new BusinessRuleError('This supplier cannot be deactivated yet', [
              {
                field: 'isActive',
                message: 'Orders to this supplier are still open in some branch',
              },
            ]);
        }
        const row = await tx.supplier.update({
          where: { id },
          data: { ...next, updatedBy: auth.userId },
        });
        await this.audit.record(tx, {
          action: 'SUPPLIER_UPDATED',
          entityType: 'Supplier',
          entityId: id,
          oldValue: { name: current.name, gstin: current.gstin, isActive: current.isActive },
          newValue: { name: row.name, gstin: row.gstin, isActive: row.isActive },
        });
        return toDto(row);
      });
    } catch (error) {
      throw this.explain(error);
    }
  }

  async ledger(id: string, rawQuery: unknown): Promise<SupplierLedgerResponse> {
    const query = SupplierLedgerQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      if (!(await tx.supplier.findUnique({ where: { id }, select: { id: true } })))
        throw new NotFoundError('Supplier', id);
      const { skip, take } = toSkipTake(query);
      const rows = await supplierLedger(tx, id, skip, take);
      const total = Number(rows[0]?.total ?? 0);
      const page = buildPage(
        rows.map((row) => ({
          at: row.at.toISOString(),
          kind: row.kind,
          documentNo: row.doc_no,
          branchCode: row.branch_code,
          description: row.description,
          debit: new Prisma.Decimal(row.debit).toFixed(2),
          credit: new Prisma.Decimal(row.credit).toFixed(2),
          balance: new Prisma.Decimal(row.balance).toFixed(2),
        })),
        total,
        query,
      );
      return { ...page, balance: toBalanceDto(id, await supplierBalance(tx, id)) };
    });
  }

  /** A payment cannot be more than what the company owes this supplier, so the ledger never goes into credit. */
  async recordPayment(
    auth: AuthContext,
    supplierId: string,
    body: unknown,
  ): Promise<SupplierPayment> {
    const input = RecordSupplierPaymentRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    const today = todayInIndia();
    const paidOn = input.paidOn ?? today;
    if (paidOn > today)
      throw new ValidationFailedError('The payment date is in the future', [
        { field: 'paidOn', message: 'Choose today or an earlier date' },
      ]);
    return this.transactions.run(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM suppliers WHERE id = ${supplierId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('Supplier', supplierId);
      await this.assertBranchAndMode(tx, branchId, input.mode);
      const amount = new Prisma.Decimal(input.amount);
      const before = await supplierBalance(tx, supplierId);
      if (amount.greaterThan(before.outstanding))
        throw new BusinessRuleError('The payment is more than what is owed to this supplier', [
          {
            field: 'amount',
            message: `Only ${before.outstanding.toFixed(2)} is outstanding`,
          },
        ]);
      const row = await tx.supplierPayment.create({
        data: {
          branchId,
          supplierId,
          amount,
          paidOn: new Date(`${paidOn}T00:00:00.000Z`),
          mode: input.mode,
          reference: input.reference ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'SUPPLIER_PAYMENT_RECORDED',
        entityType: 'Supplier',
        entityId: supplierId,
        branchId,
        newValue: {
          amount: amount.toFixed(2),
          mode: input.mode,
          paidOn,
          reference: input.reference ?? null,
        },
      });
      return {
        id: row.id,
        supplierId,
        branchId,
        amount: amount.toFixed(2),
        paidOn,
        mode: row.mode,
        reference: row.reference,
        outstanding: before.outstanding.minus(amount).toFixed(2),
      };
    });
  }

  private async assertBranchAndMode(tx: TxClient, branchId: string, mode: string): Promise<void> {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { isActive: true },
    });
    if (!branch) throw new NotFoundError('Branch', branchId);
    if (!branch.isActive) throw new BusinessRuleError('This branch is inactive');
    const found = await tx.paymentMode.findFirst({ where: { code: mode, isActive: true } });
    if (!found)
      throw new ValidationFailedError('Choose a payment mode from the list', [
        { field: 'mode', message: 'This payment mode is not available' },
      ]);
  }

  private resolveBranch(requested: string | undefined): string {
    if (requested) return requested;
    const context = this.contexts.require();
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch that paid', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }

  private async assertState(stateCode: string | null | undefined): Promise<void> {
    if (!stateCode) return;
    if (!(await this.prisma.state.findFirst({ where: { code: stateCode, isActive: true } })))
      throw new ValidationFailedError('Choose a state from the list', [
        { field: 'stateCode', message: 'Unknown state' },
      ]);
  }

  private assertGstinMatchesState(gstin: string, stateCode: string | null): void {
    if (stateCode && gstin.slice(0, 2) !== stateCode)
      throw new ValidationFailedError('The GSTIN does not match the state', [
        { field: 'gstin', message: `A GSTIN in this state starts with ${stateCode}` },
      ]);
  }

  private explain(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return new ConflictError('A supplier with this GSTIN already exists', [
        { field: 'gstin', message: 'Another supplier has this GSTIN' },
      ]);
    return error instanceof Error ? error : new Error(String(error));
  }
}
