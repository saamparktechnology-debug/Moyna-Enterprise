//apps/api/test/support/setup-database.ts
import { beforeAll } from 'vitest';
import { resetDatabase } from './reset-database.js';

beforeAll(async () => {
  await resetDatabase();
});
