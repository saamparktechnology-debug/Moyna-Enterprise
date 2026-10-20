import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_DUE_SORT_FIELDS,
  CustomerDueListQuerySchema,
  DUE_SORT_FIELDS,
  DueListQuerySchema,
  LedgerQuerySchema,
  todayInIndia,
} from '@erp/contracts';
import type {
  CustomerDueListResponse,
  CustomerLedger,
  DueListResponse,
  LedgerEntryType,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { NotFoundError, ValidationFailedError } from '../../common/errors/domain-errors.js';
import { buildPage, escapeLike, toSkipTake } from '../../common/pagination/pagination.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import { balancesSql, toDueInvoice } from './balances.js';
import type { BalanceRow } from './balances.js';

const DUE_SORT_SQL: Record<(typeof DUE_SORT_FIELDS)[number], string> = {
  dueDate: 'b.due_date_value',
  issuedOn: 'b.issued_on_value',
  invoiceNo: 'b.invoice_no',
  outstanding: 'b.outstanding_value',
  customerName: 'b.customer_name',
};
const CUSTOMER_SORT_SQL: Record<(typeof CUSTOMER_DUE_SORT_FIELDS)[number], string> = {
  customerName: 'd.customer_name',
  outstanding: 'd.outstanding_value',
  overdue: 'd.overdue_value',
};

interface LedgerRow {
  entry_date: string;
  type: LedgerEntryType;
  doc_no: string | null;
  doc_id: string;
  branch_code: string;
  description: string;
  debit: string;
  credit: string;
  balance: string;
}

const fixed = (value: Prisma.Decimal | string | number | null): string =>
  new Prisma.Decimal(value ?? 0).toFixed(2);

function direction(order: 'asc' | 'desc'): Prisma.Sql {
  return order === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
}

@Injectable()
export class DuesService {
  constructor(@Inject(TransactionService) private readonly transactions: TransactionService) {}

  /** Issued invoices with what has been paid and what is still owed, oldest due first by default. */
  async list(rawQuery: unknown): Promise<DueListResponse> {
    const query = DueListQuerySchema.parse(rawQuery);
    const today = todayInIndia();
    const sortBy = query.sortBy ?? 'dueDate';
    if (!(sortBy in DUE_SORT_SQL))
      throw new ValidationFailedError('Unsupported sort field', [
        { field: 'sortBy', message: `Sort by one of: ${DUE_SORT_FIELDS.join(', ')}` },
      ]);
    const order = direction(query.sortBy ? query.sortOrder : 'asc');
    const sortColumn = Prisma.raw(DUE_SORT_SQL[sortBy as keyof typeof DUE_SORT_SQL]);

    const conditions: Prisma.Sql[] = [];
    if (query.customerId) conditions.push(Prisma.sql`b.customer_id = ${query.customerId}::uuid`);
    if (query.branchId) conditions.push(Prisma.sql`b.branch_id = ${query.branchId}::uuid`);
    const search = query.search?.trim();
    if (search) {
      const like = `%${escapeLike(search)}%`;
      conditions.push(Prisma.sql`(b.invoice_no ILIKE ${like} OR b.customer_name ILIKE ${like})`);
    }
    const filtersOnly = conditions.length > 0 ? Prisma.join(conditions, ' AND ') : Prisma.sql`TRUE`;
    const scoped: Prisma.Sql[] = [...conditions];
    if (query.scope === 'outstanding') scoped.push(Prisma.sql`b.outstanding_value > 0`);
    if (query.scope === 'overdue')
      scoped.push(
        Prisma.sql`b.outstanding_value > 0 AND b.due_date_value IS NOT NULL AND b.due_date_value < ${today}::date`,
      );
    if (query.scope === 'settled') scoped.push(Prisma.sql`b.outstanding_value = 0`);
    const where = scoped.length > 0 ? Prisma.join(scoped, ' AND ') : Prisma.sql`TRUE`;
    const all = balancesSql(Prisma.sql`TRUE`);
    const { skip, take } = toSkipTake(query);

    return this.transactions.run(async (tx) => {
      const [rows, counts, totals] = await Promise.all([
        tx.$queryRaw<BalanceRow[]>(Prisma.sql`
          SELECT * FROM (${all}) b WHERE ${where}
          ORDER BY ${sortColumn} ${order} NULLS LAST, b.invoice_id ASC
          LIMIT ${take} OFFSET ${skip}`),
        tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS total FROM (${all}) b WHERE ${where}`,
        ),
        tx.$queryRaw<
          { invoices: bigint; outstanding: Prisma.Decimal | null; overdue: Prisma.Decimal | null }[]
        >(
          Prisma.sql`
          SELECT COUNT(*) FILTER (WHERE b.outstanding_value > 0) AS invoices,
                 SUM(b.outstanding_value) AS outstanding,
                 SUM(b.outstanding_value) FILTER (
                   WHERE b.due_date_value IS NOT NULL AND b.due_date_value < ${today}::date) AS overdue
          FROM (${all}) b WHERE ${filtersOnly}`,
        ),
      ]);
      const total = Number(counts[0]?.total ?? 0);
      const sums = totals[0];
      return {
        ...buildPage(
          rows.map((row) => toDueInvoice(row, today)),
          total,
          query,
        ),
        totals: {
          invoices: Number(sums?.invoices ?? 0),
          outstanding: fixed(sums?.outstanding ?? null),
          overdue: fixed(sums?.overdue ?? null),
        },
      };
    });
  }

  /** One line per customer who owes money or holds credit. */
  async customers(rawQuery: unknown): Promise<CustomerDueListResponse> {
    const query = CustomerDueListQuerySchema.parse(rawQuery);
    const today = todayInIndia();
    const sortBy = query.sortBy ?? 'outstanding';
    if (!(sortBy in CUSTOMER_SORT_SQL))
      throw new ValidationFailedError('Unsupported sort field', [
        { field: 'sortBy', message: `Sort by one of: ${CUSTOMER_DUE_SORT_FIELDS.join(', ')}` },
      ]);
    const order = direction(query.sortBy ? query.sortOrder : 'desc');
    const sortColumn = Prisma.raw(CUSTOMER_SORT_SQL[sortBy as keyof typeof CUSTOMER_SORT_SQL]);
    const branchFilter = query.branchId
      ? Prisma.sql`i.branch_id = ${query.branchId}::uuid`
      : Prisma.sql`TRUE`;
    const paymentBranch = query.branchId
      ? Prisma.sql`p.branch_id = ${query.branchId}::uuid`
      : Prisma.sql`TRUE`;
    const refundBranch = query.branchId
      ? Prisma.sql`r.branch_id = ${query.branchId}::uuid`
      : Prisma.sql`TRUE`;
    const search = query.search?.trim();
    const like = search ? `%${escapeLike(search)}%` : null;
    const searchFilter = like
      ? Prisma.sql`(d.customer_name ILIKE ${like} OR d.phone ILIKE ${like})`
      : Prisma.sql`TRUE`;
    const { skip, take } = toSkipTake(query);

    const base = Prisma.sql`
      SELECT c.id AS customer_id, c.name AS customer_name, c.phone,
             COALESCE(inv.open_invoices, 0) AS open_invoices,
             COALESCE(inv.outstanding, 0) AS outstanding_value,
             COALESCE(inv.overdue, 0) AS overdue_value,
             GREATEST(COALESCE(inv.surplus, 0) + COALESCE(adv.unapplied, 0) - COALESCE(ref.refunded, 0), 0) AS credit_value
      FROM customers c
      LEFT JOIN (
        SELECT b.customer_id,
               COUNT(*) FILTER (WHERE b.outstanding_value > 0) AS open_invoices,
               SUM(b.outstanding_value) AS outstanding,
               SUM(b.outstanding_value) FILTER (
                 WHERE b.due_date_value IS NOT NULL AND b.due_date_value < ${today}::date) AS overdue,
               SUM(b.surplus_value) AS surplus
        FROM (${balancesSql(branchFilter)}) b GROUP BY b.customer_id
      ) inv ON inv.customer_id = c.id
      LEFT JOIN (
        SELECT p.customer_id,
               SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0)) AS unapplied
        FROM payments p
        WHERE ${paymentBranch}
          AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
        GROUP BY p.customer_id
      ) adv ON adv.customer_id = c.id
      LEFT JOIN (
        SELECT r.customer_id, SUM(r.amount) AS refunded
        FROM customer_refunds r
        WHERE ${refundBranch}
        GROUP BY r.customer_id
      ) ref ON ref.customer_id = c.id`;

    return this.transactions.run(async (tx) => {
      const where = Prisma.sql`(d.outstanding_value > 0 OR d.credit_value > 0) AND ${searchFilter}`;
      const [rows, counts] = await Promise.all([
        tx.$queryRaw<
          {
            customer_id: string;
            customer_name: string;
            phone: string | null;
            open_invoices: bigint;
            outstanding_value: Prisma.Decimal;
            overdue_value: Prisma.Decimal;
            credit_value: Prisma.Decimal;
          }[]
        >(Prisma.sql`
          SELECT * FROM (${base}) d WHERE ${where}
          ORDER BY ${sortColumn} ${order}, d.customer_id ASC
          LIMIT ${take} OFFSET ${skip}`),
        tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS total FROM (${base}) d WHERE ${where}`,
        ),
      ]);
      return buildPage(
        rows.map((row) => ({
          customerId: row.customer_id,
          customerName: row.customer_name,
          phone: row.phone,
          openInvoices: Number(row.open_invoices),
          outstanding: fixed(row.outstanding_value),
          overdue: fixed(row.overdue_value),
          credit: fixed(row.credit_value),
        })),
        Number(counts[0]?.total ?? 0),
        query,
      );
    });
  }

  /**
   * Everything that changed what a customer owes, in order, with the running balance. Invoices and reversals add to the
   * balance; credit notes, payments and cancellations take from it. A negative balance means the customer has credit.
   * The running balance is worked out over every entry first and the date filter applied afterwards, so a filtered view
   * still shows the true balance. Only the branches the caller can see are counted.
   */
  async ledger(customerId: string, rawQuery: unknown): Promise<CustomerLedger> {
    const query = LedgerQuerySchema.parse(rawQuery);
    const branchOf = (column: string): Prisma.Sql =>
      query.branchId
        ? Prisma.sql`${Prisma.raw(column)} = ${query.branchId}::uuid`
        : Prisma.sql`TRUE`;
    const entries = Prisma.sql`
      SELECT * FROM (
        SELECT i.issued_on AS entry_date, 1 AS ord, i.created_at AS at, 'INVOICE' AS type, i.invoice_no AS doc_no,
               i.id AS doc_id, br.code AS branch_code, 'Invoice issued' AS description,
               i.total AS debit, 0::numeric AS credit
        FROM invoices i JOIN branches br ON br.id = i.branch_id
        WHERE i.customer_id = ${customerId}::uuid AND i.status IN ('ISSUED', 'CANCELLED')
          AND i.issued_on IS NOT NULL AND ${branchOf('i.branch_id')}
        UNION ALL
        SELECT (n.decided_at AT TIME ZONE 'Asia/Kolkata')::date, 2, n.decided_at, 'CREDIT_NOTE', n.credit_note_no, n.id,
               br.code, 'Credit note against ' || COALESCE(i.invoice_no, 'an invoice'), 0, n.amount
        FROM credit_notes n JOIN invoices i ON i.id = n.invoice_id JOIN branches br ON br.id = n.branch_id
        WHERE i.customer_id = ${customerId}::uuid AND n.status = 'APPROVED' AND ${branchOf('n.branch_id')}
        UNION ALL
        SELECT p.paid_on, 3, p.created_at, 'PAYMENT', p.receipt_no, p.id, br.code,
               'Payment received by ' || pm.name || COALESCE(' (' || p.reference || ')', ''), 0, p.amount
        FROM payments p JOIN branches br ON br.id = p.branch_id JOIN payment_modes pm ON pm.code = p.mode
        WHERE p.customer_id = ${customerId}::uuid AND ${branchOf('p.branch_id')}
        UNION ALL
        SELECT (i.cancelled_at AT TIME ZONE 'Asia/Kolkata')::date, 4, i.cancelled_at, 'INVOICE_CANCELLED', i.invoice_no,
               i.id, br.code, 'Invoice cancelled', 0, i.total
        FROM invoices i JOIN branches br ON br.id = i.branch_id
        WHERE i.customer_id = ${customerId}::uuid AND i.status = 'CANCELLED' AND i.cancelled_at IS NOT NULL
          AND ${branchOf('i.branch_id')}
        UNION ALL
        SELECT r.reversed_on, 5, r.created_at, 'PAYMENT_REVERSAL', p.receipt_no, p.id, br.code,
               'Payment reversed: ' || r.reason, p.amount, 0
        FROM payment_reversals r JOIN payments p ON p.id = r.payment_id JOIN branches br ON br.id = p.branch_id
        WHERE p.customer_id = ${customerId}::uuid AND ${branchOf('p.branch_id')}
        UNION ALL
        SELECT f.paid_on, 6, f.created_at, 'REFUND', f.refund_no, f.id, br.code,
               'Refund paid by ' || pm.name || COALESCE(' (' || f.reference || ')', ''), f.amount, 0
        FROM customer_refunds f JOIN branches br ON br.id = f.branch_id JOIN payment_modes pm ON pm.code = f.mode
        WHERE f.customer_id = ${customerId}::uuid AND ${branchOf('f.branch_id')}
      ) e`;
    const running = Prisma.sql`
      SELECT e.*, SUM(e.debit - e.credit) OVER (
               ORDER BY e.entry_date, e.ord, e.at, e.doc_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             ) AS running
      FROM (${entries}) e`;
    const from = query.from ? Prisma.sql`r.entry_date >= ${query.from}::date` : Prisma.sql`TRUE`;
    const to = query.to ? Prisma.sql`r.entry_date <= ${query.to}::date` : Prisma.sql`TRUE`;
    const { skip, take } = toSkipTake(query);

    return this.transactions.run(async (tx) => {
      const customer = await tx.customer.findUnique({
        where: { id: customerId },
        select: { id: true, name: true },
      });
      if (!customer) throw new NotFoundError('Customer', customerId);
      const [rows, counts, balance] = await Promise.all([
        tx.$queryRaw<LedgerRow[]>(Prisma.sql`
          SELECT to_char(r.entry_date, 'YYYY-MM-DD') AS entry_date, r.type, r.doc_no, r.doc_id, r.branch_code,
                 r.description, round(r.debit, 2)::text AS debit, round(r.credit, 2)::text AS credit,
                 round(r.running, 2)::text AS balance
          FROM (${running}) r WHERE ${from} AND ${to}
          ORDER BY r.entry_date ${direction(query.sortOrder)}, r.ord ${direction(query.sortOrder)},
                   r.at ${direction(query.sortOrder)}, r.doc_id ${direction(query.sortOrder)}
          LIMIT ${take} OFFSET ${skip}`),
        tx.$queryRaw<{ total: bigint }[]>(
          Prisma.sql`SELECT COUNT(*) AS total FROM (${running}) r WHERE ${from} AND ${to}`,
        ),
        tx.$queryRaw<{ balance: Prisma.Decimal | null }[]>(
          Prisma.sql`SELECT SUM(e.debit - e.credit) AS balance FROM (${entries}) e`,
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
            debit: row.debit,
            credit: row.credit,
            balance: row.balance,
          })),
          Number(counts[0]?.total ?? 0),
          query,
        ),
        customerId: customer.id,
        customerName: customer.name,
        balance: fixed(balance[0]?.balance ?? null),
      };
    });
  }
}
