import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import pg from 'pg';

const APP_ROLE = 'erp_app';
const WORKER_ROLE = 'erp_worker';
const require = createRequire(import.meta.url);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

function withCredentials(url, user, password) {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

function credentialsOf(url, expectedRole, variable) {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username);
  if (user !== expectedRole) {
    throw new Error(
      `${variable} must log in as ${expectedRole}, but it uses ${user || '(no user)'}.`,
    );
  }
  return decodeURIComponent(parsed.password);
}

export async function provisionRoles({ ownerUrl, appUrl, workerUrl }) {
  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  try {
    for (const [role, url, variable] of [
      [APP_ROLE, appUrl, 'DATABASE_URL'],
      [WORKER_ROLE, workerUrl, 'WORKER_DATABASE_URL'],
    ]) {
      const password = credentialsOf(url, role, variable);
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role]);
      const verb = exists.rowCount === 0 ? 'CREATE' : 'ALTER';
      await client.query(
        `${verb} ROLE ${client.escapeIdentifier(role)} LOGIN PASSWORD ${client.escapeLiteral(password)}`,
      );
    }
    await client.query(
      `CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION ${client.escapeIdentifier(WORKER_ROLE)}`,
    );
    await client.query(`ALTER SCHEMA pgboss OWNER TO ${client.escapeIdentifier(WORKER_ROLE)}`);
  } finally {
    await client.end();
  }
}

function migrateDeploy(ownerUrl) {
  const cli = require.resolve('prisma/build/index.js');
  execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
  });
}

function seedTestDatabase(ownerUrl) {
  const tsx = require.resolve('tsx/cli');
  execFileSync(process.execPath, [tsx, 'prisma/seed.ts'], {
    stdio: 'inherit',
    env: { ...process.env, MIGRATION_DATABASE_URL: ownerUrl },
  });
}

const commands = {
  async provision() {
    await provisionRoles({
      ownerUrl: requireEnv('MIGRATION_DATABASE_URL'),
      appUrl: requireEnv('DATABASE_URL'),
      workerUrl: requireEnv('WORKER_DATABASE_URL'),
    });
    process.stdout.write('Database roles provisioned.\n');
  },
  async 'prepare-test'() {
    const ownerUrl = requireEnv('DATABASE_URL_TEST');
    migrateDeploy(ownerUrl);
    await provisionRoles({
      ownerUrl,
      appUrl: withCredentials(ownerUrl, APP_ROLE, APP_ROLE),
      workerUrl: withCredentials(ownerUrl, WORKER_ROLE, WORKER_ROLE),
    });
    process.stdout.write('Test database migrated and roles provisioned.\n');
  },
  async 'seed-test'() {
    seedTestDatabase(requireEnv('DATABASE_URL_TEST'));
  },
};

const name = process.argv[2];
const command = name ? commands[name] : undefined;
if (!command) {
  process.stderr.write(`Usage: node scripts/db.mjs <${Object.keys(commands).join('|')}>\n`);
  process.exit(1);
}
command().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
