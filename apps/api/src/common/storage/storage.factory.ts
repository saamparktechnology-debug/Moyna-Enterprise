import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Env } from '../config/env.js';
import { InMemoryStorageService } from './in-memory-storage.service.js';
import { LocalFileStorageService } from './local-file-storage.service.js';
import type { StorageService } from './storage.service.js';

/**
 * Picks where uploaded files live. `local` keeps them on disk under KYC_STORAGE_PATH. `memory` is for tests only and
 * loses everything on restart, so production never accepts it (the configuration check refuses it). Without a path,
 * development uses a folder in the user's home directory, outside the repository, so files still survive restarts.
 */
export async function createStorage(env: Env): Promise<StorageService> {
  const driver = env.STORAGE_DRIVER ?? (env.NODE_ENV === 'test' ? 'memory' : 'local');
  if (driver === 'memory') return new InMemoryStorageService();
  const root = env.KYC_STORAGE_PATH ?? join(homedir(), '.my-erp', 'kyc');
  const storage = new LocalFileStorageService(root);
  try {
    await storage.verify();
  } catch (error) {
    throw new Error(
      `KYC storage folder "${root}" cannot be used: ${(error as Error).message}. Create it and give the API's user write access, or change KYC_STORAGE_PATH.`,
      { cause: error },
    );
  }
  return storage;
}
