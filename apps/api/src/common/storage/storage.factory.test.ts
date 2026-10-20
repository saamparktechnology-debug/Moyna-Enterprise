import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { InMemoryStorageService } from './in-memory-storage.service.js';
import { LocalFileStorageService } from './local-file-storage.service.js';
import { createStorage } from './storage.factory.js';

const base = {
  DATABASE_URL: 'postgresql://erp:secret-pass@localhost:5432/erp_dev',
  SESSION_SECRET: 'a-session-secret-that-is-long-enough-123',
};

describe('createStorage', () => {
  it('uses memory in tests and local files otherwise', async () => {
    expect(await createStorage(loadEnv({ ...base, NODE_ENV: 'test' }))).toBeInstanceOf(
      InMemoryStorageService,
    );
    const folder = await mkdtemp(join(tmpdir(), 'erp-factory-'));
    try {
      const storage = await createStorage(
        loadEnv({ ...base, NODE_ENV: 'development', KYC_STORAGE_PATH: folder }),
      );
      expect(storage).toBeInstanceOf(LocalFileStorageService);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('honours an explicit driver', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'erp-factory-'));
    try {
      const local = await createStorage(
        loadEnv({ ...base, NODE_ENV: 'test', STORAGE_DRIVER: 'local', KYC_STORAGE_PATH: folder }),
      );
      expect(local).toBeInstanceOf(LocalFileStorageService);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });

  it('stops the API with a clear message when the folder cannot be used', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'erp-factory-'));
    try {
      await writeFile(join(folder, 'blocker'), 'x');
      const env = loadEnv({
        ...base,
        NODE_ENV: 'development',
        KYC_STORAGE_PATH: join(folder, 'blocker', 'kyc'),
      });
      await expect(createStorage(env)).rejects.toThrow(/KYC storage folder .* cannot be used/);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe('storage settings', () => {
  it('require an absolute path', () => {
    expect(() => loadEnv({ ...base, KYC_STORAGE_PATH: 'relative/kyc' })).toThrowError(
      /KYC_STORAGE_PATH/,
    );
  });

  it('are mandatory in production and refuse memory storage there', () => {
    const production = { ...base, NODE_ENV: 'production' };
    expect(() => loadEnv(production)).toThrowError(/KYC_STORAGE_PATH.*required in production/s);
    expect(() =>
      loadEnv({ ...production, KYC_STORAGE_PATH: '/var/lib/my-erp/kyc', STORAGE_DRIVER: 'memory' }),
    ).toThrowError(/STORAGE_DRIVER/);
    expect(
      loadEnv({ ...production, KYC_STORAGE_PATH: '/var/lib/my-erp/kyc' }).KYC_STORAGE_PATH,
    ).toBe('/var/lib/my-erp/kyc');
  });
});
