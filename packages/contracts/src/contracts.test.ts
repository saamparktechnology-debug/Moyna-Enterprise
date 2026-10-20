import { describe, expect, it } from 'vitest';
import {
  BranchListQuerySchema,
  CreateBranchRequestSchema,
  UpdateBranchRequestSchema,
  gstinCheckCharacter,
  gstinProblem,
  ChangePasswordRequestSchema,
  LoginRequestSchema,
  SessionResponseSchema,
  DOCUMENT_PREFIXES,
  DOCUMENT_TYPES,
  financialYearOf,
  ErrorResponseSchema,
  HealthResponseSchema,
  PaginationQuerySchema,
  paginatedSchema,
  toOpenApiSchema,
} from './index.js';

describe('ErrorResponseSchema', () => {
  it('accepts the standard error shape', () => {
    const parsed = ErrorResponseSchema.safeParse({
      code: 'VALIDATION_ERROR',
      message: 'Invalid input',
      details: [{ field: 'name', message: 'Required' }],
      requestId: 'req-1',
    });
    expect(parsed.success).toBe(true);
  });

  it('rejects an unknown error code', () => {
    const parsed = ErrorResponseSchema.safeParse({
      code: 'SOMETHING_ELSE',
      message: 'x',
      details: [],
      requestId: 'req-1',
    });
    expect(parsed.success).toBe(false);
  });

  it('requires details to be present', () => {
    const parsed = ErrorResponseSchema.safeParse({
      code: 'NOT_FOUND',
      message: 'x',
      requestId: 'req-1',
    });
    expect(parsed.success).toBe(false);
  });
});

describe('HealthResponseSchema', () => {
  it('accepts a healthy response', () => {
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', database: 'up', uptimeSeconds: 12.5 }).success,
    ).toBe(true);
  });

  it('rejects a negative uptime', () => {
    expect(
      HealthResponseSchema.safeParse({ status: 'ok', database: 'up', uptimeSeconds: -1 }).success,
    ).toBe(false);
  });
});

describe('toOpenApiSchema', () => {
  it('produces an object schema with required properties', () => {
    const schema = toOpenApiSchema(HealthResponseSchema);
    expect(schema.type).toBe('object');
    expect(schema.required).toEqual(
      expect.arrayContaining(['status', 'database', 'uptimeSeconds']),
    );
  });
});

describe('PaginationQuerySchema', () => {
  it('applies defaults', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, pageSize: 25, sortOrder: 'desc' });
  });

  it('coerces query-string numbers', () => {
    expect(PaginationQuerySchema.parse({ page: '3', pageSize: '50' })).toMatchObject({
      page: 3,
      pageSize: 50,
    });
  });

  it.each([
    { page: '0' },
    { page: '-1' },
    { page: '1.5' },
    { pageSize: '0' },
    { pageSize: '101' },
    { sortOrder: 'sideways' },
  ])('rejects %j', (input) => {
    expect(PaginationQuerySchema.safeParse(input).success).toBe(false);
  });
});

describe('paginatedSchema', () => {
  it('validates a page of items', () => {
    const schema = paginatedSchema(HealthResponseSchema);
    const page = { items: [], page: 1, pageSize: 25, total: 0, totalPages: 0 };
    expect(schema.safeParse(page).success).toBe(true);
    expect(schema.safeParse({ ...page, total: -1 }).success).toBe(false);
  });
});

describe('financialYearOf', () => {
  it('starts the financial year on 1 April in India time', () => {
    expect(financialYearOf(new Date('2026-04-01T00:00:00+05:30'))).toEqual({
      label: '2026-27',
      short: '2627',
    });
    expect(financialYearOf(new Date('2026-03-31T23:59:59+05:30'))).toEqual({
      label: '2025-26',
      short: '2526',
    });
  });

  it('uses India time, not UTC, at the year boundary', () => {
    expect(financialYearOf(new Date('2027-03-31T19:00:00Z')).label).toBe('2027-28');
    expect(financialYearOf(new Date('2027-03-31T18:29:59Z')).label).toBe('2026-27');
  });

  it('handles the century boundary', () => {
    expect(financialYearOf(new Date('2099-06-01T00:00:00Z'))).toEqual({
      label: '2099-00',
      short: '9900',
    });
  });
});

describe('document prefixes', () => {
  it('defines a short unique prefix for every document type', () => {
    const prefixes = DOCUMENT_TYPES.map((type) => DOCUMENT_PREFIXES[type]);
    expect(new Set(prefixes).size).toBe(DOCUMENT_TYPES.length);
    for (const prefix of prefixes) expect(prefix).toMatch(/^[A-Z]{1,3}$/);
  });
});

describe('auth contracts', () => {
  it('trims the username and requires both fields', () => {
    expect(LoginRequestSchema.parse({ username: '  ravi ', password: 'x' })).toEqual({
      username: 'ravi',
      password: 'x',
    });
    expect(LoginRequestSchema.safeParse({ username: '   ', password: 'x' }).success).toBe(false);
    expect(LoginRequestSchema.safeParse({ username: 'ravi', password: '' }).success).toBe(false);
  });

  it('requires a new password of 12 to 128 characters', () => {
    const base = { currentPassword: 'old' };
    expect(
      ChangePasswordRequestSchema.safeParse({ ...base, newPassword: 'a'.repeat(11) }).success,
    ).toBe(false);
    expect(
      ChangePasswordRequestSchema.safeParse({ ...base, newPassword: 'a'.repeat(12) }).success,
    ).toBe(true);
    expect(
      ChangePasswordRequestSchema.safeParse({ ...base, newPassword: 'a'.repeat(128) }).success,
    ).toBe(true);
    expect(
      ChangePasswordRequestSchema.safeParse({ ...base, newPassword: 'a'.repeat(129) }).success,
    ).toBe(false);
  });

  it('describes a session response', () => {
    const user = {
      id: 'u',
      username: 'r',
      fullName: 'R',
      email: 'r@x.com',
      roles: ['STAFF'],
      permissions: ['stock.view'],
      branches: [{ id: 'b', code: 'HQ', name: 'Head Office' }],
      isSuperAdmin: false,
      mustChangePassword: false,
    };
    expect(
      SessionResponseSchema.safeParse({
        user,
        csrfToken: 't',
        expiresAt: '2026-10-07T00:00:00.000Z',
      }).success,
    ).toBe(true);
    expect(
      SessionResponseSchema.safeParse({
        user: { ...user, roles: 'STAFF' },
        csrfToken: 't',
        expiresAt: 'x',
      }).success,
    ).toBe(false);
  });
});

describe('GSTIN rules', () => {
  const make = (first14: string) => `${first14}${gstinCheckCharacter(first14)}`;

  it('accepts a real-world GSTIN and any correctly built one', () => {
    expect(gstinProblem('27AAPFU0939F1ZV')).toBeNull();
    for (const first14 of [
      '19ABCDE1234F1Z',
      '29AAACR5055K1Z',
      '07AAGFF2194N1Z',
      '33AABCT3518Q1Z',
    ]) {
      expect(gstinProblem(make(first14))).toBeNull();
    }
  });

  it('catches a single mistyped character through the check character', () => {
    const good = make('27AAPFU0939F1Z');
    for (let i = 2; i < 14; i += 1) {
      const original = good.charAt(i);
      const replacement = original === '7' ? '8' : '7';
      if (/[A-Z]/.test(original)) continue;
      expect(
        gstinProblem(`${good.slice(0, i)}${replacement}${good.slice(i + 1)}`),
        `position ${i}`,
      ).toMatch(/check character/);
    }
  });

  it.each([
    '',
    '27AAPFU0939F1Z',
    '27AAPFU0939F1ZVV',
    '27aapfu0939f1zv',
    '2AAAPFU0939F1ZV',
    '27AAPFU0939F1AV',
    '27 AAPFU0939F1ZV',
  ])('rejects the malformed value %j', (value) => {
    expect(gstinProblem(value)).toBe('Enter a valid 15-character GSTIN');
  });

  it('requires the first two digits to match the state', () => {
    const gstin = make('27AAPFU0939F1Z');
    expect(gstinProblem(gstin, '27')).toBeNull();
    expect(gstinProblem(gstin, '29')).toBe('The GSTIN must start with the state code 29');
  });
});

describe('branch contracts', () => {
  const valid = { code: 'kol', name: '  Kolkata Branch ', stateCode: '19', gstin: null };

  it('normalises the code and name and allows a branch with no GSTIN', () => {
    expect(CreateBranchRequestSchema.parse(valid)).toEqual({
      code: 'KOL',
      name: 'Kolkata Branch',
      stateCode: '19',
      gstin: null,
    });
  });

  it.each([['a'], ['ABCDE'], ['K-L'], ['K L'], ['']])('rejects the branch code %j', (code) => {
    expect(CreateBranchRequestSchema.safeParse({ ...valid, code }).success).toBe(false);
  });

  it('rejects a blank name and a GSTIN from another state, pointing at the field', () => {
    expect(CreateBranchRequestSchema.safeParse({ ...valid, name: '   ' }).success).toBe(false);
    const gstin = `27AAPFU0939F1Z${gstinCheckCharacter('27AAPFU0939F1Z')}`;
    const result = CreateBranchRequestSchema.safeParse({ ...valid, gstin });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['gstin']);
  });

  it('upper-cases a GSTIN before checking it', () => {
    const gstin = `19abcde1234f1z${gstinCheckCharacter('19ABCDE1234F1Z').toLowerCase()}`;
    expect(CreateBranchRequestSchema.parse({ ...valid, gstin }).gstin).toBe(gstin.toUpperCase());
  });

  it('needs the version and at least one change to update a branch', () => {
    expect(UpdateBranchRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateBranchRequestSchema.safeParse({ name: 'New name' }).success).toBe(false);
    expect(UpdateBranchRequestSchema.safeParse({ name: 'New name', rowVersion: 3 }).success).toBe(
      true,
    );
    expect(UpdateBranchRequestSchema.safeParse({ gstin: null, rowVersion: 3 }).success).toBe(true);
    expect(UpdateBranchRequestSchema.safeParse({ name: 'x', rowVersion: 0 }).success).toBe(false);
  });

  it('lists active branches by default and bounds the page size', () => {
    expect(BranchListQuerySchema.parse({})).toMatchObject({
      status: 'active',
      page: 1,
      pageSize: 25,
    });
    expect(BranchListQuerySchema.safeParse({ pageSize: '500' }).success).toBe(false);
    expect(BranchListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
  });
});
