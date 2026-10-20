import { Prisma } from '@prisma/client';
import type { DueInvoice, DueStatusName } from '@erp/contracts';
import { daysBetween } from '@erp/contracts';

/** One row per issued invoice, as the database worked it out. Money and dates come back as text. */
export interface BalanceRow {
  invoice_id: string;
  invoice_no: string | null;
  type: 'GST' | 'NON_GST';
  branch_id: string;
  branch_code: string;
  customer_id: string;
  customer_name: string;
  issued_on: string | null;
  due_date: string | null;
  total: string;
  credited: string;
  paid: string;
  outstanding: string;
  surplus: string;
}

/**
 * What every issued invoice is worth, what has been credited against it and what has been paid. Credit notes count
 * once approved; a payment counts until it is reversed. The caller's branch scope applies, because the query runs in the
 * caller's transaction. `filter` narrows the invoices (use `TRUE` for all of them).
 */
export function balancesSql(filter: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    SELECT i.id AS invoice_id, i.invoice_no, i.type::text AS type, i.branch_id, br.code AS branch_code,
           i.customer_id, cu.name AS customer_name,
           to_char(i.issued_on, 'YYYY-MM-DD') AS issued_on, to_char(i.due_date, 'YYYY-MM-DD') AS due_date,
           i.due_date AS due_date_value, i.issued_on AS issued_on_value,
           round(i.total, 2)::text AS total,
           round(COALESCE(c.credited, 0), 2)::text AS credited,
           round(COALESCE(p.paid, 0), 2)::text AS paid,
           round(GREATEST(i.total - COALESCE(c.credited, 0) - COALESCE(p.paid, 0), 0), 2)::text AS outstanding,
           round(GREATEST(COALESCE(p.paid, 0) + COALESCE(c.credited, 0) - i.total, 0), 2)::text AS surplus,
           GREATEST(i.total - COALESCE(c.credited, 0) - COALESCE(p.paid, 0), 0) AS outstanding_value,
           GREATEST(COALESCE(p.paid, 0) + COALESCE(c.credited, 0) - i.total, 0) AS surplus_value
    FROM invoices i
    JOIN branches br ON br.id = i.branch_id
    JOIN customers cu ON cu.id = i.customer_id
    LEFT JOIN LATERAL (
      SELECT SUM(n.amount) AS credited FROM credit_notes n
      WHERE n.invoice_id = i.id AND n.status = 'APPROVED'
    ) c ON TRUE
    LEFT JOIN LATERAL (
      SELECT SUM(a.amount) AS paid FROM payment_allocations a
      WHERE a.invoice_id = i.id
        AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = a.payment_id)
    ) p ON TRUE
    WHERE i.status = 'ISSUED' AND (${filter})`;
}

export function dueStatus(row: Pick<BalanceRow, 'paid' | 'outstanding'>): DueStatusName {
  if (Number(row.outstanding) === 0) return 'PAID';
  return Number(row.paid) > 0 ? 'PARTIAL' : 'UNPAID';
}

export function toDueInvoice(row: BalanceRow, today: string): DueInvoice {
  const owing = Number(row.outstanding) > 0;
  const overdue = owing && row.due_date !== null && row.due_date < today;
  return {
    invoiceId: row.invoice_id,
    invoiceNo: row.invoice_no,
    type: row.type,
    branchId: row.branch_id,
    branchCode: row.branch_code,
    customerId: row.customer_id,
    customerName: row.customer_name,
    issuedOn: row.issued_on,
    dueDate: row.due_date,
    total: row.total,
    credited: row.credited,
    paid: row.paid,
    outstanding: row.outstanding,
    surplus: row.surplus,
    status: dueStatus(row),
    overdue,
    overdueDays: overdue && row.due_date ? daysBetween(row.due_date, today) : 0,
  };
}
