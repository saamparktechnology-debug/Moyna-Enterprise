import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOwnerPrisma, createWorld } from '../support/fixtures.js';
import type { World } from '../support/fixtures.js';
import { connectOwner, sqlState } from '../support/pg.js';

const CHECK = '23514';
const UNIQUE = '23505';
const FOREIGN_KEY = '23503';
const BAD_ENUM = '22P02';

describe('database constraints reject bad data', () => {
  let db: pg.Client;
  let w: World;

  beforeAll(async () => {
    const prisma = createOwnerPrisma();
    w = await createWorld(prisma);
    await prisma.$disconnect();
    db = await connectOwner();
    return async () => {
      await db.end();
    };
  });

  const run = (sql: string, params: unknown[] = []): Promise<string> =>
    sqlState(db.query(sql, params));

  describe('stock', () => {
    it('rejects a negative balance', async () => {
      expect(
        await run('UPDATE stock_balances SET quantity = -1 WHERE branch_id = $1', [w.branchA]),
      ).toBe(CHECK);
    });

    it('rejects a second balance row for the same branch, item and state', async () => {
      expect(
        await run(
          "INSERT INTO stock_balances (branch_id, item_id, state, quantity) VALUES ($1, $2, 'AVAILABLE', 1)",
          [w.branchA, w.itemId],
        ),
      ).toBe(UNIQUE);
    });

    it('rejects an invalid stock state', async () => {
      expect(
        await run(
          "INSERT INTO stock_balances (branch_id, item_id, state, quantity) VALUES ($1, $2, 'LOST', 1)",
          [w.branchA, w.itemId],
        ),
      ).toBe(BAD_ENUM);
    });

    it('rejects a ledger row that moves nothing, or moves a serial unit by more than one', async () => {
      const insert =
        'INSERT INTO stock_ledger (branch_id, item_id, serial_unit_id, state, qty_delta, movement_type) VALUES ($1, $2, $3, $4, $5, $6)';
      expect(await run(insert, [w.branchA, w.itemId, null, 'AVAILABLE', 0, 'ADJUSTMENT_IN'])).toBe(
        CHECK,
      );
      expect(
        await run(insert, [w.branchA, w.itemId, w.serialA, 'AVAILABLE', 2, 'ADJUSTMENT_IN']),
      ).toBe(CHECK);
      expect(
        await run(insert, [w.branchA, w.itemId, w.serialA, 'AVAILABLE', 1, 'ADJUSTMENT_IN']),
      ).toBe('OK');
    });

    it('rejects an invalid movement type', async () => {
      expect(
        await run(
          "INSERT INTO stock_ledger (branch_id, item_id, state, qty_delta, movement_type) VALUES ($1, $2, 'AVAILABLE', 1, 'TELEPORT')",
          [w.branchA, w.itemId],
        ),
      ).toBe(BAD_ENUM);
    });
  });

  describe('identifiers', () => {
    it('rejects a duplicate barcode', async () => {
      expect(
        await run("INSERT INTO item_barcodes (item_id, barcode) VALUES ($1, 'BC-1')", [w.itemId]),
      ).toBe('OK');
      expect(
        await run("INSERT INTO item_barcodes (item_id, barcode) VALUES ($1, 'BC-1')", [w.itemId]),
      ).toBe(UNIQUE);
    });

    it('rejects a duplicate serial number, even in another branch', async () => {
      expect(
        await run(
          "INSERT INTO serial_units (branch_id, item_id, serial_no) VALUES ($1, $2, 'SN-A-1')",
          [w.branchB, w.itemId],
        ),
      ).toBe(UNIQUE);
    });

    it('rejects a duplicate chassis number but allows many units without one', async () => {
      const insert =
        'INSERT INTO serial_units (branch_id, item_id, serial_no, chassis_no) VALUES ($1, $2, $3, $4)';
      expect(await run(insert, [w.branchA, w.itemId, 'SN-C-1', 'CH-1'])).toBe('OK');
      expect(await run(insert, [w.branchA, w.itemId, 'SN-C-2', 'CH-1'])).toBe(UNIQUE);
      expect(await run(insert, [w.branchA, w.itemId, 'SN-C-3', null])).toBe('OK');
      expect(await run(insert, [w.branchA, w.itemId, 'SN-C-4', null])).toBe('OK');
    });

    it('rejects usernames and emails that differ only by case', async () => {
      const insert =
        "INSERT INTO users (username, email, full_name, password_hash) VALUES ($1, $2, 'x', 'x')";
      expect(await run(insert, ['SUPER', 'other@example.com'])).toBe(UNIQUE);
      expect(await run(insert, ['someone', 'SUPER@example.com'])).toBe(UNIQUE);
    });

    it('rejects a duplicate document number in a branch but allows it in another branch', async () => {
      const po =
        'INSERT INTO purchase_orders (branch_id, po_no, supplier_id, order_date) VALUES ($1, $2, $3, CURRENT_DATE)';
      expect(await run(po, [w.branchA, 'PO-1', w.supplierId])).toBe('OK');
      expect(await run(po, [w.branchA, 'PO-1', w.supplierId])).toBe(UNIQUE);
      expect(await run(po, [w.branchB, 'PO-1', w.supplierId])).toBe('OK');
    });

    it('keeps GST and non-GST invoice series separate but unique within a series', async () => {
      const invoice =
        "INSERT INTO invoices (branch_id, customer_id, type, invoice_no, status) VALUES ($1, $2, $3::\"InvoiceType\", 'N-1', 'ISSUED')";
      expect(await run(invoice, [w.branchA, w.customerId, 'NON_GST'])).toBe('OK');
      expect(await run(invoice, [w.branchA, w.customerId, 'NON_GST'])).toBe(UNIQUE);
      expect(
        await run(
          "INSERT INTO invoices (branch_id, customer_id, type, invoice_no, status, place_of_supply) VALUES ($1, $2, 'GST', 'N-1', 'ISSUED', '27')",
          [w.branchA, w.customerId],
        ),
      ).toBe('OK');
    });

    it('rejects a second number sequence for the same branch, type and year', async () => {
      const insert =
        "INSERT INTO document_sequences (branch_id, doc_type, financial_year, prefix) VALUES ($1, 'QUOTATION', '2026-27', 'AAQT')";
      expect(await run(insert, [w.branchA])).toBe('OK');
      expect(await run(insert, [w.branchA])).toBe(UNIQUE);
      expect(
        await run('UPDATE document_sequences SET next_number = 0 WHERE branch_id = $1', [
          w.branchA,
        ]),
      ).toBe(CHECK);
    });
  });

  describe('invoices and money', () => {
    const base =
      'INSERT INTO invoices (branch_id, customer_id, type, status, invoice_no, place_of_supply, total, cgst_amount, sgst_amount, igst_amount) VALUES ($1, $2, $3::"InvoiceType", $4::"InvoiceStatus", $5, $6, $7, $8, $9, $10)';
    const insert = (
      w2: World,
      over: Partial<
        Record<
          'type' | 'status' | 'no' | 'pos' | 'total' | 'cgst' | 'sgst' | 'igst',
          string | number | null
        >
      >,
    ) => [
      w2.branchA,
      w2.customerId,
      over.type ?? 'GST',
      over.status ?? 'DRAFT',
      over.no ?? null,
      over.pos ?? null,
      // An invoice's total is its tax unless a test says otherwise, so the database's arithmetic check is not what fails.
      over.total ?? Number(over.cgst ?? 0) + Number(over.sgst ?? 0) + Number(over.igst ?? 0),
      over.cgst ?? 0,
      over.sgst ?? 0,
      over.igst ?? 0,
    ];

    it('rejects an issued invoice with no number', async () => {
      expect(await run(base, insert(w, { status: 'ISSUED', pos: '27' }))).toBe(CHECK);
    });

    it('rejects an issued GST invoice with no place of supply', async () => {
      expect(await run(base, insert(w, { status: 'ISSUED', no: 'G-9' }))).toBe(CHECK);
    });

    it('rejects tax on a non-GST invoice', async () => {
      expect(await run(base, insert(w, { type: 'NON_GST', cgst: 1 }))).toBe(CHECK);
    });

    it('rejects an invoice that charges IGST together with CGST or SGST', async () => {
      expect(await run(base, insert(w, { igst: 5, cgst: 2 }))).toBe(CHECK);
      expect(await run(base, insert(w, { igst: 5, sgst: 2 }))).toBe(CHECK);
      expect(await run(base, insert(w, { igst: 5 }))).toBe('OK');
    });

    it('rejects a negative total and an invalid invoice status', async () => {
      expect(await run(base, insert(w, { total: -1 }))).toBe(CHECK);
      expect(await run(base, insert(w, { status: 'PAID' }))).toBe(BAD_ENUM);
    });

    it('rejects zero or negative payments, credit notes and supplier payments', async () => {
      const payment =
        "INSERT INTO payments (branch_id, receipt_no, customer_id, mode, amount, paid_on) VALUES ($1, 'R-1', $2, 'CASH', $3, CURRENT_DATE)";
      expect(await run(payment, [w.branchA, w.customerId, 0])).toBe(CHECK);
      expect(await run(payment, [w.branchA, w.customerId, -5])).toBe(CHECK);
      expect(await run(payment, [w.branchA, w.customerId, 5])).toBe('OK');
      expect(
        await run(
          "INSERT INTO credit_notes (branch_id, credit_note_no, invoice_id, reason, amount) VALUES ($1, 'C-1', $2, 'x', 0)",
          [w.branchA, w.invoiceA],
        ),
      ).toBe(CHECK);
      expect(
        await run(
          "INSERT INTO supplier_payments (branch_id, supplier_id, amount, paid_on, mode) VALUES ($1, $2, -1, CURRENT_DATE, 'CASH')",
          [w.branchA, w.supplierId],
        ),
      ).toBe(CHECK);
    });

    it('rejects an invoice line with zero quantity, or a serial item sold more than once', async () => {
      const line =
        'INSERT INTO invoice_lines (branch_id, invoice_id, item_id, serial_unit_id, qty, amount, unit_price, taxable_amount) VALUES ($1, $2, $3, $4, $5, 1, 1, 1)';
      expect(await run(line, [w.branchA, w.invoiceA, w.itemId, null, 0])).toBe(CHECK);
      expect(await run(line, [w.branchA, w.invoiceA, w.itemId, w.serialA, 2])).toBe(CHECK);
    });

    it('rejects an exchange of a unit for itself', async () => {
      expect(
        await run(
          'INSERT INTO exchanges (branch_id, invoice_id, old_serial_unit_id, new_serial_unit_id, difference_amount) VALUES ($1, $2, $3, $3, 0)',
          [w.branchA, w.invoiceA, w.serialA],
        ),
      ).toBe(CHECK);
    });
  });

  describe('purchasing and transfers', () => {
    it('rejects a purchase line with zero quantity or a negative cost', async () => {
      const po = await db.query(
        "INSERT INTO purchase_orders (branch_id, po_no, supplier_id, order_date) VALUES ($1, 'PO-L', $2, CURRENT_DATE) RETURNING id",
        [w.branchA, w.supplierId],
      );
      const line =
        'INSERT INTO po_lines (branch_id, po_id, item_id, qty_ordered, unit_cost) VALUES ($1, $2, $3, $4, $5)';
      expect(await run(line, [w.branchA, po.rows[0].id, w.itemId, 0, 10])).toBe(CHECK);
      expect(await run(line, [w.branchA, po.rows[0].id, w.itemId, 1, -1])).toBe(CHECK);
      expect(await run(line, [w.branchA, po.rows[0].id, w.itemId, 1, 10])).toBe('OK');
    });

    it('rejects a receipt line that accepts more than it received', async () => {
      const grn = await db.query(
        "INSERT INTO goods_receipts (branch_id, grn_no, received_by, received_at) VALUES ($1, 'G-1', $2, now()) RETURNING id",
        [w.branchA, w.userA],
      );
      const line =
        'INSERT INTO receipt_lines (branch_id, receipt_id, item_id, qty_received, qty_accepted) VALUES ($1, $2, $3, $4, $5)';
      expect(await run(line, [w.branchA, grn.rows[0].id, w.itemId, 3, 4])).toBe(CHECK);
      expect(await run(line, [w.branchA, grn.rows[0].id, w.itemId, 3, 3])).toBe('OK');
    });

    it('rejects a transfer from a branch to itself and a transfer line that sends nothing', async () => {
      expect(
        await run(
          "INSERT INTO transfers (transfer_no, from_branch_id, to_branch_id) VALUES ('T-X', $1, $1)",
          [w.branchA],
        ),
      ).toBe(CHECK);
      expect(
        await run(
          'INSERT INTO transfer_lines (transfer_id, item_id, qty_requested, qty_sent, from_branch_id, to_branch_id) VALUES ($1, $2, 1, 0, $3, $4)',
          [w.transferAB, w.itemId, w.branchA, w.branchB],
        ),
      ).toBe(CHECK);
    });

    it('rejects an invalid transfer status', async () => {
      expect(await run("UPDATE transfers SET status = 'LOST' WHERE id = $1", [w.transferAB])).toBe(
        BAD_ENUM,
      );
    });

    it('requires a discrepancy to point at exactly one line, with a positive quantity', async () => {
      const grn = await db.query(
        "INSERT INTO goods_receipts (branch_id, grn_no, received_by, received_at) VALUES ($1, 'G-2', $2, now()) RETURNING id",
        [w.branchA, w.userA],
      );
      const rl = await db.query(
        'INSERT INTO receipt_lines (branch_id, receipt_id, item_id, qty_received, qty_accepted) VALUES ($1, $2, $3, 1, 0) RETURNING id',
        [w.branchA, grn.rows[0].id, w.itemId],
      );
      const tl = await db.query('SELECT id FROM transfer_lines LIMIT 1');
      const insert =
        "INSERT INTO discrepancies (branch_id, receipt_line_id, transfer_line_id, type, qty) VALUES ($1, $2, $3, 'SHORT', $4)";
      expect(await run(insert, [w.branchA, null, null, 1])).toBe(CHECK);
      expect(await run(insert, [w.branchA, rl.rows[0].id, tl.rows[0].id, 1])).toBe(CHECK);
      expect(await run(insert, [w.branchA, rl.rows[0].id, null, 0])).toBe(CHECK);
      expect(await run(insert, [w.branchA, rl.rows[0].id, null, 2])).toBe('OK');
      expect(
        await run("UPDATE discrepancies SET status = 'RESOLVED' WHERE receipt_line_id = $1", [
          rl.rows[0].id,
        ]),
      ).toBe(CHECK);
    });
  });

  describe('batteries, HR and commission', () => {
    it('rejects a battery that expires before it was made, or has a negative warranty', async () => {
      expect(
        await run("UPDATE batteries SET expiry_on = '2025-01-01' WHERE serial_unit_id = $1", [
          w.serialA,
        ]),
      ).toBe(CHECK);
      expect(
        await run('UPDATE batteries SET warranty_months = -1 WHERE serial_unit_id = $1', [
          w.serialA,
        ]),
      ).toBe(CHECK);
    });

    it('rejects reversed leave dates, a check-out before check-in, a bad payroll month and net above gross', async () => {
      const staff = await db.query(
        "INSERT INTO staff (branch_id, user_id, join_date, employee_code, monthly_salary) VALUES ($1, $2, '2026-01-01', 'EMP-CHECK-1', 0) RETURNING id",
        [w.branchA, w.userA],
      );
      const staffId = staff.rows[0].id;
      expect(
        await run(
          "INSERT INTO leave_requests (branch_id, staff_id, from_date, to_date, kind) VALUES ($1, $2, '2026-10-10', '2026-10-09', 'PAID')",
          [w.branchA, staffId],
        ),
      ).toBe(CHECK);
      expect(
        await run(
          "INSERT INTO attendance (branch_id, staff_id, work_date, check_in, check_out) VALUES ($1, $2, CURRENT_DATE, '2026-10-01 10:00', '2026-10-01 09:00')",
          [w.branchA, staffId],
        ),
      ).toBe(CHECK);
      expect(
        await run(
          "INSERT INTO payroll_records (branch_id, staff_id, month, gross, net, monthly_salary, days_in_month, days_employed, days_present, paid_leave_days, unpaid_leave_days) VALUES ($1, $2, '2026-13', 10, 5, 10, 31, 31, 0, 0, 0)",
          [w.branchA, staffId],
        ),
      ).toBe(CHECK);
      expect(
        await run(
          "INSERT INTO payroll_records (branch_id, staff_id, month, gross, net, monthly_salary, days_in_month, days_employed, days_present, paid_leave_days, unpaid_leave_days) VALUES ($1, $2, '2026-10', 10, 11, 10, 31, 31, 0, 0, 0)",
          [w.branchA, staffId],
        ),
      ).toBe(CHECK);
      expect(
        await run(
          "INSERT INTO payroll_records (branch_id, staff_id, month, gross, net, deductions, monthly_salary, days_in_month, days_employed, days_present, paid_leave_days, unpaid_leave_days) VALUES ($1, $2, '2026-10', 10, 9, 1, 10, 31, 31, 0, 0, 0)",
          [w.branchA, staffId],
        ),
      ).toBe('OK');
      expect(
        await run(
          'INSERT INTO attendance (branch_id, staff_id, work_date) VALUES ($1, $2, CURRENT_DATE)',
          [w.branchA, staffId],
        ),
      ).toBe('OK');
      expect(
        await run(
          'INSERT INTO attendance (branch_id, staff_id, work_date) VALUES ($1, $2, CURRENT_DATE)',
          [w.branchA, staffId],
        ),
      ).toBe(UNIQUE);
    });

    it('rejects a percentage commission above 100 and a negative fixed commission', async () => {
      const broker = await db.query("INSERT INTO brokers (name) VALUES ('B') RETURNING id");
      const insert =
        'INSERT INTO commission_rules (broker_id, type, value) VALUES ($1, $2::"CommissionRuleType", $3)';
      expect(await run(insert, [broker.rows[0].id, 'PERCENT', 150])).toBe(CHECK);
      expect(await run(insert, [broker.rows[0].id, 'FIXED', -1])).toBe(CHECK);
      expect(await run(insert, [broker.rows[0].id, 'PERCENT', 0])).toBe(CHECK);
      expect(await run(insert, [broker.rows[0].id, 'PERCENT', 12.5])).toBe('OK');
      // A broker has one live rule at a time; a second needs the first to be retired.
      expect(await run(insert, [broker.rows[0].id, 'FIXED', 5000])).toBe(UNIQUE);
      const other = await db.query("INSERT INTO brokers (name) VALUES ('B2') RETURNING id");
      expect(await run(insert, [other.rows[0].id, 'FIXED', 5000])).toBe('OK');
    });
  });

  describe('branches', () => {
    const insert = 'INSERT INTO branches (code, name, state_code, gstin) VALUES ($1, $2, $3, $4)';

    it('requires a 2 to 4 character code of capital letters and digits', async () => {
      for (const code of ['A', 'ABCDE', 'ab', 'A-B', 'A B', ''])
        expect(await run(insert, [code, 'Name', '27', null]), code).toBe(CHECK);
      for (const code of ['AB', 'A1', '9Z9', 'ABCD'])
        expect(await run(insert, [code, 'Name', '27', null]), code).toBe('OK');
    });

    it('requires a name that is not blank', async () => {
      expect(await run(insert, ['NB1', '   ', '27', null])).toBe(CHECK);
    });

    it('requires a GSTIN to have the official layout and to start with the state code', async () => {
      expect(await run(insert, ['GS1', 'Name', '27', 'NOTAGSTIN'])).toBe(CHECK);
      expect(await run(insert, ['GS2', 'Name', '27', '27aapfu0939f1zv'])).toBe(CHECK);
      expect(await run(insert, ['GS3', 'Name', '29', '27AAPFU0939F1ZV'])).toBe(CHECK);
      expect(await run(insert, ['GS4', 'Name', '27', '27AAPFU0939F1ZV'])).toBe('OK');
      expect(await run(insert, ['GS5', 'Name', '27', null])).toBe('OK');
    });

    it('keeps the state and GSTIN consistent when only one is changed later', async () => {
      expect(await run("UPDATE branches SET state_code = '29' WHERE code = 'GS4'")).toBe(CHECK);
    });
  });

  describe('references', () => {
    it('rejects rows that point at something that does not exist', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      expect(
        await run(
          "INSERT INTO invoices (branch_id, customer_id, type) VALUES ($1, $2, 'NON_GST')",
          [w.branchA, missing],
        ),
      ).toBe(FOREIGN_KEY);
      expect(
        await run(
          "INSERT INTO items (item_code, name, category_id, unit_code, hsn_code) SELECT 'Z', 'Z', id, 'PCS', '0000' FROM item_categories LIMIT 1",
        ),
      ).toBe(FOREIGN_KEY);
      expect(
        await run(
          "INSERT INTO items (item_code, name, category_id, unit_code, tax_rate) SELECT 'Z2', 'Z', id, 'PCS', 12 FROM item_categories LIMIT 1",
        ),
      ).toBe(FOREIGN_KEY);
    });

    it('refuses to delete a branch or customer that has records', async () => {
      expect(await run('DELETE FROM branches WHERE id = $1', [w.branchA])).toBe(FOREIGN_KEY);
      expect(await run('DELETE FROM customers WHERE id = $1', [w.customerId])).toBe(FOREIGN_KEY);
    });

    it('rejects an expired-before-created session', async () => {
      expect(
        await run(
          "INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, 'constraint-test-hash', now() - interval '1 hour')",
          [w.userA],
        ),
      ).toBe(CHECK);
    });
  });

  describe('row_version', () => {
    it('increases on every update and refreshes updated_at', async () => {
      const before = await db.query('SELECT row_version, updated_at FROM invoices WHERE id = $1', [
        w.invoiceA,
      ]);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await db.query("UPDATE invoices SET due_date = '2026-12-31' WHERE id = $1", [w.invoiceA]);
      await db.query("UPDATE invoices SET due_date = '2026-12-30' WHERE id = $1", [w.invoiceA]);
      const after = await db.query('SELECT row_version, updated_at FROM invoices WHERE id = $1', [
        w.invoiceA,
      ]);
      expect(after.rows[0].row_version).toBe(before.rows[0].row_version + 2);
      expect(after.rows[0].updated_at.getTime()).toBeGreaterThan(
        before.rows[0].updated_at.getTime(),
      );
    });

    it('cannot be set backwards by an update', async () => {
      await db.query('UPDATE invoices SET row_version = 1 WHERE id = $1', [w.invoiceB]);
      const row = await db.query('SELECT row_version FROM invoices WHERE id = $1', [w.invoiceB]);
      expect(row.rows[0].row_version).toBe(2);
    });
  });
});
