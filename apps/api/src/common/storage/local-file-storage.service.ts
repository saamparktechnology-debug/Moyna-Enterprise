import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import type { StorageService, StoredObject } from './storage.service.js';

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};
const FALLBACK_TYPE = 'application/octet-stream';

export class StorageKeyError extends Error {
  constructor(key: string) {
    super(`"${key}" is not a valid storage key`);
    this.name = 'StorageKeyError';
  }
}

/**
 * Keeps files in a directory on the server's disk, outside the application folder, so they survive restarts and
 * deployments. A key such as `kyc/<customer>/<file>.pdf` becomes a file below the root. Keys are checked twice, by
 * shape and by where the resolved path lands, so a key can never point outside the root. Files are written to a
 * temporary name and renamed into place, so a crash or an interrupted upload never leaves a half-written file under
 * the real name. The file type comes from the extension, which the server chose; nothing the client sent is trusted.
 */
export class LocalFileStorageService implements StorageService {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  /** Creates the root if needed and proves it can be written, so a bad setting stops the API at start-up. */
  async verify(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const probe = `${this.root}${sep}.write-test-${randomUUID()}`;
    const handle = await open(
      probe,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    await handle.close();
    await unlink(probe);
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(
        temporary,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      );
      try {
        await handle.writeFile(body);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const body = await readFile(this.pathOf(key));
      return { body, contentType: CONTENT_TYPES[extname(key).toLowerCase()] ?? FALLBACK_TYPE };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathOf(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** Files on disk have no address of their own; they are only ever served through the API after a permission check. */
  async signedUrl(_key: string, _expiresInSeconds: number): Promise<string> {
    throw new Error('Local storage does not issue links. Read the file through the API.');
  }

  private pathOf(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes('..') || key.endsWith('.tmp'))
      throw new StorageKeyError(key);
    const path = resolve(this.root, key);
    if (!path.startsWith(`${this.root}${sep}`)) throw new StorageKeyError(key);
    return path;
  }
}
