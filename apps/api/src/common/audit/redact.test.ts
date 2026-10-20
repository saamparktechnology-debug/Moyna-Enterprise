import { describe, expect, it } from 'vitest';
import { redactSensitive } from './redact.js';

describe('redactSensitive', () => {
  it('hides passwords, tokens and secrets at any depth', () => {
    const result = redactSensitive({
      username: 'ravi',
      password: 'p',
      passwordHash: 'h',
      session: { token: 't', csrfToken: 'c', nested: [{ apiKey: 'k', ok: 1 }] },
    });
    expect(result).toEqual({
      username: 'ravi',
      password: '[redacted]',
      passwordHash: '[redacted]',
      session: {
        token: '[redacted]',
        csrfToken: '[redacted]',
        nested: [{ apiKey: '[redacted]', ok: 1 }],
      },
    });
  });

  it('hides full KYC and bank numbers but keeps other fields', () => {
    const result = redactSensitive({
      aadhaarNumber: '123412341234',
      panNo: 'ABCDE1234F',
      accountNumber: '99',
      name: 'Ravi',
      company: 'x',
    });
    expect(result).toEqual({
      aadhaarNumber: '[redacted]',
      panNo: '[redacted]',
      accountNumber: '[redacted]',
      name: 'Ravi',
      company: 'x',
    });
  });

  it('does not mistake ordinary fields for sensitive ones', () => {
    const ordinary = {
      span: 1,
      panel: 2,
      passenger: 3,
      secretary: 4,
      company: 'c',
      cardType: 'visa',
      accountant: 'x',
    };
    expect(redactSensitive(ordinary)).toEqual(ordinary);
  });

  it('passes primitives, null and dates through safely', () => {
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive('text')).toBe('text');
    expect(redactSensitive(5)).toBe(5);
    expect(redactSensitive(new Date('2026-01-01T00:00:00Z'))).toBe('2026-01-01T00:00:00.000Z');
  });

  it('stops at a maximum depth instead of recursing forever', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' };
    cyclic['self'] = cyclic;
    expect(() => JSON.stringify(redactSensitive(cyclic))).not.toThrow();
  });
});
