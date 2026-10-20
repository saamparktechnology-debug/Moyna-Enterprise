import { randomInt } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';

const TEMPORARY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMPORARY_LENGTH = 16;

@Injectable()
export class PasswordService {
  private dummy: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return argon2.hash(password, { type: argon2.argon2id });
  }

  async verify(hash: string, password: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, password);
    } catch {
      return false;
    }
  }

  /** A valid hash to verify against when the user does not exist, so both cases cost the same time. */
  dummyHash(): Promise<string> {
    this.dummy ??= this.hash('not-a-real-password-for-timing-only');
    return this.dummy;
  }

  generateTemporaryPassword(): string {
    for (;;) {
      const candidate = Array.from(
        { length: TEMPORARY_LENGTH },
        () => TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)],
      ).join('');
      if (/[A-Z]/.test(candidate) && /[a-z]/.test(candidate) && /\d/.test(candidate))
        return candidate;
    }
  }
}
