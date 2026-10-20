import { describe, expect, it } from 'vitest';
import {
  AddLeadNoteRequestSchema,
  AssignLeadRequestSchema,
  ChangeStageRequestSchema,
  CompleteFollowupRequestSchema,
  ConvertLeadRequestSchema,
  CreateFollowupRequestSchema,
  CreateLeadRequestSchema,
  FollowupListQuerySchema,
  LEAD_STAGES,
  LeadListQuerySchema,
  UpdateLeadRequestSchema,
  allowedNextStages,
  isOpenStage,
} from './leads.js';

const user = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

describe('allowedNextStages', () => {
  it('lets an open lead move forward to any later open stage, or be lost', () => {
    expect(allowedNextStages('NEW')).toEqual([
      'CONTACTED',
      'QUALIFIED',
      'QUOTED',
      'NEGOTIATION',
      'LOST',
    ]);
    expect(allowedNextStages('QUALIFIED')).toEqual(['QUOTED', 'NEGOTIATION', 'LOST']);
  });

  it('lets a lead in negotiation go back to quoted, and no other lead go back', () => {
    expect(allowedNextStages('NEGOTIATION')).toEqual(['QUOTED', 'LOST']);
    expect(allowedNextStages('QUOTED')).not.toContain('QUALIFIED');
    expect(allowedNextStages('CONTACTED')).not.toContain('NEW');
  });

  it('only reopens a lost lead to contacted, and never moves a won lead', () => {
    expect(allowedNextStages('LOST')).toEqual(['CONTACTED']);
    expect(allowedNextStages('WON')).toEqual([]);
  });

  it('never offers WON, which only converting a lead can reach, or the stage the lead is already in', () => {
    for (const stage of LEAD_STAGES) {
      expect(allowedNextStages(stage)).not.toContain('WON');
      expect(allowedNextStages(stage)).not.toContain(stage);
    }
  });

  it('tells open stages from closed ones', () => {
    expect(LEAD_STAGES.filter(isOpenStage)).toEqual([
      'NEW',
      'CONTACTED',
      'QUALIFIED',
      'QUOTED',
      'NEGOTIATION',
    ]);
  });
});

describe('CreateLeadRequestSchema', () => {
  const create = (over: Record<string, unknown> = {}) =>
    CreateLeadRequestSchema.safeParse({
      name: 'Ravi Kumar',
      phone: '9000000001',
      source: 'WALK_IN',
      ...over,
    });

  it('accepts the basics and defaults the rest', () => {
    const result = create();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ interest: null, assignedTo: null });
  });

  it.each(['12345', '5000000001', '90000000011', 'abcdefghij', ''])(
    'rejects the phone %j',
    (phone) => {
      expect(create({ phone }).success).toBe(false);
    },
  );

  it('needs a name of two characters and a source', () => {
    expect(create({ name: 'R' }).success).toBe(false);
    expect(create({ source: '  ' }).success).toBe(false);
    expect(create({ source: undefined }).success).toBe(false);
  });

  it('refuses a note over the limit and an assignee that is not an id', () => {
    expect(create({ note: 'x'.repeat(1001) }).success).toBe(false);
    expect(create({ assignedTo: 'asha' }).success).toBe(false);
    expect(create({ assignedTo: user, note: 'Wants two units' }).success).toBe(true);
  });
});

describe('UpdateLeadRequestSchema', () => {
  it('needs a change and a row version', () => {
    expect(UpdateLeadRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateLeadRequestSchema.safeParse({ name: 'New Name', rowVersion: 1 }).success).toBe(
      true,
    );
    expect(UpdateLeadRequestSchema.safeParse({ name: 'New Name' }).success).toBe(false);
  });
});

describe('ChangeStageRequestSchema', () => {
  it('refuses WON, which only converting a lead reaches', () => {
    expect(ChangeStageRequestSchema.safeParse({ stage: 'WON', rowVersion: 1 }).success).toBe(false);
  });

  it('needs a reason to lose a lead, and none for other stages', () => {
    expect(ChangeStageRequestSchema.safeParse({ stage: 'LOST', rowVersion: 1 }).success).toBe(
      false,
    );
    expect(
      ChangeStageRequestSchema.safeParse({ stage: 'LOST', note: 'ab', rowVersion: 1 }).success,
    ).toBe(false);
    expect(
      ChangeStageRequestSchema.safeParse({ stage: 'LOST', note: 'Bought elsewhere', rowVersion: 1 })
        .success,
    ).toBe(true);
    expect(ChangeStageRequestSchema.safeParse({ stage: 'CONTACTED', rowVersion: 1 }).success).toBe(
      true,
    );
  });
});

describe('other requests', () => {
  it('assigns to a user or to nobody', () => {
    expect(AssignLeadRequestSchema.safeParse({ assignedTo: user, rowVersion: 2 }).success).toBe(
      true,
    );
    expect(AssignLeadRequestSchema.safeParse({ assignedTo: null, rowVersion: 2 }).success).toBe(
      true,
    );
    expect(AssignLeadRequestSchema.safeParse({ assignedTo: 'x', rowVersion: 2 }).success).toBe(
      false,
    );
  });

  it('needs a note body', () => {
    expect(AddLeadNoteRequestSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(AddLeadNoteRequestSchema.safeParse({ body: 'Called, call back Friday' }).success).toBe(
      true,
    );
  });

  it('takes a follow-up time with an offset, and an optional note', () => {
    expect(
      CreateFollowupRequestSchema.safeParse({ dueAt: '2026-10-12T10:00:00+05:30' }).success,
    ).toBe(true);
    expect(
      CreateFollowupRequestSchema.safeParse({ dueAt: '2026-10-12T10:00:00Z', note: 'Call' })
        .success,
    ).toBe(true);
    expect(CreateFollowupRequestSchema.safeParse({ dueAt: '2026-10-12' }).success).toBe(false);
    expect(CreateFollowupRequestSchema.safeParse({ dueAt: 'tomorrow' }).success).toBe(false);
    expect(CompleteFollowupRequestSchema.safeParse({}).success).toBe(true);
  });

  it('converts with new customer details or by linking one, not both', () => {
    expect(ConvertLeadRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(true);
    expect(ConvertLeadRequestSchema.safeParse({ rowVersion: 1, customerId: user }).success).toBe(
      true,
    );
    expect(
      ConvertLeadRequestSchema.safeParse({ rowVersion: 1, customerId: user, address: 'Pune' })
        .success,
    ).toBe(false);
    expect(
      ConvertLeadRequestSchema.safeParse({ rowVersion: 1, email: 'not-an-email' }).success,
    ).toBe(false);
    expect(ConvertLeadRequestSchema.safeParse({ rowVersion: 1, gstin: '123' }).success).toBe(false);
  });
});

describe('list queries', () => {
  it('apply defaults and read booleans from text', () => {
    expect(LeadListQuerySchema.parse({})).toMatchObject({ stage: 'all', page: 1 });
    expect(LeadListQuerySchema.parse({ overdue: 'true' }).overdue).toBe(true);
    expect(LeadListQuerySchema.parse({ assignedTo: 'me' }).assignedTo).toBe('me');
    expect(LeadListQuerySchema.parse({ assignedTo: 'unassigned' }).assignedTo).toBe('unassigned');
    expect(LeadListQuerySchema.safeParse({ assignedTo: 'asha' }).success).toBe(false);
    expect(LeadListQuerySchema.safeParse({ stage: 'DONE' }).success).toBe(false);
    expect(FollowupListQuerySchema.parse({}).scope).toBe('open');
    expect(FollowupListQuerySchema.parse({ mine: 'true' }).mine).toBe(true);
    expect(FollowupListQuerySchema.safeParse({ scope: 'someday' }).success).toBe(false);
  });
});
