import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from './password-policy.js';

const base = { username: 'ravi.kumar', email: 'ravi.kumar@example.com' };
const messages = (password: string, extra: { currentPassword?: string } = {}) =>
  checkPasswordPolicy({ ...base, password, ...extra }).map((d) => d.message);

describe('checkPasswordPolicy', () => {
  it('accepts a long passphrase without any symbol rules', () => {
    expect(messages('correct horse battery staple')).toEqual([]);
    expect(messages('plainlowercasewordsonly')).toEqual([]);
  });

  it('reports every problem on the newPassword field', () => {
    const details = checkPasswordPolicy({ ...base, password: 'short' });
    expect(details).toEqual([
      { field: 'newPassword', message: expect.stringContaining('at least 12') },
    ]);
  });

  it('rejects common passwords however they are dressed up', () => {
    for (const password of [
      'password1234',
      'Password-1234',
      'QWERTYUIOP12',
      'Change Me 1234',
      'welcome12345',
      'administrator',
    ]) {
      expect(messages(password).join(' '), password).toMatch(/too common|at least 12/);
    }
  });

  it('rejects repeated characters and simple sequences', () => {
    for (const password of [
      'zzzzzzzzzzzz',
      'abababababab',
      '012345678901',
      'abcdefghijklmn',
      'zyxwvutsrqponm',
    ]) {
      expect(messages(password), password).toContain(
        'Avoid repeated characters and simple sequences',
      );
    }
  });

  it('rejects a password that contains the username or the email name', () => {
    expect(messages('my-ravi.kumar-secret!')).toContain(
      'The password must not contain your username or email name',
    );
    expect(messages('xxRaviKumarxxPlease9')).toContain(
      'The password must not contain your username or email name',
    );
    expect(messages('ravi is a fine name 99')).toEqual([]);
  });

  it('ignores very short usernames when matching', () => {
    expect(
      checkPasswordPolicy({ username: 'ab', email: 'ab@x.com', password: 'cabbage-and-cake-1' }),
    ).toEqual([]);
  });

  it('rejects reusing the current password', () => {
    expect(
      messages('a-perfectly-fine-passphrase', { currentPassword: 'a-perfectly-fine-passphrase' }),
    ).toContain('Choose a password different from the current one');
  });

  it('rejects an over-long password', () => {
    expect(messages('a1'.repeat(70))).toEqual(['Use at most 128 characters']);
  });
});
