import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { connect, connectOwner } from '../support/pg.js';
import { TEST_DATABASE_URL } from '../support/test-env.js';

const migrationsDir = join(
  fileURLToPath(new URL('../../../../', import.meta.url)),
  'prisma',
  'migrations',
);

const APPROVED_TABLES = [
  'users',
  'branches',
  'sessions',
  'roles',
  'permissions',
  'role_permissions',
  'user_roles',
  'user_branches',
  'item_categories',
  'items',
  'item_barcodes',
  'serial_units',
  'stock_ledger',
  'stock_balances',
  'batteries',
  'suppliers',
  'purchase_orders',
  'po_lines',
  'supplier_payments',
  'goods_receipts',
  'receipt_lines',
  'transfers',
  'transfer_lines',
  'discrepancies',
  'transfer_events',
  'customers',
  'brokers',
  'kyc_documents',
  'leads',
  'lead_followups',
  'commission_rules',
  'commissions',
  'quotations',
  'invoices',
  'invoice_lines',
  'exchanges',
  'credit_notes',
  'payment_allocations',
  'payments',
  'staff',
  'attendance',
  'leave_requests',
  'payroll_records',
  'audit_log',
  'notifications',
  'outbox_events',
  'approvals',
  'attachments',
];
const ADDED_TABLES = [
  'states',
  'gst_rates',
  'hsn_codes',
  'units_of_measure',
  'payment_modes',
  'lead_sources',
  'kyc_document_types',
  'departments',
  'app_settings',
  'document_sequences',
  'stock_adjustments',
  'purchase_returns',
  'purchase_return_lines',
  'credit_note_lines',
  'payment_reversals',
  'lead_notes',
  'commission_adjustments',
  'quotation_lines',
  'quotation_build_updates',
  'customer_refunds',
];

function migrationFiles(): { name: string; sql: string }[] {
  return readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => ({
      name,
      sql: readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'),
    }));
}

function urlForDatabase(database: string): string {
  const url = new URL(TEST_DATABASE_URL);
  url.pathname = `/${database}`;
  return url.toString();
}

describe('migrations', () => {
  const created: string[] = [];
  let admin: pg.Client;

  beforeAll(async () => {
    admin = await connect(urlForDatabase('postgres'));
    return async () => {
      await admin.end();
    };
  });

  afterEach(async () => {
    while (created.length > 0) {
      await admin.query(`DROP DATABASE IF EXISTS "${created.pop()}" WITH (FORCE)`);
    }
  });

  async function scratchDatabase(): Promise<pg.Client> {
    const name = `erp_mig_${process.pid}_${Date.now()}_${created.length}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    created.push(name);
    return connect(urlForDatabase(name));
  }

  it('has the expected migration files in order', () => {
    expect(migrationFiles().map((file) => file.name)).toEqual([
      '20261007000100_init_schema',
      '20261007000200_constraints_security',
      '20261007000300_auth_columns',
      '20261007000400_branch_constraints',
      '20261007000500_role_tiers',
      '20261007000600_items_barcodes',
      '20261007000700_stock_adjustments',
      '20261007000800_batteries',
      '20261007000900_purchasing',
      '20261007001000_transfers',
      '20261007001100_customers_kyc',
      '20261007001200_invoicing',
      '20261007001300_credit_notes',
      '20261007001400_payments_dues',
      '20261007001500_leads_followups',
      '20261007001600_brokers_commission',
      '20261007001700_quotations',
      '20261007001800_exchanges',
      '20261007001900_staff_hr',
      '20261007002000_customer_refunds',
      '20261007002100_followup_reschedule',
      '20261007002200_dashboard_views',
      '20261007002300_notifications',
      '20261007002400_search_indexes',
      '20261007002500_fix_lead_day',
      '20261007002600_app_settings',
    ]);
  });

  it('applies to an empty database and creates every approved and added table', async () => {
    const db = await scratchDatabase();
    for (const migration of migrationFiles()) await db.query(migration.sql);

    const { rows } = await db.query<{ tablename: string }>(
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1",
    );
    expect(rows.map((row) => row.tablename)).toEqual([...APPROVED_TABLES, ...ADDED_TABLES].sort());
    expect(APPROVED_TABLES).toHaveLength(48);
    await db.end();
  });

  it('applies on top of the previous migration state without losing data', async () => {
    const db = await scratchDatabase();
    const [first, second] = migrationFiles();
    await db.query(first!.sql);
    await db.query("INSERT INTO states (code, name) VALUES ('27', 'Maharashtra')");
    await db.query("INSERT INTO branches (code, name, state_code) VALUES ('AA', 'Branch A', '27')");
    await db.query("INSERT INTO customers (name, phone) VALUES ('Ravi', '9000000001')");
    await db.query(
      `INSERT INTO invoices (branch_id, customer_id, type, total)
       SELECT b.id, c.id, 'NON_GST', 10 FROM branches b, customers c`,
    );

    await db.query(second!.sql);

    expect((await db.query('SELECT count(*)::int AS n FROM invoices')).rows[0].n).toBe(1);
    const rls = await db.query("SELECT relrowsecurity FROM pg_class WHERE relname = 'invoices'");
    expect(rls.rows[0].relrowsecurity).toBe(true);
    await db.end();
  });

  it('refuses to apply over data that already breaks a new constraint, and leaves nothing half-applied', async () => {
    const db = await scratchDatabase();
    const [first, second] = migrationFiles();
    await db.query(first!.sql);
    await db.query("INSERT INTO states (code, name) VALUES ('27', 'Maharashtra')");
    await db.query("INSERT INTO branches (code, name, state_code) VALUES ('AA', 'Branch A', '27')");
    await db.query(
      "INSERT INTO items (item_code, name, category_id, unit_code) SELECT 'X', 'X', NULL, NULL WHERE false",
    );
    await db.query("INSERT INTO units_of_measure (code, name) VALUES ('PCS', 'Pieces')");
    await db.query("INSERT INTO item_categories (name) VALUES ('Cat')");
    await db.query(
      "INSERT INTO items (item_code, name, category_id, unit_code) SELECT 'X', 'X', id, 'PCS' FROM item_categories",
    );
    await db.query(
      "INSERT INTO stock_balances (branch_id, item_id, state, quantity) SELECT b.id, i.id, 'AVAILABLE', -3 FROM branches b, items i",
    );

    await expect(db.query(second!.sql)).rejects.toMatchObject({ code: '23514' });

    const constraints = await db.query(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE 'chk\\_%'",
    );
    expect(constraints.rows[0].n).toBe(0);
    const roles = await db.query('SELECT count(*)::int AS n FROM pg_policies');
    expect(roles.rows[0].n).toBe(0);
    await db.end();
  });

  it('adds the authentication columns to existing users and clears old sessions', async () => {
    const db = await scratchDatabase();
    const [first, second, third] = migrationFiles();
    await db.query(first!.sql);
    await db.query(second!.sql);
    await db.query(
      "INSERT INTO users (username, email, full_name, password_hash) VALUES ('ravi', 'ravi@example.com', 'Ravi', 'hash')",
    );
    await db.query(
      "INSERT INTO sessions (user_id, expires_at) SELECT id, now() + interval '1 hour' FROM users",
    );

    await db.query(third!.sql);

    const user = (
      await db.query(
        'SELECT failed_login_count, locked_until, password_changed_at, must_change_password FROM users',
      )
    ).rows[0];
    expect(user).toEqual({
      failed_login_count: 0,
      locked_until: null,
      password_changed_at: null,
      must_change_password: false,
    });
    expect((await db.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n).toBe(0);
    await expect(db.query('UPDATE users SET failed_login_count = -1')).rejects.toMatchObject({
      code: '23514',
    });
    await db.end();
  });

  it('refuses the branch constraints over a branch whose code or GSTIN breaks them, and changes nothing', async () => {
    const db = await scratchDatabase();
    const files = migrationFiles();
    for (const file of files.slice(0, 3)) await db.query(file.sql);
    await db.query("INSERT INTO states (code, name) VALUES ('27', 'Maharashtra')");
    await db.query(
      "INSERT INTO branches (code, name, state_code) VALUES ('too-long-code', 'Old branch', '27')",
    );

    await expect(db.query(files[3]!.sql)).rejects.toMatchObject({ code: '23514' });

    const left = await db.query(
      "SELECT count(*)::int AS n FROM pg_constraint WHERE conname LIKE 'chk_branches%'",
    );
    expect(left.rows[0].n).toBe(0);
    await db.end();
  });

  it('gives existing roles their tier when role tiers are added, and guards the system roles', async () => {
    const db = await scratchDatabase();
    const files = migrationFiles();
    for (const file of files.slice(0, 4)) await db.query(file.sql);
    await db.query(
      "INSERT INTO roles (name, is_system) VALUES ('SUPER_ADMIN', true), ('ADMIN', true), ('STAFF', true), ('Store Keeper', false)",
    );

    await db.query(files[4]!.sql);

    const tiers = Object.fromEntries(
      (await db.query('SELECT name, tier FROM roles')).rows.map((row) => [row.name, row.tier]),
    );
    expect(tiers).toEqual({
      ADMIN: 'ADMIN',
      STAFF: 'STAFF',
      'Store Keeper': 'STAFF',
      SUPER_ADMIN: 'SUPER_ADMIN',
    });
    await expect(
      db.query("INSERT INTO roles (name, tier) VALUES ('Boss', 'SUPER_ADMIN')"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query("UPDATE roles SET tier = 'STAFF' WHERE name = 'SUPER_ADMIN'"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      db.query("UPDATE roles SET tier = 'STAFF' WHERE name = 'ADMIN'"),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(db.query("INSERT INTO roles (name) VALUES ('No Tier')")).rejects.toMatchObject({
      code: '23502',
    });
    await db.end();
  });

  it('is already applied to the test database', async () => {
    const owner = await connectOwner();
    const { rows } = await owner.query(
      "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(57);
    await owner.end();
  });
});
