// Runs the daily reminders once, so the notification inbox is already filled for the demo.
import pg from 'pg';
import { pino } from 'pino';
import { runReminders } from '../../apps/worker/src/jobs/reminders.js';

async function main(): Promise<void> {
  const url = process.env['WORKER_DATABASE_URL'];
  if (!url)
    throw new Error('Set WORKER_DATABASE_URL (the worker connection of the demo database).');
  const pool = new pg.Pool({ connectionString: url, max: 2 });
  try {
    const result = await runReminders(pool, pino({ level: 'silent' }), { channels: [] });
    const kinds = Object.entries(result.byKind)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ');
    process.stdout.write(`Reminders: ${result.created} notifications created (${kinds})\n`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
