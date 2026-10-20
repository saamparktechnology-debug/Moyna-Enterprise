import { describe, expect, it } from 'vitest';
import {
  CreateCustomerRequestSchema,
  CustomerListQuerySchema,
  KYC_MAX_BYTES,
  KycUploadQuerySchema,
  RejectKycRequestSchema,
  UpdateCustomerRequestSchema,
  computeKycStatus,
  documentNumberProblem,
  maskDocumentNumber,
} from './customers.js';

const base = { name: ' Ravi Kumar ', phone: '9876543210' };

describe('creating a customer', () => {
  it('tidies the input and leaves the optional fields empty', () => {
    expect(CreateCustomerRequestSchema.parse({ ...base, email: ' RAVI@Example.COM ' })).toEqual({
      name: 'Ravi Kumar',
      phone: '9876543210',
      email: 'ravi@example.com',
      address: null,
      stateCode: null,
      gstin: null,
    });
  });

  it('wants a ten-digit mobile number starting with 6 to 9', () => {
    const phone = (value: string) =>
      CreateCustomerRequestSchema.safeParse({ ...base, phone: value }).success;
    expect(phone('9876543210')).toBe(true);
    expect(phone('6000000000')).toBe(true);
    expect(phone('5876543210')).toBe(false);
    expect(phone('98765 43210')).toBe(false);
    expect(phone('987654321')).toBe(false);
    expect(phone('98765432101')).toBe(false);
    expect(phone('+919876543210')).toBe(false);
  });

  it('checks the GSTIN against the state, and the name and email', () => {
    const parse = (extra: object) => CreateCustomerRequestSchema.safeParse({ ...base, ...extra });
    expect(parse({ gstin: '27AAPFU0939F1ZV', stateCode: '27' }).success).toBe(true);
    expect(parse({ gstin: '27AAPFU0939F1ZV' }).success).toBe(true);
    expect(parse({ gstin: '27AAPFU0939F1ZV', stateCode: '29' }).success).toBe(false);
    expect(parse({ gstin: '27AAPFU0939F1ZX' }).success).toBe(false);
    expect(parse({ name: 'x' }).success).toBe(false);
    expect(parse({ email: 'not-an-email' }).success).toBe(false);
    expect(parse({ address: 'x'.repeat(301) }).success).toBe(false);
  });
});

describe('updating a customer', () => {
  it('needs the row version and a change', () => {
    expect(UpdateCustomerRequestSchema.safeParse({ name: 'New' }).success).toBe(false);
    expect(UpdateCustomerRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateCustomerRequestSchema.safeParse({ rowVersion: 0, name: 'New' }).success).toBe(
      false,
    );
    expect(UpdateCustomerRequestSchema.safeParse({ rowVersion: 1, email: null }).success).toBe(
      true,
    );
  });
});

describe('the customer list query', () => {
  it('has safe defaults and rejects unknown choices', () => {
    expect(CustomerListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25 });
    expect(CustomerListQuerySchema.safeParse({ kycStatus: 'DONE' }).success).toBe(false);
    expect(CustomerListQuerySchema.safeParse({ stateCode: '7' }).success).toBe(false);
    expect(CustomerListQuerySchema.safeParse({ kycStatus: 'PENDING' }).success).toBe(true);
  });
});

describe('document numbers', () => {
  it('hides all but the last four characters', () => {
    expect(maskDocumentNumber('123456789012')).toBe('XXXXXXXX9012');
    expect(maskDocumentNumber('1234 5678 9012')).toBe('XXXXXXXX9012');
    expect(maskDocumentNumber('abcde1234f')).toBe('XXXXXX234F');
    expect(maskDocumentNumber('MH-12/2020')).toBe('XXXX2020');
    expect(maskDocumentNumber('KA01/2020/0012-A')).toBe('XXXXXXXXX012A');
  });

  it('always hides at least one character, even in a short number', () => {
    expect(maskDocumentNumber('ABCD')).toBe('XBCD');
    expect(maskDocumentNumber('A1234')).toBe('X1234');
    for (const value of ['AB12', 'ABCDE', '12345678901234567890', 'KA01/2020/0012-A', 'AB-12/3-4'])
      expect(maskDocumentNumber(value)).toMatch(/^X+[A-Z0-9]{1,4}$/);
  });

  it('never gives the full number back', () => {
    for (const value of ['123456789012', 'ABCDE1234F', 'MH-12/2020']) {
      const masked = maskDocumentNumber(value);
      expect(masked).toHaveLength(value.replace(/[^A-Z0-9]/gi, '').length);
      expect(masked).not.toBe(value.toUpperCase());
    }
  });

  it('accepts only the right shape for each kind', () => {
    expect(documentNumberProblem('AADHAAR', '1234 5678 9012')).toBeNull();
    expect(documentNumberProblem('AADHAAR', '12345678901')).toMatch(/12 digits/);
    expect(documentNumberProblem('AADHAAR', 'ABCDEFGHIJKL')).not.toBeNull();
    expect(documentNumberProblem('PAN', 'abcde1234f')).toBeNull();
    expect(documentNumberProblem('PAN', 'ABCDE12345')).not.toBeNull();
    expect(documentNumberProblem('PASSPORT', 'K1234567')).toBeNull();
    expect(documentNumberProblem('PASSPORT', 'K1')).not.toBeNull();
    expect(documentNumberProblem('DRIVING_LICENCE', 'MH-12/20200012345')).toBeNull();
    expect(documentNumberProblem('DRIVING_LICENCE', 'has space inside!')).not.toBeNull();
    expect(documentNumberProblem('DRIVING_LICENCE', '----')).not.toBeNull();
    expect(documentNumberProblem('DRIVING_LICENCE', '/1-2/3')).not.toBeNull();
    expect(documentNumberProblem('DRIVING_LICENCE', '1-2/3-4')).toBeNull();
  });
});

describe('the KYC status of a customer', () => {
  const current = (...pairs: [string, 'PENDING' | 'VERIFIED' | 'REJECTED'][]) =>
    pairs.map(([docType, status]) => ({ docType, status }));

  it('starts as not submitted', () => {
    expect(computeKycStatus([])).toBe('NOT_SUBMITTED');
  });

  it('is pending while any document waits for review', () => {
    expect(computeKycStatus(current(['AADHAAR', 'PENDING']))).toBe('PENDING');
    expect(computeKycStatus(current(['PAN', 'VERIFIED'], ['PHOTO', 'PENDING']))).toBe('PENDING');
  });

  it('is verified once an identity document is verified and nothing waits', () => {
    for (const type of ['AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENCE', 'PASSPORT'])
      expect(computeKycStatus(current([type, 'VERIFIED']))).toBe('VERIFIED');
    expect(computeKycStatus(current(['PAN', 'VERIFIED'], ['ADDRESS_PROOF', 'REJECTED']))).toBe(
      'VERIFIED',
    );
  });

  it('is not verified by a photo or an address proof alone', () => {
    expect(computeKycStatus(current(['PHOTO', 'VERIFIED']))).toBe('PENDING');
    expect(
      computeKycStatus(current(['ADDRESS_PROOF', 'VERIFIED'], ['GST_CERTIFICATE', 'VERIFIED'])),
    ).toBe('PENDING');
  });

  it('is rejected when nothing is verified and a document was rejected', () => {
    expect(computeKycStatus(current(['AADHAAR', 'REJECTED']))).toBe('REJECTED');
    expect(computeKycStatus(current(['AADHAAR', 'REJECTED'], ['PAN', 'REJECTED']))).toBe(
      'REJECTED',
    );
  });
});

describe('uploads and decisions', () => {
  it('keeps the size limit at five megabytes', () => {
    expect(KYC_MAX_BYTES).toBe(5 * 1024 * 1024);
  });

  it('needs a kind and a safe file name', () => {
    const parse = (value: object) => KycUploadQuerySchema.safeParse(value);
    expect(parse({ docType: 'PAN', fileName: 'pan.jpg' }).success).toBe(true);
    expect(parse({ docType: '', fileName: 'pan.jpg' }).success).toBe(false);
    expect(parse({ docType: 'PAN', fileName: '' }).success).toBe(false);
    expect(parse({ docType: 'PAN', fileName: '../pan.jpg' }).success).toBe(false);
    expect(parse({ docType: 'PAN', fileName: 'a\\b.jpg' }).success).toBe(false);
    expect(parse({ docType: 'PAN', fileName: 'a\u0007b.jpg' }).success).toBe(false);
    expect(parse({ docType: 'PAN', fileName: 'x'.repeat(161) }).success).toBe(false);
  });

  it('needs a real reason to reject', () => {
    expect(RejectKycRequestSchema.safeParse({ rowVersion: 1, reason: 'no' }).success).toBe(false);
    expect(RejectKycRequestSchema.safeParse({ rowVersion: 1, reason: 'Not clear' }).success).toBe(
      true,
    );
    expect(RejectKycRequestSchema.safeParse({ reason: 'Not clear' }).success).toBe(false);
  });
});
