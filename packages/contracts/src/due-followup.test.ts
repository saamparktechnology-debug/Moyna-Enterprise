import { describe, expect, it } from 'vitest';
import { CreateDuePromiseRequestSchema, SetGuarantorRequestSchema } from './due-followup.js';

describe('following up a due', () => {
  it('takes a promised date with an optional note', () => {
    expect(CreateDuePromiseRequestSchema.safeParse({ promisedDate: '2099-01-01' }).success).toBe(
      true,
    );
    expect(CreateDuePromiseRequestSchema.safeParse({ promisedDate: 'soon' }).success).toBe(false);
  });

  it('needs a guarantor name and a phone, and treats the rest as optional', () => {
    expect(
      SetGuarantorRequestSchema.safeParse({ name: 'Mohan Lal', phone: '9000000099' }).success,
    ).toBe(true);
    expect(SetGuarantorRequestSchema.safeParse({ name: 'M', phone: '9000000099' }).success).toBe(
      false,
    );
    expect(SetGuarantorRequestSchema.safeParse({ name: 'Mohan Lal', phone: '12' }).success).toBe(
      false,
    );
  });
});
