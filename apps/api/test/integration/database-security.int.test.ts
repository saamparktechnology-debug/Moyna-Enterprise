import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { beforeAll, describe, expect, it } from 'vitest';
import { createOwnerPrisma, createWorld } from '../support/fixtures.js';
import type { World } from '../support/fixtures.js';
import { connectApp, connectOwner, connectWorker, setSession, sqlState } from '../support/pg.js';

const DENIED = '42501';

describe('database privileges and row-level security', () => {
  let owner: pg.Client;
  let app: pg.Client;
  let worker: pg.Client;
  let w: World;

  beforeAll(async () => {
    const prisma = createOwnerPrisma();
    w = await createWorld(prisma);
    await prisma.$disconnect();
    [owner, app, worker] = [await connectOwner(), await connectApp(), await connectWorker()];
    await owner.query(
      "INSERT INTO stock_ledger (branch_id, item_id, state, qty_delta, movement_type) VALUES ($1, $2, 'AVAILABLE', 5, 'OPENING_BALANCE')",
      [w.branchA, w.itemId],
    );
    await owner.query(
      "INSERT INTO outbox_events (event_type, payload) VALUES ('test.event', '{}')",
    );
    return async () => {
      await Promise.all([owner.end(), app.end(), worker.end()]);
    };
  });

  const count = async (client: pg.Client, table: string): Promise<number> =>
    (await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n;

  describe('append-only tables for the application user', () => {
    it.each(['audit_log', 'stock_ledger'])(
      'lets the application insert into %s but never update, delete or truncate it',
      async (table) => {
        await setSession(app, { branchIds: [w.branchA] });
        const insert =
          table === 'audit_log'
            ? app.query(
                "INSERT INTO audit_log (action, entity_type, branch_id) VALUES ('X', 'Y', $1)",
                [w.branchA],
              )
            : app.query(
                "INSERT INTO stock_ledger (branch_id, item_id, state, qty_delta, movement_type) VALUES ($1, $2, 'AVAILABLE', 1, 'ADJUSTMENT_IN')",
                [w.branchA, w.itemId],
              );
        expect(await sqlState(insert)).toBe('OK');

        const column = table === 'audit_log' ? 'action' : 'qty_delta';
        const value = table === 'audit_log' ? "'tampered'" : '99';
        expect(await sqlState(app.query(`UPDATE ${table} SET ${column} = ${value}`))).toBe(DENIED);
        expect(await sqlState(app.query(`DELETE FROM ${table}`))).toBe(DENIED);
        expect(await sqlState(app.query(`TRUNCATE ${table}`))).toBe(DENIED);
      },
    );

    it('lets the application add outbox events but not read, change or remove them', async () => {
      const insert = app.query(
        "INSERT INTO outbox_events (event_type, payload) VALUES ('invoice.issued', '{}')",
      );
      expect(await sqlState(insert)).toBe('OK');
      expect(await sqlState(app.query('SELECT * FROM outbox_events'))).toBe(DENIED);
      expect(await sqlState(app.query("UPDATE outbox_events SET status = 'PROCESSED'"))).toBe(
        DENIED,
      );
      expect(await sqlState(app.query('DELETE FROM outbox_events'))).toBe(DENIED);
    });

    it('does not let the application delete business records, but allows removing sessions and link rows', async () => {
      for (const table of ['invoices', 'stock_balances', 'payments', 'customers']) {
        expect(await sqlState(app.query(`DELETE FROM ${table}`)), table).toBe(DENIED);
      }
      expect(await sqlState(app.query('DELETE FROM sessions'))).toBe('OK');
      expect(await sqlState(app.query('DELETE FROM user_roles'))).toBe('OK');
    });

    it('does not let the application change the schema', async () => {
      expect(await sqlState(app.query('DROP TABLE audit_log'))).toBe('42501');
      expect(await sqlState(app.query('ALTER TABLE invoices DISABLE ROW LEVEL SECURITY'))).toBe(
        '42501',
      );
    });
  });

  describe('the worker role', () => {
    it('can read outbox events and change only their processing columns', async () => {
      const event = (
        await worker.query<{ id: string }>(
          "SELECT id FROM outbox_events WHERE event_type = 'test.event'",
        )
      ).rows[0]!.id;
      expect(
        await sqlState(
          worker.query(
            "UPDATE outbox_events SET status = 'PROCESSED', processed_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1",
            [event],
          ),
        ),
      ).toBe('OK');
      expect(
        await sqlState(
          worker.query("UPDATE outbox_events SET event_type = 'tampered' WHERE id = $1", [event]),
        ),
      ).toBe(DENIED);
      expect(
        await sqlState(
          worker.query('UPDATE outbox_events SET payload = \'{"x":1}\' WHERE id = $1', [event]),
        ),
      ).toBe(DENIED);
      expect(await sqlState(worker.query('DELETE FROM outbox_events'))).toBe(DENIED);
      expect(
        await sqlState(
          worker.query("INSERT INTO outbox_events (event_type, payload) VALUES ('forged', '{}')"),
        ),
      ).toBe(DENIED);
    });

    it('cannot read business data', async () => {
      expect(await sqlState(worker.query('SELECT * FROM invoices'))).toBe(DENIED);
      expect(await sqlState(worker.query('SELECT * FROM users'))).toBe(DENIED);
    });
  });

  describe('branch isolation in the database', () => {
    it('shows nothing without a branch context, while the table owner sees everything', async () => {
      await setSession(app, {});
      expect(await count(app, 'invoices')).toBe(0);
      expect(await count(owner, 'invoices')).toBe(2);
    });

    it('shows a user only the rows of their own branches', async () => {
      await setSession(app, { branchIds: [w.branchA] });
      expect((await app.query('SELECT id FROM invoices')).rows.map((r) => r.id)).toEqual([
        w.invoiceA,
      ]);
      await setSession(app, { branchIds: [w.branchB] });
      expect((await app.query('SELECT id FROM invoices')).rows.map((r) => r.id)).toEqual([
        w.invoiceB,
      ]);
      await setSession(app, { branchIds: [w.branchA, w.branchB] });
      expect(await count(app, 'invoices')).toBe(2);
      await setSession(app, { branchIds: [w.branchC] });
      expect(await count(app, 'invoices')).toBe(0);
    });

    it('shows a Super Admin every branch', async () => {
      await setSession(app, { isSuper: true });
      expect(await count(app, 'invoices')).toBe(2);
    });

    it.each(['invoice_lines', 'stock_balances', 'serial_units', 'document_sequences'])(
      'isolates %s',
      async (table) => {
        await setSession(app, { branchIds: [w.branchB] });
        const rows = (await app.query(`SELECT branch_id FROM ${table}`)).rows;
        expect(rows.every((r) => r.branch_id === w.branchB)).toBe(true);
      },
    );

    it('stops a user inserting or moving rows into a branch they do not have', async () => {
      await setSession(app, { branchIds: [w.branchA] });
      const insert =
        "INSERT INTO invoices (branch_id, customer_id, type) VALUES ($1, $2, 'NON_GST')";
      expect(await sqlState(app.query(insert, [w.branchB, w.customerId]))).toBe(DENIED);
      expect(await sqlState(app.query(insert, [w.branchA, w.customerId]))).toBe('OK');
      expect(
        await sqlState(
          app.query('UPDATE invoices SET branch_id = $1 WHERE id = $2', [w.branchB, w.invoiceA]),
        ),
      ).toBe(DENIED);
    });

    it("does not let a user change or remove another branch's rows", async () => {
      await setSession(app, { branchIds: [w.branchA] });
      const result = await app.query("UPDATE invoices SET due_date = '2030-01-01' WHERE id = $1", [
        w.invoiceB,
      ]);
      expect(result.rowCount).toBe(0);
    });

    it('shows a transfer to both of its branches and to nobody else', async () => {
      const visible = async (branchId: string): Promise<string[]> => {
        await setSession(app, { branchIds: [branchId] });
        return (await app.query('SELECT id FROM transfers')).rows.map((r) => r.id).sort();
      };
      expect(await visible(w.branchA)).toEqual([w.transferAB]);
      expect(await visible(w.branchB)).toEqual([w.transferAB, w.transferBC].sort());
      expect(await visible(w.branchC)).toEqual([w.transferBC]);
      await setSession(app, { branchIds: [w.branchA] });
      expect(await count(app, 'transfer_lines')).toBe(1);
    });

    it('shows a battery only where its serial unit is', async () => {
      await setSession(app, { branchIds: [w.branchA] });
      expect(
        (await app.query('SELECT serial_unit_id FROM batteries')).rows.map((r) => r.serial_unit_id),
      ).toEqual([w.serialA]);
    });

    it('lets a user read only their own notifications, even a Super Admin, yet lets anyone notify anyone', async () => {
      await setSession(app, { userId: w.userA });
      expect(
        (await app.query('SELECT message FROM notifications')).rows.map((r) => r.message),
      ).toEqual(['for A']);
      await setSession(app, { userId: w.userSuper, isSuper: true });
      expect(await count(app, 'notifications')).toBe(0);
      const notify =
        "INSERT INTO notifications (user_id, channel, message) VALUES ($1, 'IN_APP', 'hello')";
      expect(await sqlState(app.query(notify, [w.userB]))).toBe('OK');
      await setSession(app, { userId: w.userB });
      expect(await count(app, 'notifications')).toBe(2);
    });

    it('hides audit rows of other branches and rows without a branch, except from a Super Admin', async () => {
      await setSession(app, { branchIds: [w.branchA] });
      expect(
        (await app.query('SELECT action FROM audit_log')).rows
          .map((r) => r.action)
          .filter((a) => a.startsWith('TEST_')),
      ).toEqual(['TEST_A']);
      await setSession(app, { isSuper: true });
      expect(
        (await app.query("SELECT action FROM audit_log WHERE action LIKE 'TEST\\_%'")).rowCount,
      ).toBe(3);
    });

    it('lets any user append an audit row with no branch (for example a login) without being able to read it back', async () => {
      await setSession(app, { branchIds: [w.branchA] });
      const id = randomUUID();
      expect(
        await sqlState(
          app.query(
            "INSERT INTO audit_log (id, action, entity_type) VALUES ($1, 'LOGIN', 'User')",
            [id],
          ),
        ),
      ).toBe('OK');
      expect((await app.query('SELECT id FROM audit_log WHERE id = $1', [id])).rowCount).toBe(0);
      expect((await owner.query('SELECT id FROM audit_log WHERE id = $1', [id])).rowCount).toBe(1);
    });

    it('treats an empty or unknown branch setting as no access rather than all access', async () => {
      for (const branchIds of [[''], ['not-a-uuid'], [randomUUID()]]) {
        await setSession(app, { branchIds });
        expect(await count(app, 'invoices')).toBe(0);
      }
    });
  });
});
