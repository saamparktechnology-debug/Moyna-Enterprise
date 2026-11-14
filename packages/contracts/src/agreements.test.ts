import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_PLACEHOLDERS,
  AgreementTextSchema,
  CreateAgreementRequestSchema,
  SignedCopyQuerySchema,
  STARTER_AGREEMENT_TEXT,
  UpdateAgreementRequestSchema,
  unknownPlaceholders,
} from './agreements.js';

const STAFF = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

describe('agreement placeholders', () => {
  it('finds the names that are not placeholders, once each, and ignores spacing inside the brackets', () => {
    expect(unknownPlaceholders('Hi {{employee_name}} and {{ today }}')).toEqual([]);
    expect(unknownPlaceholders('{{nobody}} {{nobody}} {{employe_name}}')).toEqual([
      'nobody',
      'employe_name',
    ]);
    expect(unknownPlaceholders('no brackets at all')).toEqual([]);
  });

  it('has a starter text that uses only real placeholders', () => {
    expect(unknownPlaceholders(STARTER_AGREEMENT_TEXT)).toEqual([]);
    expect(AgreementTextSchema.safeParse(STARTER_AGREEMENT_TEXT).success).toBe(true);
    for (const entry of AGREEMENT_PLACEHOLDERS) expect(entry.label.length).toBeGreaterThan(3);
  });

  it('refuses a text that is too short, too long, or names a placeholder that does not exist', () => {
    expect(AgreementTextSchema.safeParse('short').success).toBe(false);
    expect(AgreementTextSchema.safeParse('x'.repeat(30_001)).success).toBe(false);
    const typo = AgreementTextSchema.safeParse('Dear {{employe_name}}, these are the terms.');
    expect(typo.success).toBe(false);
    expect(typo.error?.issues[0]?.message).toBe('Unknown placeholder {{employe_name}}');
  });
});

describe('agreement requests', () => {
  it('needs a template or the terms to make a draft', () => {
    expect(
      CreateAgreementRequestSchema.safeParse({ staffId: STAFF, effectiveFrom: '2026-11-01' })
        .success,
    ).toBe(false);
    expect(
      CreateAgreementRequestSchema.safeParse({
        staffId: STAFF,
        templateId: STAFF,
        effectiveFrom: '2026-11-01',
      }).success,
    ).toBe(true);
    expect(
      CreateAgreementRequestSchema.safeParse({
        staffId: STAFF,
        body: STARTER_AGREEMENT_TEXT,
        effectiveFrom: '2026-11-01',
      }).success,
    ).toBe(true);
  });

  it('needs at least one change to a draft', () => {
    expect(UpdateAgreementRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(
      UpdateAgreementRequestSchema.safeParse({ title: 'New title', rowVersion: 1 }).success,
    ).toBe(true);
  });

  it('needs both signatures confirmed with the signed copy', () => {
    const good = {
      fileName: 'signed.pdf',
      signedOn: '2026-11-02',
      employeeSigned: 'true',
      adminSigned: 'true',
      rowVersion: '3',
    };
    const parsed = SignedCopyQuerySchema.safeParse(good);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.rowVersion).toBe(3);
    const noEmployee = SignedCopyQuerySchema.safeParse({ ...good, employeeSigned: 'false' });
    expect(noEmployee.error?.issues[0]?.message).toBe('The employee must have signed it');
    const noAdmin = SignedCopyQuerySchema.safeParse({ ...good, adminSigned: undefined });
    expect(noAdmin.error?.issues[0]?.message).toBe('The Super Admin must have signed it');
    expect(SignedCopyQuerySchema.safeParse({ ...good, fileName: '../x.pdf' }).success).toBe(false);
  });
});
