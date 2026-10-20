export const STORAGE_SERVICE = Symbol('STORAGE_SERVICE');

export interface StoredObject {
  body: Buffer;
  contentType: string;
}

export interface StorageService {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
  signedUrl(key: string, expiresInSeconds: number): Promise<string>;
}
