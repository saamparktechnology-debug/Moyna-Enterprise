import pg from 'pg';
import { TEST_APP_DATABASE_URL, TEST_DATABASE_URL, TEST_WORKER_DATABASE_URL } from './test-env.js';

export async function connect(url: string): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  return client;
}

export const connectOwner = (): Promise<pg.Client> => connect(TEST_DATABASE_URL);
export const connectApp = (): Promise<pg.Client> => connect(TEST_APP_DATABASE_URL);
export const connectWorker = (): Promise<pg.Client> => connect(TEST_WORKER_DATABASE_URL);

export async function sqlState(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    throw error;
  }
  return 'OK';
}

export interface Session {
  userId?: string;
  branchIds?: string[];
  isSuper?: boolean;
}

export async function setSession(client: pg.Client, session: Session): Promise<void> {
  await client.query(
    "SELECT set_config('app.user_id', $1, false), set_config('app.branch_ids', $2, false), set_config('app.is_super', $3, false)",
    [session.userId ?? '', (session.branchIds ?? []).join(','), session.isSuper ? 'true' : 'false'],
  );
}
