import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Followup, Lead, LeadSummary } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { BRANCH_ID, pageOf } from '../billing/test-data';

const ME = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const ASHA = '1b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const LEAD_ID = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const FOLLOWUP_ID = '3b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const VIEWER = ['leads.view'];
const WORKER = ['leads.view', 'leads.manage'];

const followup = (over: Partial<Followup> = {}): Followup => ({
  id: FOLLOWUP_ID,
  leadId: LEAD_ID,
  leadName: 'Ravi Kumar',
  leadPhone: '9000000001',
  leadStage: 'CONTACTED',
  assignedToName: 'Meera Nair',
  branchCode: 'HQ',
  dueAt: '2026-10-09T05:00:00.000Z',
  note: 'Ring about the quote',
  status: 'OVERDUE',
  completedAt: null,
  completedByName: null,
  completionNote: null,
  createdByName: 'Meera Nair',
  rescheduledCount: 0,
  rowVersion: 2,
  ...over,
});
const lead = (over: Partial<Lead> = {}): Lead => ({
  id: LEAD_ID,
  branchId: BRANCH_ID,
  branchCode: 'HQ',
  name: 'Ravi Kumar',
  phone: '9000000001',
  source: 'WALK_IN',
  sourceName: 'Walk-in',
  stage: 'CONTACTED',
  interest: 'Two TOTO X1',
  assignedTo: ME,
  assignedToName: 'Meera Nair',
  customerId: null,
  customerName: null,
  nextFollowupAt: '2026-10-09T05:00:00.000Z',
  overdueFollowups: 1,
  createdAt: '2026-10-01T05:00:00.000Z',
  createdByName: 'Meera Nair',
  rowVersion: 4,
  notes: [
    {
      id: 'n-2',
      body: 'Moved from New to Contacted',
      fromStage: 'NEW',
      toStage: 'CONTACTED',
      createdByName: 'Meera Nair',
      createdAt: '2026-10-02T05:00:00.000Z',
    },
    {
      id: 'n-1',
      body: 'Walked in today',
      fromStage: null,
      toStage: null,
      createdByName: 'Meera Nair',
      createdAt: '2026-10-01T05:00:00.000Z',
    },
  ],
  followups: [followup()],
  ...over,
});
const summaryOf = (l: Lead): LeadSummary => ({
  id: l.id,
  branchId: l.branchId,
  branchCode: l.branchCode,
  name: l.name,
  phone: l.phone,
  source: l.source,
  sourceName: l.sourceName,
  stage: l.stage,
  interest: l.interest,
  assignedTo: l.assignedTo,
  assignedToName: l.assignedToName,
  customerId: l.customerId,
  nextFollowupAt: l.nextFollowupAt,
  overdueFollowups: l.overdueFollowups,
  createdAt: l.createdAt,
});

const handlers = (
  permissions: string[] = WORKER,
  current: Lead = lead(),
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...signedIn(
    makeSession({
      id: ME,
      permissions,
      branches: [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }],
    }),
  ),
  'GET /api/leads?*': () => jsonResponse(pageOf([summaryOf(current)])),
  [`GET /api/leads/${current.id}`]: () => jsonResponse(current),
  'GET /api/leads/assignees': () =>
    jsonResponse([
      { id: ME, fullName: 'Meera Nair' },
      { id: ASHA, fullName: 'Asha Rao' },
    ]),
  'GET /api/reference/lead-sources': () =>
    jsonResponse([
      { code: 'WALK_IN', name: 'Walk-in' },
      { code: 'PHONE', name: 'Phone enquiry' },
    ]),
  'GET /api/followups?*': () => jsonResponse(pageOf([followup()])),
  'GET /api/followups/counts?*': () => jsonResponse({ overdue: 2, today: 1, upcoming: 3 }),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  const view = renderApp('/leads');
  return { ...state, ...view };
};
const sent = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((call) => call.key === key);
const openLead = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Open lead Ravi Kumar' }));
  return screen.findByRole('dialog');
};
const lastList = (calls: { key: string }[], prefix: string) =>
  calls.filter((c) => c.key.startsWith(prefix)).at(-1)?.key ?? '';

describe('the lead list', () => {
  it('shows each lead with its stage, source, owner and next follow-up, and flags late ones', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Leads' });
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(row).toHaveTextContent('Ravi Kumar');
    expect(row).toHaveTextContent('9000000001');
    expect(row).toHaveTextContent('Contacted');
    expect(row).toHaveTextContent('Walk-in');
    expect(row).toHaveTextContent('Meera Nair');
    expect(row).toHaveTextContent('1 overdue');
  });

  it('asks the server for the search, stage, owner and late-follow-up filter the user chose', async () => {
    const { calls } = open();
    await screen.findByRole('table', { name: 'Leads' });
    expect(lastList(calls, 'GET /api/leads?')).toContain('stage=open');
    await userEvent.type(screen.getByLabelText('Search leads'), 'ravi');
    await userEvent.selectOptions(screen.getByLabelText('Stage'), 'LOST');
    await userEvent.selectOptions(screen.getByLabelText('Looked after by'), 'me');
    await userEvent.click(screen.getByLabelText('Only with a late follow-up'));
    await waitFor(() => {
      const last = lastList(calls, 'GET /api/leads?');
      expect(last).toContain('search=ravi');
      expect(last).toContain('stage=LOST');
      expect(last).toContain('assignedTo=me');
      expect(last).toContain('overdue=true');
      expect(last).toContain('page=1');
    });
  });

  it('says so when there are no leads, and recovers from an error', async () => {
    let fail = true;
    open(
      handlers(WORKER, lead(), {
        'GET /api/leads?*': () =>
          fail
            ? jsonResponse(
                { code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' },
                500,
              )
            : jsonResponse(pageOf([])),
      }),
    );
    expect(await screen.findByText('Could not load the leads.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('There are no leads yet.')).toBeInTheDocument();
  });
});

describe('adding a lead', () => {
  it('checks the form before it asks the server', async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'New lead' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lead' }));
    expect(await within(dialog).findByText('Enter at least 2 characters')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a 10-digit mobile number')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose where the lead came from')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/leads')).toHaveLength(0);
  });

  it('sends the lead, assigned to the person adding it unless they choose otherwise', async () => {
    const { calls } = open(
      handlers(WORKER, lead(), {
        'POST /api/leads': () => jsonResponse(lead({ name: 'Asha Verma' }), 201),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'New lead' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), ' Asha Verma ');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9000000077');
    await userEvent.selectOptions(
      await within(dialog)
        .findByRole('option', { name: 'Phone enquiry' })
        .then((o) => o.closest('select') as HTMLSelectElement),
      'PHONE',
    );
    await userEvent.type(within(dialog).getByLabelText('What they want'), 'Spare parts');
    await userEvent.type(within(dialog).getByLabelText('First note'), 'Asked about prices');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lead' }));
    expect(await screen.findByText('Lead Asha Verma added')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/leads')[0]?.body).toMatchObject({
      name: 'Asha Verma',
      phone: '9000000077',
      source: 'PHONE',
      interest: 'Spare parts',
      assignedTo: ME,
      note: 'Asked about prices',
    });
  });

  it('shows what the server refused, such as a phone number already being followed up', async () => {
    open(
      handlers(WORKER, lead(), {
        'POST /api/leads': () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'An open lead already has this phone number',
              details: [{ field: 'phone', message: 'Ravi Kumar is already being followed up.' }],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'New lead' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Second Caller');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9000000001');
    const select = (await within(dialog).findByRole('option', { name: 'Walk-in' })).closest(
      'select',
    ) as HTMLSelectElement;
    await userEvent.selectOptions(select, 'WALK_IN');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add lead' }));
    expect(
      await within(dialog).findByText('An open lead already has this phone number'),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText(/already being followed up/).length).toBeGreaterThan(0);
  });
});

describe('working a lead', () => {
  it('shows its details, follow-ups and history', async () => {
    open();
    const dialog = await openLead();
    expect(await within(dialog).findByText('Two TOTO X1')).toBeInTheDocument();
    const followups = within(dialog).getByRole('table', { name: 'Follow-ups' });
    expect(followups).toHaveTextContent('Ring about the quote');
    expect(followups).toHaveTextContent('Overdue');
    const history = within(dialog).getByRole('list', { name: 'History' });
    expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent(
      'Moved from New to Contacted',
    );
    expect(within(history).getAllByRole('listitem')[0]).toHaveTextContent('New to Contacted');
  });

  it('offers only the stages the lead may move to, and never Won', async () => {
    open(handlers(WORKER, lead({ stage: 'QUALIFIED' })));
    const dialog = await openLead();
    const select = await within(dialog).findByLabelText('New stage');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose a stage', 'Quoted', 'In negotiation', 'Lost']);
  });

  it('moves the lead and sends the reason', async () => {
    const { calls } = open(
      handlers(WORKER, lead(), {
        [`POST /api/leads/${LEAD_ID}/stage`]: () => jsonResponse(lead({ stage: 'QUALIFIED' })),
      }),
    );
    const dialog = await openLead();
    await userEvent.selectOptions(await within(dialog).findByLabelText('New stage'), 'QUALIFIED');
    await userEvent.type(within(dialog).getByLabelText('Reason or note'), 'Has the budget');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(sent(calls, `POST /api/leads/${LEAD_ID}/stage`)).toHaveLength(1));
    expect(sent(calls, `POST /api/leads/${LEAD_ID}/stage`)[0]?.body).toEqual({
      stage: 'QUALIFIED',
      note: 'Has the budget',
      rowVersion: 4,
    });
  });

  it('will not lose a lead without a reason', async () => {
    const { calls } = open();
    const dialog = await openLead();
    await userEvent.selectOptions(await within(dialog).findByLabelText('New stage'), 'LOST');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await within(dialog).findByText('Say why the lead was lost')).toBeInTheDocument();
    expect(sent(calls, `POST /api/leads/${LEAD_ID}/stage`)).toHaveLength(0);
  });

  it('offers a lost lead only a reopening, and a won or lost lead no editing', async () => {
    open(
      handlers(
        WORKER,
        lead({ stage: 'LOST', followups: [], nextFollowupAt: null, overdueFollowups: 0 }),
      ),
    );
    const dialog = await openLead();
    expect(await within(dialog).findByText('Reopen this lead')).toBeInTheDocument();
    const options = within(await within(dialog).findByLabelText('New stage'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choose a stage', 'Contacted']);
    expect(within(dialog).queryByRole('button', { name: 'Edit details' })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Convert to customer' }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Plan follow-up' }),
    ).not.toBeInTheDocument();
  });

  it('shows a converted lead with its customer and no way to change it', async () => {
    open(
      handlers(
        WORKER,
        lead({
          stage: 'WON',
          customerId: ME,
          customerName: 'Ravi Kumar Traders',
          followups: [],
          nextFollowupAt: null,
          overdueFollowups: 0,
        }),
      ),
    );
    const dialog = await openLead();
    expect(await within(dialog).findByText('Ravi Kumar Traders')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('New stage')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Convert to customer' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Assign' })).not.toBeInTheDocument();
  });

  it('assigns the lead to someone else', async () => {
    const { calls } = open(
      handlers(WORKER, lead(), {
        [`POST /api/leads/${LEAD_ID}/assign`]: () => jsonResponse(lead({ assignedTo: ASHA })),
      }),
    );
    const dialog = await openLead();
    const assign = within(dialog).getByRole('button', { name: 'Assign' });
    expect(assign).toBeDisabled();
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Look after this lead'),
      ASHA,
    );
    await userEvent.click(assign);
    await waitFor(() => expect(sent(calls, `POST /api/leads/${LEAD_ID}/assign`)).toHaveLength(1));
    expect(sent(calls, `POST /api/leads/${LEAD_ID}/assign`)[0]?.body).toEqual({
      assignedTo: ASHA,
      rowVersion: 4,
    });
  });

  it('adds a note and refuses an empty one', async () => {
    const { calls } = open(
      handlers(WORKER, lead(), {
        [`POST /api/leads/${LEAD_ID}/notes`]: () => jsonResponse({}, 201),
      }),
    );
    const dialog = await openLead();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Add note' }));
    expect(await within(dialog).findByText('Write something')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Add a note'), 'Rang, call back Friday');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(sent(calls, `POST /api/leads/${LEAD_ID}/notes`)).toHaveLength(1));
    expect(sent(calls, `POST /api/leads/${LEAD_ID}/notes`)[0]?.body).toEqual({
      body: 'Rang, call back Friday',
    });
  });

  it('plans a follow-up with a time, and marks one done', async () => {
    const { calls } = open(
      handlers(WORKER, lead(), {
        [`POST /api/leads/${LEAD_ID}/followups`]: () =>
          jsonResponse(followup({ status: 'PENDING' }), 201),
        [`POST /api/followups/${FOLLOWUP_ID}/complete`]: () =>
          jsonResponse(followup({ status: 'COMPLETED' })),
      }),
    );
    const dialog = await openLead();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Plan follow-up' }));
    expect(await within(dialog).findByText('Choose the date and time')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText('Follow up on'), {
      target: { value: '2099-01-02T10:30' },
    });
    await userEvent.type(within(dialog).getByLabelText('What to do'), 'Send the quote');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Plan follow-up' }));
    await waitFor(() =>
      expect(sent(calls, `POST /api/leads/${LEAD_ID}/followups`)).toHaveLength(1),
    );
    const body = sent(calls, `POST /api/leads/${LEAD_ID}/followups`)[0]?.body as {
      dueAt: string;
      note: string;
    };
    expect(body.note).toBe('Send the quote');
    expect(new Date(body.dueAt).getTime()).toBe(new Date('2099-01-02T10:30').getTime());

    await userEvent.click(
      within(dialog).getByRole('button', { name: /Mark the follow-up of .* done/ }),
    );
    await waitFor(() =>
      expect(sent(calls, `POST /api/followups/${FOLLOWUP_ID}/complete`)).toHaveLength(1),
    );
  });

  it('converts the lead to a customer and says so, or says it was linked to an existing one', async () => {
    const created = {
      lead: lead({ stage: 'WON' }),
      customerId: ME,
      customerName: 'Ravi Kumar',
      customerCreated: true,
    };
    const { calls } = open(
      handlers(WORKER, lead(), {
        [`POST /api/leads/${LEAD_ID}/convert`]: () => jsonResponse(created),
      }),
    );
    const dialog = await openLead();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Convert to customer' }),
    );
    await userEvent.type(within(dialog).getByLabelText('Customer address'), '12 Park Road');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Convert' }));
    expect(await screen.findByText('Ravi Kumar is now a customer')).toBeInTheDocument();
    expect(sent(calls, `POST /api/leads/${LEAD_ID}/convert`)[0]?.body).toEqual({
      rowVersion: 4,
      address: '12 Park Road',
    });
  });

  it('tells the user when an existing customer was linked', async () => {
    open(
      handlers(WORKER, lead(), {
        [`POST /api/leads/${LEAD_ID}/convert`]: () =>
          jsonResponse({
            lead: lead({ stage: 'WON' }),
            customerId: ME,
            customerName: 'Old Customer',
            customerCreated: false,
          }),
      }),
    );
    const dialog = await openLead();
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Convert to customer' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Convert' }));
    expect(
      await screen.findByText('Ravi Kumar was linked to the existing customer Old Customer'),
    ).toBeInTheDocument();
  });

  it("shows the server's reason when a change is refused", async () => {
    open(
      handlers(WORKER, lead(), {
        [`POST /api/leads/${LEAD_ID}/stage`]: () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'This lead was changed by someone else. Reload it and try again',
              details: [],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    const dialog = await openLead();
    await userEvent.selectOptions(await within(dialog).findByLabelText('New stage'), 'QUALIFIED');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
  });
});

describe('the follow-ups tab', () => {
  const openTab = async (h = handlers()) => {
    const state = open(h);
    await userEvent.click(await screen.findByRole('tab', { name: 'Follow-ups' }));
    return state;
  };

  it('shows the counts and each follow-up with its lead', async () => {
    await openTab();
    expect(await screen.findByText('2 overdue · 1 due today · 3 coming up')).toBeInTheDocument();
    const row = within(await screen.findByRole('table', { name: 'Follow-ups due' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('Ravi Kumar');
    expect(row).toHaveTextContent('Ring about the quote');
    expect(row).toHaveTextContent('Overdue');
  });

  it("asks the server for the scope and for only the user's own leads", async () => {
    const { calls } = await openTab();
    await screen.findByRole('table', { name: 'Follow-ups due' });
    expect(lastList(calls, 'GET /api/followups?')).toContain('mine=true');
    await userEvent.selectOptions(screen.getByLabelText('Show follow-ups'), 'today');
    await userEvent.click(screen.getByLabelText('Only my leads'));
    await waitFor(() => {
      const last = lastList(calls, 'GET /api/followups?');
      expect(last).toContain('scope=today');
      expect(last).not.toContain('mine=true');
    });
  });

  it('marks a follow-up done, and opens its lead', async () => {
    const { calls } = await openTab(
      handlers(WORKER, lead(), {
        [`POST /api/followups/${FOLLOWUP_ID}/complete`]: () =>
          jsonResponse(followup({ status: 'COMPLETED' })),
      }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Mark the follow-up for Ravi Kumar done' }),
    );
    await waitFor(() =>
      expect(sent(calls, `POST /api/followups/${FOLLOWUP_ID}/complete`)).toHaveLength(1),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open lead Ravi Kumar' }));
    expect(await screen.findByRole('dialog')).toHaveTextContent('Ravi Kumar');
  });

  it('moves a follow-up to another time with a reason, and says when it moved to', async () => {
    const { calls } = await openTab(
      handlers(WORKER, lead(), {
        [`POST /api/followups/${FOLLOWUP_ID}/reschedule`]: () =>
          jsonResponse(
            followup({ status: 'PENDING', dueAt: '2099-03-04T05:00:00.000Z', rescheduledCount: 1 }),
          ),
      }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Move the follow-up for Ravi Kumar' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('New date and time'), '2099-03-04T10:30');
    await userEvent.type(
      within(dialog).getByLabelText('Why it is moved'),
      'Customer asked to call later',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move follow-up' }));
    expect(await screen.findByText(/Follow-up for Ravi Kumar moved to/)).toBeInTheDocument();
    const body = sent(calls, `POST /api/followups/${FOLLOWUP_ID}/reschedule`)[0]?.body as {
      dueAt: string;
      rowVersion: number;
      reason: string;
    };
    expect(body.rowVersion).toBe(2);
    expect(body.reason).toBe('Customer asked to call later');
    expect(new Date(body.dueAt).getTime()).toBe(new Date('2099-03-04T10:30').getTime());
  });

  it('names what is missing in a move and sends nothing', async () => {
    const { calls } = await openTab(handlers(WORKER));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Move the follow-up for Ravi Kumar' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move follow-up' }));
    expect(await within(dialog).findByText('Choose the date and time')).toBeInTheDocument();
    expect(within(dialog).getByText('Give a reason of at least 3 characters')).toBeInTheDocument();
    expect(sent(calls, `POST /api/followups/${FOLLOWUP_ID}/reschedule`)).toHaveLength(0);
  });

  it('shows how often a follow-up has been moved, and what the server refused', async () => {
    await openTab(
      handlers(WORKER, lead(), {
        'GET /api/followups?*': () => jsonResponse(pageOf([followup({ rescheduledCount: 2 })])),
        [`POST /api/followups/${FOLLOWUP_ID}/reschedule`]: () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'This follow-up was changed by someone else. Reload it and try again',
              details: [],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Move the follow-up for Ravi Kumar' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Moved 2 times already/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('New date and time'), '2099-03-04T10:30');
    await userEvent.type(within(dialog).getByLabelText('Why it is moved'), 'Out of town');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Move follow-up' }));
    expect(await within(dialog).findByText(/was changed by someone else/)).toBeInTheDocument();
  });

  it('offers no move to someone who may only view leads, or for a follow-up that is done', async () => {
    await openTab(handlers(VIEWER));
    await screen.findByRole('table', { name: 'Follow-ups due' });
    expect(screen.queryByRole('button', { name: /Move the follow-up/ })).not.toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    await openTab(
      handlers(WORKER, lead(), { 'GET /api/followups?*': () => jsonResponse(pageOf([])) }),
    );
    expect(await screen.findByText('No follow-up is waiting.')).toBeInTheDocument();
  });
});

describe('who sees what', () => {
  it('offers new leads, editing and conversion only to people who may manage leads', async () => {
    open(handlers(VIEWER));
    await screen.findByRole('table', { name: 'Leads' });
    expect(screen.queryByRole('button', { name: 'New lead' })).not.toBeInTheDocument();
    const dialog = await openLead();
    await within(dialog).findByText('Two TOTO X1');
    for (const name of [
      'Edit details',
      'Convert to customer',
      'Move',
      'Assign',
      'Plan follow-up',
      'Add note',
    ])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: /Mark the follow-up/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole('list', { name: 'History' })).toBeInTheDocument();
  });

  it('offers the manager everything', async () => {
    open(handlers(WORKER));
    expect(await screen.findByRole('button', { name: 'New lead' })).toBeInTheDocument();
  });

  it('keeps people without leads.view away and lists Leads in the menu only for those who may', async () => {
    open(handlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Leads' })).not.toBeInTheDocument();
  });

  it('lists Leads in the menu for people who may view them', async () => {
    open(handlers(VIEWER));
    expect(await screen.findByRole('link', { name: 'Leads' })).toBeInTheDocument();
  });
});
