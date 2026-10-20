import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFileStorageService, StorageKeyError } from './local-file-storage.service.js';

describe('LocalFileStorageService', () => {
  let root: string;
  let storage: LocalFileStorageService;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'erp-storage-'));
    storage = new LocalFileStorageService(join(root, 'kyc'));
    await storage.verify();
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores, reads back and deletes a file, taking the type from the extension', async () => {
    await storage.put('kyc/c1/a.pdf', Buffer.from('%PDF-data'), 'ignored/type');
    const stored = await storage.get('kyc/c1/a.pdf');
    expect(stored?.body.toString()).toBe('%PDF-data');
    expect(stored?.contentType).toBe('application/pdf');
    await storage.put('kyc/c1/b.JPG', Buffer.from('x'), 'text/html');
    expect((await storage.get('kyc/c1/b.JPG'))?.contentType).toBe('image/jpeg');
    await storage.delete('kyc/c1/a.pdf');
    expect(await storage.get('kyc/c1/a.pdf')).toBeNull();
  });

  it('keeps files across a new instance, which is what a restart is', async () => {
    await storage.put('kyc/c1/a.png', Buffer.from('png-bytes'), 'image/png');
    const afterRestart = new LocalFileStorageService(join(root, 'kyc'));
    expect((await afterRestart.get('kyc/c1/a.png'))?.body.toString()).toBe('png-bytes');
  });

  it('returns null for a missing file and tolerates deleting one', async () => {
    expect(await storage.get('kyc/none/x.pdf')).toBeNull();
    await expect(storage.delete('kyc/none/x.pdf')).resolves.toBeUndefined();
  });

  it('replaces a file whole and leaves no temporary files behind', async () => {
    await storage.put('kyc/c1/a.pdf', Buffer.from('one'), 'application/pdf');
    await storage.put('kyc/c1/a.pdf', Buffer.from('two-two'), 'application/pdf');
    expect((await storage.get('kyc/c1/a.pdf'))?.body.toString()).toBe('two-two');
    expect(await readdir(join(root, 'kyc', 'kyc', 'c1'))).toEqual(['a.pdf']);
  });

  it('cleans up its temporary file when the write fails', async () => {
    await storage.put('kyc/c1/dir.pdf', Buffer.from('one'), 'application/pdf');
    await expect(
      storage.put('kyc/c1/dir.pdf/inner.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow();
    expect(await readdir(join(root, 'kyc', 'kyc', 'c1'))).toEqual(['dir.pdf']);
  });

  it.each([
    '../secret.pdf',
    'kyc/../../secret.pdf',
    '/etc/passwd',
    'kyc//a.pdf',
    'kyc/a b.pdf',
    'kyc\\a.pdf',
    '.hidden.pdf',
    'kyc/.hidden/a.pdf',
    'a..b.pdf',
    'kyc/a.pdf.tmp',
    'kyc/%2e%2e/a.pdf',
    'kyc/a\u0000.pdf',
    '',
  ])('refuses the key %j in every operation', async (key) => {
    await expect(storage.put(key, Buffer.from('x'), 'application/pdf')).rejects.toBeInstanceOf(
      StorageKeyError,
    );
    await expect(storage.get(key)).rejects.toBeInstanceOf(StorageKeyError);
    await expect(storage.delete(key)).rejects.toBeInstanceOf(StorageKeyError);
  });

  it('never writes outside its root', async () => {
    await expect(
      storage.put('../outside.pdf', Buffer.from('x'), 'application/pdf'),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(['kyc']);
  });

  it('makes files readable by the owner only', async () => {
    if (process.platform === 'win32') return;
    await storage.put('kyc/c1/a.pdf', Buffer.from('x'), 'application/pdf');
    expect((await stat(join(root, 'kyc', 'kyc', 'c1', 'a.pdf'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(root, 'kyc', 'kyc', 'c1'))).mode & 0o777).toBe(0o700);
  });

  it('does not issue links', async () => {
    await expect(storage.signedUrl('kyc/c1/a.pdf', 60)).rejects.toThrow(/does not issue links/);
  });

  it('fails verification when the folder cannot be created', async () => {
    await writeFile(join(root, 'file'), 'x');
    await expect(new LocalFileStorageService(join(root, 'file', 'sub')).verify()).rejects.toThrow();
  });
});
