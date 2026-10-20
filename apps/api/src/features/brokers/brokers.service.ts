import { Inject, Injectable } from '@nestjs/common';
import {
  AddCommissionRuleRequestSchema,
  BROKER_SORT_FIELDS,
  BrokerLedgerQuerySchema,
  BrokerListQuerySchema,
  CreateBrokerRequestSchema,
  UpdateBrokerRequestSchema,
} from '@erp/contracts';
import type {
  Broker,
  BrokerLedger,
  BrokerListResponse,
  BrokerSummary,
  CommissionRule,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/domain-errors.js';
import {
  buildPage,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';

const STALE = 'This broker was changed by someone else. Reload them and try again';
const fixed = (value: Prisma.Decimal | string | number | null): string =>
  new Prisma.Decimal(value ?? 0).toFixed(2);

interface Figures {
  payable: string;
  toRecover: string;
}

const BROKER_INCLUDE = {
  commissionRules: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.BrokerInclude;
type BrokerRow = Prisma.BrokerGetPayload<{ include: typeof BROKER_INCLUDE }>;

@Injectable()
export class BrokersService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(rawQuery: unknown): Promise<BrokerListResponse> {
    const query = BrokerListQuerySchema.parse(rawQuery);
    const filters: Prisma.BrokerWhereInput[] = [];
    if (query.status === 'active') filters.push({ isActive: true });
    if (query.status === 'inactive') filters.push({ isActive: false });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({ OR: [{ name: like }, { phone: like }] });
    }
    const where: Prisma.BrokerWhereInput = { AND: filters };
    const orderBy = toOrderBy(BROKER_SORT_FIELDS, query, { field: 'name', order: 'asc' });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.broker.findMany({
          where,
          orderBy,
          include: { commissionRules: { where: { isActive: true } } },
          ...toSkipTake(query),
        }),
        tx.broker.count({ where }),
      ]);
      const figures = await this.figures(
        tx,
        rows.map((row) => row.id),
      );
      return buildPage(
        rows.map((row) => this.summary(row, row.commissionRules, figures.get(row.id))),
        total,
        query,
      );
    });
  }

  async get(id: string): Promise<Broker> {
    return this.transactions.run((tx) => this.present(tx, id));
  }

  async create(auth: AuthContext, body: unknown): Promise<Broker> {
    const input = CreateBrokerRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      if (input.phone) await this.assertPhoneFree(tx, input.phone, null);
      const row = await tx.broker.create({
        data: {
          name: input.name,
          phone: input.phone,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'BROKER_CREATED',
        entityType: 'Broker',
        entityId: row.id,
        newValue: { name: row.name, phone: row.phone },
      });
      return this.present(tx, row.id);
    });
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<Broker> {
    const input = UpdateBrokerRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (input.phone && input.phone !== current.phone)
        await this.assertPhoneFree(tx, input.phone, id);
      const next = await tx.broker.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action:
          input.isActive === undefined
            ? 'BROKER_UPDATED'
            : next.isActive
              ? 'BROKER_ACTIVATED'
              : 'BROKER_DEACTIVATED',
        entityType: 'Broker',
        entityId: id,
        oldValue: { name: current.name, phone: current.phone, isActive: current.isActive },
        newValue: { name: next.name, phone: next.phone, isActive: next.isActive },
      });
      return this.present(tx, id);
    });
  }

  /** Puts a new rule in force and retires the old one. The old rule is kept as it was, with every commission that used it. */
  async addRule(auth: AuthContext, id: string, body: unknown): Promise<Broker> {
    const input = AddCommissionRuleRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM brokers WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Broker', id);
      const broker = await tx.broker.findUniqueOrThrow({
        where: { id },
        include: { commissionRules: { where: { isActive: true } } },
      });
      if (!broker.isActive)
        throw new BusinessRuleError('This broker is not active', [
          { field: 'broker', message: 'Activate the broker before changing their commission rule' },
        ]);
      const old = broker.commissionRules[0] ?? null;
      if (old) {
        await tx.commissionRule.update({
          where: { id: old.id },
          data: { isActive: false, updatedBy: auth.userId },
        });
      }
      const created = await tx.commissionRule.create({
        data: {
          brokerId: id,
          type: input.type,
          value: input.value,
          isActive: true,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'COMMISSION_RULE_ADDED',
        entityType: 'Broker',
        entityId: id,
        oldValue: old ? { ruleId: old.id, type: old.type, value: old.value.toFixed(2) } : null,
        newValue: { ruleId: created.id, type: created.type, value: created.value.toFixed(2) },
      });
      return this.present(tx, id);
    });
  }

  /**
   * What is owed to the broker, entry by entry: commissions worked out, credit notes and cancellations that took some
   * back, and payouts. The running balance is worked out over every entry first and the date filter applied after, so a
   * filtered view still shows the true balance. A negative balance means the broker was paid more than is now due.
   */
  async ledger(id: string, rawQuery: unknown): Promise<BrokerLedger> {
    const query = BrokerLedgerQuerySchema.parse(rawQuery);
    const entries = Prisma.sql`
      SELECT * FROM (
        SELECT ((c.created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date AS entry_date, 1 AS ord,
               c.created_at AT TIME ZONE 'UTC' AS at,
               'COMMISSION' AS type, i.invoice_no AS doc_no, c.id AS doc_id, br.code AS branch_code,
               'Commission on ' || COALESCE(i.invoice_no, 'an invoice') AS description,
               c.amount AS increase, 0::numeric AS decrease
        FROM commissions c JOIN invoices i ON i.id = c.invoice_id JOIN branches br ON br.id = c.branch_id
        WHERE c.broker_id = ${id}::uuid
        UNION ALL
        SELECT (a.created_at AT TIME ZONE 'Asia/Kolkata')::date, 2, a.created_at, a.kind,
               COALESCE(n.credit_note_no, i.invoice_no), a.id, br.code,
               CASE WHEN a.kind = 'CREDIT_NOTE' THEN 'Credit note against ' || COALESCE(i.invoice_no, 'an invoice')
                    ELSE 'Invoice ' || COALESCE(i.invoice_no, '') || ' cancelled' END,
               0, a.amount
        FROM commission_adjustments a
        JOIN commissions c ON c.id = a.commission_id JOIN invoices i ON i.id = c.invoice_id
        JOIN branches br ON br.id = a.branch_id LEFT JOIN credit_notes n ON n.id = a.credit_note_id
        WHERE c.broker_id = ${id}::uuid
        UNION ALL
        SELECT (c.paid_at AT TIME ZONE 'Asia/Kolkata')::date, 3, c.paid_at, 'PAYOUT', i.invoice_no, c.id, br.code,
               'Paid out for ' || COALESCE(i.invoice_no, 'an invoice') || COALESCE(' (' || c.payout_reference || ')', ''),
               0, c.paid_amount
        FROM commissions c JOIN invoices i ON i.id = c.invoice_id JOIN branches br ON br.id = c.branch_id
        WHERE c.broker_id = ${id}::uuid AND c.status = 'PAID' AND c.paid_at IS NOT NULL
      ) e`;
    const running = Prisma.sql`
      SELECT e.*, SUM(e.increase - e.decrease) OVER (
               ORDER BY e.entry_date, e.ord, e.at, e.doc_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS running
      FROM (${entries}) e`;
    const from = query.from ? Prisma.sql`r.entry_date >= ${query.from}::date` : Prisma.sql`TRUE`;
    const to = query.to ? Prisma.sql`r.entry_date <= ${query.to}::date` : Prisma.sql`TRUE`;
    const { skip, take } = toSkipTake(query);
    const dir = query.sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;

    return this.transactions.run(async (tx) => {
      const broker = await tx.broker.findUnique({
        where: { id },
        select: { id: true, name: true },
      });
      if (!broker) throw new NotFoundError('Broker', id);
      const [rows, counts, balance] = await Promise.all([
        tx.$queryRaw<
          {
            entry_date: string;
            type: 'COMMISSION' | 'CREDIT_NOTE' | 'INVOICE_CANCELLED' | 'PAYOUT';
            doc_no: string | null;
            doc_id: string;
            branch_code: string;
            description: string;
            increase: string;
            decrease: string;
            balance: string;
          }[]
        >(Prisma.sql`
          SELECT to_char(r.entry_date, 'YYYY-MM-DD') AS entry_date, r.type, r.doc_no, r.doc_id, r.branch_code,
                 r.description, round(r.increase, 2)::text AS increase, round(r.decrease, 2)::text AS decrease,
                 round(r.running, 2)::text AS balance
          FROM (${running}) r WHERE ${from} AND ${to}
          ORDER BY r.entry_date ${dir}, r.ord ${dir}, r.at ${dir}, r.doc_id ${dir}
          LIMIT ${take} OFFSET ${skip}`),
        tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS total FROM (${running}) r WHERE ${from} AND ${to}`,
        ),
        tx.$queryRaw<{ balance: Prisma.Decimal | null }[]>(
          Prisma.sql`SELECT SUM(e.increase - e.decrease) AS balance FROM (${entries}) e`,
        ),
      ]);
      return {
        ...buildPage(
          rows.map((row) => ({
            date: row.entry_date,
            type: row.type,
            documentNo: row.doc_no,
            documentId: row.doc_id,
            branchCode: row.branch_code,
            description: row.description,
            increase: row.increase,
            decrease: row.decrease,
            balance: row.balance,
          })),
          Number(counts[0]?.total ?? 0),
          query,
        ),
        brokerId: broker.id,
        brokerName: broker.name,
        balance: fixed(balance[0]?.balance ?? null),
      };
    });
  }

  // ---------- helpers ----------

  private async assertPhoneFree(tx: TxClient, phone: string, ownId: string | null): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`broker-phone:${phone}`}, 0))`;
    const other = await tx.broker.findFirst({
      where: { phone, ...(ownId ? { id: { not: ownId } } : {}) },
      select: { name: true },
    });
    if (other)
      throw new ConflictError('A broker with this phone number already exists', [
        { field: 'phone', message: `Already used by ${other.name}` },
      ]);
  }

  private async lock(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM brokers WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Broker', id);
    const row = await tx.broker.findUniqueOrThrow({ where: { id } });
    if (row.rowVersion !== rowVersion) throw new ConflictError(STALE);
    return row;
  }

  /** Commission still to pay and commission paid and since lowered, for each broker, over the branches the caller can see. */
  private async figures(tx: TxClient, ids: readonly string[]): Promise<Map<string, Figures>> {
    if (ids.length === 0) return new Map();
    const rows = await tx.$queryRaw<
      { broker_id: string; payable: Prisma.Decimal; to_recover: Prisma.Decimal }[]
    >(Prisma.sql`
      SELECT c.broker_id,
             COALESCE(SUM(CASE WHEN c.status = 'PAYABLE' THEN c.amount - COALESCE(a.adjusted, 0) END), 0) AS payable,
             COALESCE(SUM(CASE WHEN c.status = 'PAID'
                               THEN GREATEST(c.paid_amount - (c.amount - COALESCE(a.adjusted, 0)), 0) END), 0) AS to_recover
      FROM commissions c
      LEFT JOIN (SELECT commission_id, SUM(amount) AS adjusted FROM commission_adjustments GROUP BY commission_id) a
        ON a.commission_id = c.id
      WHERE c.broker_id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      GROUP BY c.broker_id`);
    return new Map(
      rows.map((row) => [
        row.broker_id,
        { payable: fixed(row.payable), toRecover: fixed(row.to_recover) },
      ]),
    );
  }

  private summary(
    row: { id: string; name: string; phone: string | null; isActive: boolean; createdAt: Date },
    active: readonly { type: 'PERCENT' | 'FIXED'; value: Prisma.Decimal }[],
    figures: Figures | undefined,
  ): BrokerSummary {
    const rule = active[0];
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      isActive: row.isActive,
      activeRule: rule ? { type: rule.type, value: rule.value.toFixed(2) } : null,
      payable: figures?.payable ?? '0.00',
      toRecover: figures?.toRecover ?? '0.00',
      createdAt: row.createdAt.toISOString(),
    };
  }

  private async present(tx: TxClient, id: string): Promise<Broker> {
    const row: BrokerRow | null = await tx.broker.findUnique({
      where: { id },
      include: BROKER_INCLUDE,
    });
    if (!row) throw new NotFoundError('Broker', id);
    const figures = await this.figures(tx, [id]);
    const makers = await tx.user.findMany({
      where: { id: { in: row.commissionRules.flatMap((r) => (r.createdBy ? [r.createdBy] : [])) } },
      select: { id: true, fullName: true },
    });
    const names = new Map(makers.map((u) => [u.id, u.fullName]));
    const rules: CommissionRule[] = row.commissionRules.map((rule) => ({
      id: rule.id,
      type: rule.type,
      value: rule.value.toFixed(2),
      isActive: rule.isActive,
      createdAt: rule.createdAt.toISOString(),
      createdByName: rule.createdBy ? (names.get(rule.createdBy) ?? null) : null,
    }));
    return {
      ...this.summary(
        row,
        row.commissionRules.filter((r) => r.isActive),
        figures.get(id),
      ),
      rowVersion: row.rowVersion,
      rules,
    };
  }
}
