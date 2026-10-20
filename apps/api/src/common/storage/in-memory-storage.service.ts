import { Injectable } from '@nestjs/common';
import type { StorageService, StoredObject } from './storage.service.js';

@Injectable()
export class InMemoryStorageService implements StorageService {
  private readonly objects = new Map<string, StoredObject>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async signedUrl(key: string, expiresInSeconds: number): Promise<string> {
    if (!this.objects.has(key)) {
      throw new Error(`Object ${key} does not exist`);
    }
    return `memory://${encodeURIComponent(key)}?expires=${expiresInSeconds}`;
  }
}
