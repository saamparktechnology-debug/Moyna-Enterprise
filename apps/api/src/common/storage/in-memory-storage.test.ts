import { describe, expect, it } from 'vitest';
import { InMemoryStorageService } from './in-memory-storage.service.js';

describe('InMemoryStorageService', () => {
  it('stores, returns a copy of, and deletes an object', async () => {
    const storage = new InMemoryStorageService();
    const body = Buffer.from('hello');
    await storage.put('kyc/a.txt', body, 'text/plain');
    body.write('J');

    const stored = await storage.get('kyc/a.txt');
    expect(stored?.body.toString()).toBe('hello');
    expect(stored?.contentType).toBe('text/plain');

    await storage.delete('kyc/a.txt');
    expect(await storage.get('kyc/a.txt')).toBeNull();
  });

  it('returns null for a missing key and tolerates deleting one', async () => {
    const storage = new InMemoryStorageService();
    expect(await storage.get('nope')).toBeNull();
    await expect(storage.delete('nope')).resolves.toBeUndefined();
  });

  it('only signs urls for objects that exist', async () => {
    const storage = new InMemoryStorageService();
    await expect(storage.signedUrl('nope', 60)).rejects.toThrowError(/does not exist/);
    await storage.put('a b.txt', Buffer.from('x'), 'text/plain');
    await expect(storage.signedUrl('a b.txt', 60)).resolves.toBe('memory://a%20b.txt?expires=60');
  });
});
