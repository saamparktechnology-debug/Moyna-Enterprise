import { describe, expect, it } from 'vitest';
import {
  AdvanceSeriesRequestSchema,
  AuditLogQuerySchema,
  CreateGstRateRequestSchema,
  DocumentSeriesListQuerySchema,
  SETTING_BY_KEY,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  UpdateGstRateRequestSchema,
  UpdateSettingRequestSchema,
} from './settings.js';

const accepts = (key: string, value: string | number): boolean =>
  SETTING_BY_KEY.get(key)!.schema.safeParse(value).success;

describe('setting definitions', () => {
  it('have unique keys, each with a label, a description and a group', () => {
    expect(new Set(SETTING_KEYS).size).toBe(SETTING_DEFINITIONS.length);
    for (const definition of SETTING_DEFINITIONS) {
      expect(definition.label).toBeTruthy();
      expect(definition.description).toBeTruthy();
      expect(definition.key.startsWith(`${definition.group}.`)).toBe(true);
    }
  });
  it('check a GSTIN', () => {
    expect(accepts('company.gstin', '27ABCDE1234F1Z5')).toBe(true);
    expect(accepts('company.gstin', '27abcde1234f1z5')).toBe(true);
    expect(accepts('company.gstin', '27ABCDE1234F1Z')).toBe(false);
    expect(accepts('company.gstin', '99ABCDE1234F1X5')).toBe(false);
  });
  it('check an email, a phone number and the name length', () => {
    expect(accepts('company.email', 'a@b.co')).toBe(true);
    expect(accepts('company.email', 'nope')).toBe(false);
    expect(accepts('company.phone', '+91 98100 00001')).toBe(true);
    expect(accepts('company.phone', 'abc')).toBe(false);
    expect(accepts('company.name', 'x'.repeat(120))).toBe(true);
    expect(accepts('company.name', 'x'.repeat(121))).toBe(false);
    expect(accepts('company.name', '   ')).toBe(false);
  });
  it('check the limits', () => {
    expect(accepts('approvals.exchange_admin_limit', '50000.50')).toBe(true);
    expect(accepts('approvals.exchange_admin_limit', '0')).toBe(false);
    expect(accepts('approvals.exchange_admin_limit', '-1')).toBe(false);
    expect(accepts('approvals.exchange_admin_limit', '1.234')).toBe(false);
    expect(accepts('approvals.adjustment_admin_limit', 10)).toBe(true);
    expect(accepts('approvals.adjustment_admin_limit', 0)).toBe(false);
    expect(accepts('approvals.adjustment_admin_limit', 100_001)).toBe(false);
    expect(accepts('approvals.adjustment_admin_limit', 2.5)).toBe(false);
  });
  it('take a value and an optional version, and nothing else', () => {
    expect(UpdateSettingRequestSchema.safeParse({ value: 'x' }).success).toBe(true);
    expect(UpdateSettingRequestSchema.safeParse({ value: 'x', rowVersion: 0 }).success).toBe(false);
    expect(UpdateSettingRequestSchema.safeParse({ value: 'x', extra: 1 }).success).toBe(false);
  });
});

describe('number series requests', () => {
  it('need a reason of at least five characters and a number above one', () => {
    expect(
      AdvanceSeriesRequestSchema.safeParse({ nextNumber: 10, reason: 'Paper book', rowVersion: 1 })
        .success,
    ).toBe(true);
    expect(
      AdvanceSeriesRequestSchema.safeParse({ nextNumber: 10, reason: 'ok', rowVersion: 1 }).success,
    ).toBe(false);
    expect(
      AdvanceSeriesRequestSchema.safeParse({ nextNumber: 1, reason: 'Paper book', rowVersion: 1 })
        .success,
    ).toBe(false);
  });
  it('filter by a financial year written 2026-27', () => {
    expect(DocumentSeriesListQuerySchema.safeParse({ financialYear: '2026-27' }).success).toBe(
      true,
    );
    expect(DocumentSeriesListQuerySchema.safeParse({ financialYear: '2026' }).success).toBe(false);
  });
});

describe('tax rate requests', () => {
  it('accept a percentage up to 40 with at most two decimals', () => {
    for (const rate of ['0', '5', '12.5', '18.00', '28', '40'])
      expect(CreateGstRateRequestSchema.safeParse({ rate, label: 'x' }).success).toBe(true);
    for (const rate of ['41', '-1', '5.555', 'abc', ''])
      expect(CreateGstRateRequestSchema.safeParse({ rate, label: 'x' }).success).toBe(false);
  });
  it('never take a new percentage, and need something to change', () => {
    expect(UpdateGstRateRequestSchema.safeParse({ rate: '9', rowVersion: 1 }).success).toBe(false);
    expect(UpdateGstRateRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateGstRateRequestSchema.safeParse({ isActive: false, rowVersion: 1 }).success).toBe(
      true,
    );
  });
});

describe('audit log query', () => {
  it('defaults to newest first and refuses unknown fields and one-letter searches', () => {
    expect(AuditLogQuerySchema.parse({}).sortOrder).toBe('desc');
    expect(AuditLogQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ q: 'a' }).success).toBe(false);
    expect(AuditLogQuerySchema.safeParse({ sortBy: 'password' }).success).toBe(false);
  });
});
