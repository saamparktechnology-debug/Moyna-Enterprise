import { beforeAll } from 'vitest';
import { resetDatabase } from './reset-database.js';

beforeAll(async () => {
  await resetDatabase();
});
