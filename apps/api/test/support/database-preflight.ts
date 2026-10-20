import pg from 'pg';

const PREFLIGHT_TIMEOUT_MS = 3000;

function describeTarget(url: string): string {
  try {
    const parsed = new URL(url);
    return `${decodeURIComponent(parsed.username)}@${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return '(unparseable DATABASE_URL_TEST)';
  }
}

export function explainConnectionFailure(error: unknown, url: string): string {
  const target = describeTarget(url);
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : '';
  const header = `Cannot use the test database ${target}.`;

  if (code === '28P01' || code === '28000') {
    return `${header} Authentication failed. Either the credentials in DATABASE_URL_TEST (.env) are wrong, or another PostgreSQL (for example a local Windows service) is listening on this port instead of the Docker container. Check with "docker compose ps", then either stop the other server or set POSTGRES_PORT and the port in DATABASE_URL_TEST in .env to a free port and run "pnpm db:up".`;
  }
  if (code === '3D000') {
    return `${header} The database does not exist. The Docker init script only runs on first start; run "docker compose down -v && pnpm db:up", or create it with: CREATE DATABASE erp_test OWNER erp;`;
  }
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'ENOTFOUND') {
    return `${header} Nothing is accepting connections there. Start it with "pnpm db:up" (Docker must be running).`;
  }
  const reason = error instanceof Error ? error.message : String(error);
  return `${header} ${reason}`;
}

export async function assertDatabaseReachable(url: string): Promise<void> {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: PREFLIGHT_TIMEOUT_MS,
  });
  try {
    await client.connect();
    await client.query('SELECT 1');
  } catch (error) {
    throw new Error(explainConnectionFailure(error, url), { cause: error });
  } finally {
    await client.end().catch(() => undefined);
  }
}
