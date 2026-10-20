import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Indexes that migration 2 adds with SQL because Prisma cannot model them (partial or expression indexes).
// Prisma sees them as extra and proposes dropping them; that is expected and must never be applied.
const UNMODELLED_INDEXES = new Set([
  'exchanges_old_unit_open_key',
  'exchanges_new_unit_open_key',
  'commission_rules_one_active_key',
  'users_username_lower_key',
  'users_email_lower_key',
  'serial_units_available_idx',
  'discrepancies_open_idx',
  'notifications_unread_idx',
  'outbox_events_pending_idx',
  'audit_log_failed_login_idx',
  'item_categories_sibling_name_key',
  'customers_name_trgm_idx',
  'customers_phone_trgm_idx',
  'items_item_code_trgm_idx',
  'items_name_trgm_idx',
  'serial_units_serial_no_trgm_idx',
  'invoices_invoice_no_trgm_idx',
]);

export function findUnexpectedChanges(script) {
  return script
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'))
    .filter((line) => {
      const dropped = /^DROP INDEX "(?:public"\."|)([^"]+)";$/.exec(line);
      return !(dropped && UNMODELLED_INDEXES.has(dropped[1]));
    });
}

function main() {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error('MIGRATION_DATABASE_URL is not set. Copy .env.example to .env first.');
  const cli = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const script = execFileSync(
    process.execPath,
    [
      cli,
      'migrate',
      'diff',
      '--from-config-datasource',
      '--to-schema',
      'prisma/schema.prisma',
      '--script',
    ],
    { encoding: 'utf8', env: process.env },
  );
  const unexpected = findUnexpectedChanges(script);
  if (unexpected.length > 0) {
    process.stderr.write(
      `The database differs from prisma/schema.prisma:\n${unexpected.map((line) => `  ${line}`).join('\n')}\n`,
    );
    process.exit(1);
  }
  process.stdout.write('No drift: the migrated database matches prisma/schema.prisma.\n');
}

if (
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('check-schema-drift.mjs')
)
  main();
