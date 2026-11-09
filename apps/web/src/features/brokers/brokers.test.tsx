//apps/web/src/features/brokers/brokers.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Broker, BrokerLedger, Commission } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { BRANCH_ID, pageOf } from '../billing/test-data';

const BROKER_ID = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const OTHER_ID = '3b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const COMMISSION_ID = '4b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const COMMISSION_2 = '5b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const COMMISSION_3 = '6b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const VIEWER = ['brokers.view'];
const MANAGER = ['brokers.view', 'brokers.manage', 'commissions.approve_payout'];

const broker = (over: Partial<Broker> = {}): Broker => ({
  id: BROKER_ID,
  name: 'Ravi Broker',
  phone: '9000000001',
  isActive: true,
  activeRule: { type: 'PERCENT', value: '2.50' },
  payable: '350.00',
  toRecover: '0.00',
  createdAt: '2026-10-01T05:00:00.000Z',
  rowVersion: 3,
  rules: [
    {
      id: 'r-2',
      type: 'PERCENT',
      value: '2.50',
      isActive: true,
      createdAt: '2026-10-05T05:00:00.000Z',
      createdByName: 'Meera Nair',
    },
    {
      id: 'r-1',
      type: 'FIXED',
      value: '500.00',
      isActive: false,
      createdAt: '2026-10-01T05:00:00.000Z',
      createdByName: 'Meera Nair',
    },
  ],
  ...over,
});
const summaryOf = (b: Broker) => {
  const { rowVersion: _v, rules: _r, ...summary } = b;
  void _v;
  void _r;
  return summary;
};
const commission = (over: Partial<Commission> = {}): Commission => ({
  id: COMMISSION_ID,
  status: 'PAYABLE',
  branchId: BRANCH_ID,
  branchCode: 'HQ',
  brokerId: BROKER_ID,
  brokerName: 'Ravi Broker',
  invoiceId: 'inv-1',
  invoiceNo: 'HQ/NG/26-27/00001',
  customerName: 'Asha Rao',
  ruleType: 'PERCENT',
  ruleValue: '2.50',
  baseAmount: '10000.00',
  amount: '250.00',
  adjusted: '50.00',
  effective: '200.00',
  paidAt: null,
  paidAmount: null,
  payoutReference: null,
  toRecover: '0.00',
  createdAt: '2026-10-09T05:00:00.000Z',
  ...over,
});
const ledger = (over: Partial<BrokerLedger> = {}): BrokerLedger => ({
  ...pageOf([
    {
      date: '2026-10-10',
      type: 'PAYOUT' as const,
      documentNo: 'HQ/NG/26-27/00001',
      documentId: COMMISSION_ID,
      branchCode: 'HQ',
      description: 'Paid out',
      increase: '0.00',
      decrease: '800.00',
      balance: '-100.00',
    },
    {
      date: '2026-10-09',
      type: 'COMMISSION' as const,
      documentNo: 'HQ/NG/26-27/00001',
      documentId: COMMISSION_ID,
      branchCode: 'HQ',
      description: 'Commission',
      increase: '700.00',
      decrease: '0.00',
      balance: '700.00',
    },
  ]),
  brokerId: BROKER_ID,
  brokerName: 'Ravi Broker',
  balance: '-100.00',
  ...over,
});

const handlers = (
  permissions: string[] = MANAGER,
  current: Broker = broker(),
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...signedIn(
    makeSession({
      permissions,
      branches: [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }],
    }),
  ),
  'GET /api/brokers?*': () => jsonResponse(pageOf([summaryOf(current)])),
  [`GET /api/brokers/${current.id}`]: () => jsonResponse(current),
  [`GET /api/brokers/${current.id}/ledger?*`]: () => jsonResponse(ledger()),
  'GET /api/commissions?*': () => jsonResponse(pageOf([commission()])),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  const view = renderApp('/brokers');
  return { ...state, ...view };
};
const sent = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((call) => call.key === key);
const lastList = (calls: { key: string }[], prefix: string) =>
  calls.filter((c) => c.key.startsWith(prefix)).at(-1)?.key ?? '';
const openBroker = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Open broker Ravi Broker' }));
  return screen.findByRole('dialog');
};
const tab = async (name: string) => userEvent.click(await screen.findByRole('tab', { name }));

describe('the broker list', () => {
  it('shows each broker with the rule in force, what is to be paid and what is to be got back', async () => {
    open();
    const row = within(await screen.findByRole('table', { name: 'Brokers' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('Ravi Broker');
    expect(row).toHaveTextContent('9000000001');
    expect(row).toHaveTextContent('2.5%');
    expect(row).toHaveTextContent('350.00');
    expect(row).toHaveTextContent('Active');
  });

  it('shows a fixed rule and a broker with none in words', async () => {
    open(handlers(MANAGER, broker({ activeRule: { type: 'FIXED', value: '500.00' } })));
    expect(await screen.findByText('500.00 a sale')).toBeInTheDocument();
  });

  it('asks the server for the search and status the user chose', async () => {
    const { calls } = open();
    await screen.findByRole('table', { name: 'Brokers' });
    await userEvent.type(screen.getByLabelText('Search brokers'), 'ravi');
    await userEvent.selectOptions(screen.getByLabelText('Broker status'), 'inactive');
    await waitFor(() => {
      const last = lastList(calls, 'GET /api/brokers?');
      expect(last).toContain('search=ravi');
      expect(last).toContain('status=inactive');
    });
  });

  it('says so when there are none, and recovers from an error', async () => {
    let fail = true;
    open(
      handlers(MANAGER, broker(), {
        'GET /api/brokers?*': () =>
          fail
            ? jsonResponse(
                { code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' },
                500,
              )
            : jsonResponse(pageOf([])),
      }),
    );
    expect(await screen.findByText('Could not load the brokers.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No broker has been added yet.')).toBeInTheDocument();
  });
});

describe('adding and editing a broker', () => {
  it('checks the form before it asks the server', async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'New broker' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '12345');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add broker' }));
    expect(await within(dialog).findByText('Enter at least 2 characters')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a 10-digit mobile number')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/brokers')).toHaveLength(0);
  });

  it('sends the broker, and shows what the server refused', async () => {
    let refuse = true;
    const { calls } = open(
      handlers(MANAGER, broker(), {
        'POST /api/brokers': () =>
          refuse
            ? jsonResponse(
                {
                  code: 'CONFLICT',
                  message: 'A broker with this phone number already exists',
                  details: [{ field: 'phone', message: 'Already used by Old Broker' }],
                  requestId: 'r',
                },
                409,
              )
            : jsonResponse(broker({ name: 'Asha Verma' }), 201),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'New broker' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), ' Asha Verma ');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9000000077');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add broker' }));
    expect(
      await within(dialog).findByText('A broker with this phone number already exists'),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText('Already used by Old Broker').length).toBeGreaterThan(0);
    refuse = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add broker' }));
    expect(await screen.findByText('Broker Asha Verma added')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/brokers').at(-1)?.body).toEqual({
      name: 'Asha Verma',
      phone: '9000000077',
      address: null,
    });
  });

  it('edits a broker with the row version it was loaded with', async () => {
    const { calls } = open(
      handlers(MANAGER, broker(), {
        [`PATCH /api/brokers/${BROKER_ID}`]: () => jsonResponse(broker({ name: 'Ravi Renamed' })),
      }),
    );
    const dialog = await openBroker();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Edit details' }));
    const form = await screen.findByRole('dialog', { name: 'Edit broker' });
    const name = within(form).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Ravi Renamed');
    await userEvent.click(within(form).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Ravi Renamed updated')).toBeInTheDocument();
    expect(sent(calls, `PATCH /api/brokers/${BROKER_ID}`)[0]?.body).toEqual({
      name: 'Ravi Renamed',
      phone: '9000000001',
      address: null,
      rowVersion: 3,
    });
  });
});

describe('a broker and their rules', () => {
  it('shows the rule in force, the rules that were replaced and what is owed', async () => {
    open();
    const dialog = await openBroker();
    const table = await within(dialog).findByRole('table', { name: 'Commission rules' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('2.5%');
    expect(rows[1]).toHaveTextContent('In force');
    expect(rows[2]).toHaveTextContent('500.00 a sale');
    expect(rows[2]).toHaveTextContent('Replaced');
    expect(within(dialog).getByText('350.00')).toBeInTheDocument();
  });

  it('sets a new rule, and refuses a percentage over 100 without asking the server', async () => {
    const { calls } = open(
      handlers(MANAGER, broker(), {
        [`POST /api/brokers/${BROKER_ID}/rules`]: () => jsonResponse(broker(), 201),
      }),
    );
    const dialog = await openBroker();
    await userEvent.type(await within(dialog).findByLabelText('Percentage'), '150');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set new rule' }));
    expect(
      await within(dialog).findByText('A percentage cannot be more than 100'),
    ).toBeInTheDocument();
    expect(sent(calls, `POST /api/brokers/${BROKER_ID}/rules`)).toHaveLength(0);

    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of rule'), 'FIXED');
    const value = within(dialog).getByLabelText('Amount');
    await userEvent.clear(value);
    await userEvent.type(value, '750');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Set new rule' }));
    await waitFor(() =>
      expect(sent(calls, `POST /api/brokers/${BROKER_ID}/rules`)).toHaveLength(1),
    );
    expect(sent(calls, `POST /api/brokers/${BROKER_ID}/rules`)[0]?.body).toEqual({
      type: 'FIXED',
      value: '750',
    });
  });

  it('switches a broker off and offers no new rule for one that is off', async () => {
    const { calls } = open(
      handlers(MANAGER, broker(), {
        [`PATCH /api/brokers/${BROKER_ID}`]: () => jsonResponse(broker({ isActive: false })),
      }),
    );
    const dialog = await openBroker();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Switch off' }));
    await waitFor(() => expect(sent(calls, `PATCH /api/brokers/${BROKER_ID}`)).toHaveLength(1));
    expect(sent(calls, `PATCH /api/brokers/${BROKER_ID}`)[0]?.body).toEqual({
      isActive: false,
      rowVersion: 3,
    });
  });

  it('shows no rule form for a broker that is switched off', async () => {
    open(handlers(MANAGER, broker({ isActive: false })));
    const dialog = await openBroker();
    await within(dialog).findByRole('table', { name: 'Commission rules' });
    expect(within(dialog).queryByRole('button', { name: 'Set new rule' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Switch on' })).toBeInTheDocument();
  });

  it('says so when a broker has no rule', async () => {
    open(handlers(MANAGER, broker({ activeRule: null, rules: [] })));
    const dialog = await openBroker();
    expect(await within(dialog).findByText(/no standing rule/)).toBeInTheDocument();
  });

  it('opens the ledger with the balance, and says a negative one is money to get back', async () => {
    open();
    const dialog = await openBroker();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Open ledger' }));
    const book = await screen.findByRole('table', { name: 'Broker ledger' });
    const rows = within(book).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Paid out');
    expect(rows[1]).toHaveTextContent('100.00 to get back');
    expect(rows[2]).toHaveTextContent('Commission');
    expect(rows[2]).toHaveTextContent('700.00');
    expect(screen.getByText(/Owed to the broker now: 100.00 to get back/)).toBeInTheDocument();
  });
});

describe('commissions and payout', () => {
  it('shows each commission with how it was worked out, what was taken back and its worth now', async () => {
    open();
    await tab('Commissions');
    const row = within(await screen.findByRole('table', { name: 'Commissions' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('HQ/NG/26-27/00001');
    expect(row).toHaveTextContent('Ravi Broker');
    expect(row).toHaveTextContent('Asha Rao');
    expect(row).toHaveTextContent('250.00');
    expect(row).toHaveTextContent('2.5% of 10000.00');
    expect(row).toHaveTextContent('200.00');
    expect(row).toHaveTextContent('50.00 taken back');
    expect(row).toHaveTextContent('To pay');
  });

  it('asks the server for the status the user chose', async () => {
    const { calls } = open();
    await tab('Commissions');
    await screen.findByRole('table', { name: 'Commissions' });
    expect(lastList(calls, 'GET /api/commissions?')).toContain('status=PAYABLE');
    await userEvent.selectOptions(screen.getByLabelText('Commission status'), 'PAID');
    await waitFor(() => expect(lastList(calls, 'GET /api/commissions?')).toContain('status=PAID'));
  });

  it('pays out the chosen commissions with a reference', async () => {
    const { calls } = open(
      handlers(MANAGER, broker(), {
        'POST /api/commissions/payout': () =>
          jsonResponse({
            brokerId: BROKER_ID,
            brokerName: 'Ravi Broker',
            total: '200.00',
            commissions: [commission({ status: 'PAID' })],
          }),
      }),
    );
    await tab('Commissions');
    const pay = await screen.findByRole('button', { name: 'Pay out chosen (0)' });
    expect(pay).toBeDisabled();
    await userEvent.click(
      await screen.findByLabelText('Choose the commission on HQ/NG/26-27/00001'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay out chosen (1)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Total to pay: 200.00')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Reference'), ' CHQ 91 ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay out' }));
    expect(await screen.findByText('200.00 paid out to Ravi Broker')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/commissions/payout')[0]?.body).toEqual({
      commissionIds: [COMMISSION_ID],
      reference: 'CHQ 91',
    });
  });

  it('lets only one broker be chosen at a time', async () => {
    open(
      handlers(MANAGER, broker(), {
        'GET /api/commissions?*': () =>
          jsonResponse(
            pageOf([
              commission(),
              commission({ id: COMMISSION_2, invoiceNo: 'HQ/NG/26-27/00002' }),
              commission({
                id: COMMISSION_3,
                invoiceNo: 'HQ/NG/26-27/00003',
                brokerId: OTHER_ID,
                brokerName: 'Other Broker',
              }),
            ]),
          ),
      }),
    );
    await tab('Commissions');
    await userEvent.click(
      await screen.findByLabelText('Choose the commission on HQ/NG/26-27/00001'),
    );
    expect(screen.getByLabelText('Choose the commission on HQ/NG/26-27/00002')).toBeEnabled();
    expect(screen.getByLabelText('Choose the commission on HQ/NG/26-27/00003')).toBeDisabled();
    await userEvent.click(screen.getByLabelText('Choose the commission on HQ/NG/26-27/00002'));
    expect(screen.getByRole('button', { name: 'Pay out chosen (2)' })).toBeEnabled();
  });

  it('shows what the server refused when a payout fails', async () => {
    open(
      handlers(MANAGER, broker(), {
        'POST /api/commissions/payout': () =>
          jsonResponse(
            {
              code: 'VALIDATION_ERROR',
              message: 'These commissions cannot be paid',
              details: [{ field: 'commissionIds', message: 'HQ/NG/26-27/00001 is already paid' }],
              requestId: 'r',
            },
            400,
          ),
      }),
    );
    await tab('Commissions');
    await userEvent.click(
      await screen.findByLabelText('Choose the commission on HQ/NG/26-27/00001'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pay out chosen (1)' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay out' }));
    expect(await within(dialog).findByText('These commissions cannot be paid')).toBeInTheDocument();
    expect(within(dialog).getByText('HQ/NG/26-27/00001 is already paid')).toBeInTheDocument();
  });

  it('shows a paid commission lowered afterwards as money to get back, and offers no choosing for it', async () => {
    open(
      handlers(MANAGER, broker(), {
        'GET /api/commissions?*': () =>
          jsonResponse(
            pageOf([
              commission({
                status: 'PAID',
                paidAt: '2026-10-10T05:00:00.000Z',
                paidAmount: '250.00',
                toRecover: '50.00',
              }),
            ]),
          ),
      }),
    );
    await tab('Commissions');
    const row = within(await screen.findByRole('table', { name: 'Commissions' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('50.00 to get back');
    expect(row).toHaveTextContent('Paid');
    expect(within(row).queryByRole('checkbox')).not.toBeInTheDocument();
  });
});

describe('who sees what', () => {
  it('offers a viewer the lists and ledger but no changing and no paying', async () => {
    open(handlers(VIEWER));
    await screen.findByRole('table', { name: 'Brokers' });
    expect(screen.queryByRole('button', { name: 'New broker' })).not.toBeInTheDocument();
    const dialog = await openBroker();
    await within(dialog).findByRole('table', { name: 'Commission rules' });
    for (const name of ['Edit details', 'Switch off', 'Set new rule'])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Open ledger' })).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await tab('Commissions');
    await screen.findByRole('table', { name: 'Commissions' });
    expect(screen.queryByRole('button', { name: /Pay out chosen/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('keeps people without brokers.view away, and lists Brokers in the menu for those who may', async () => {
    open(handlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Brokers' })).not.toBeInTheDocument();
  });

  it('lists Brokers in the menu for people who may view them', async () => {
    open(handlers(VIEWER));
    expect(await screen.findByRole('link', { name: 'Brokers' })).toBeInTheDocument();
  });
});

describe('broker address, photo and documents', () => {
  const create = vi.fn(() => 'blob:broker-file');
  const revoke = vi.fn();
  beforeEach(() => {
    create.mockClear();
    revoke.mockClear();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke }));
  });
  afterEach(() => vi.restoreAllMocks());

  const picture = () =>
    new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } });
  const withPhoto = (over: Partial<Broker> = {}): Broker =>
    broker({
      address: '12 Station Road, Howrah',
      hasPhoto: true,
      photo: {
        id: 'f-1',
        kind: 'PHOTO',
        label: null,
        fileName: 'face.png',
        mimeType: 'image/png',
        sizeBytes: 1200,
        uploadedAt: '2026-10-02T05:00:00.000Z',
      },
      documents: [
        {
          id: 'd-1',
          kind: 'DOCUMENT',
          label: 'Aadhaar card',
          fileName: 'aadhaar.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 2048,
          uploadedAt: '2026-10-03T05:00:00.000Z',
        },
      ],
      ...over,
    });

  it('shows the address and the photo, and keeps the address when adding a broker', async () => {
    open(
      handlers(MANAGER, withPhoto(), {
        [`GET /api/brokers/${BROKER_ID}/photo`]: picture,
      }),
    );
    const dialog = await openBroker();
    expect(await within(dialog).findByText('12 Station Road, Howrah')).toBeInTheDocument();
    expect(
      await within(dialog).findByRole('img', { name: 'Photo of Ravi Broker' }),
    ).toHaveAttribute('src', 'blob:broker-file');
  });

  it('sends the address typed in the form', async () => {
    const { calls } = open(
      handlers(MANAGER, broker(), {
        'POST /api/brokers': () => jsonResponse(broker({ name: 'Asha Verma' }), 201),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'New broker' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Asha Verma');
    await userEvent.type(within(dialog).getByLabelText('Address'), '5 Park Street');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add broker' }));
    await screen.findByText('Broker Asha Verma added');
    expect(sent(calls, 'POST /api/brokers').at(-1)?.body).toMatchObject({
      address: '5 Park Street',
    });
  });

  it('uploads a chosen photo and shows the one that comes back', async () => {
    let stored = broker();
    const { calls } = open(
      handlers(MANAGER, broker(), {
        [`GET /api/brokers/${BROKER_ID}`]: () => jsonResponse(stored),
        [`POST /api/brokers/${BROKER_ID}/photo?*`]: () => {
          stored = withPhoto();
          return jsonResponse(stored, 201);
        },
        [`GET /api/brokers/${BROKER_ID}/photo`]: picture,
      }),
    );
    const dialog = await openBroker();
    const input = await within(dialog).findByLabelText('Add photo');
    await userEvent.upload(input, new File(['x'], 'face.png', { type: 'image/png' }));
    expect(
      await within(dialog).findByRole('img', { name: 'Photo of Ravi Broker' }),
    ).toBeInTheDocument();
    expect(
      calls.some((call) =>
        call.key.startsWith(`POST /api/brokers/${BROKER_ID}/photo?fileName=face.png`),
      ),
    ).toBe(true);
  });

  it('refuses a file over 5 MB without sending it', async () => {
    const { calls } = open(handlers(MANAGER, broker()));
    const dialog = await openBroker();
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    await userEvent.upload(await within(dialog).findByLabelText('Add photo'), big);
    expect(await within(dialog).findByText('The file is larger than 5 MB')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('POST /api/brokers/'))).toBe(false);
  });

  it('removes the photo', async () => {
    const { calls } = open(
      handlers(MANAGER, withPhoto(), {
        [`GET /api/brokers/${BROKER_ID}/photo`]: picture,
        [`DELETE /api/brokers/${BROKER_ID}/photo`]: () =>
          jsonResponse(withPhoto({ photo: null, hasPhoto: false })),
      }),
    );
    const dialog = await openBroker();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Remove photo' }));
    await waitFor(() =>
      expect(calls.some((call) => call.key === `DELETE /api/brokers/${BROKER_ID}/photo`)).toBe(
        true,
      ),
    );
  });

  it('lists the documents and shows one inside the dialog', async () => {
    open(
      handlers(MANAGER, withPhoto(), {
        [`GET /api/brokers/${BROKER_ID}/photo`]: picture,
        [`GET /api/brokers/${BROKER_ID}/documents/d-1/file`]: () =>
          new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } }),
      }),
    );
    const dialog = await openBroker();
    const table = await within(dialog).findByRole('table', { name: 'Broker documents' });
    expect(table).toHaveTextContent('Aadhaar card');
    expect(table).toHaveTextContent('aadhaar.pdf');
    await userEvent.click(within(dialog).getByRole('button', { name: 'View Aadhaar card' }));
    const preview = await within(dialog).findByRole('region', { name: 'Document preview' });
    expect(within(preview).getByTitle('Aadhaar card · aadhaar.pdf')).toHaveAttribute(
      'src',
      'blob:broker-file',
    );
    await userEvent.click(within(preview).getByRole('button', { name: 'Close preview' }));
    expect(
      within(dialog).queryByRole('region', { name: 'Document preview' }),
    ).not.toBeInTheDocument();
  });

  it('adds a document with the name typed for it', async () => {
    const { calls } = open(
      handlers(MANAGER, broker(), {
        [`POST /api/brokers/${BROKER_ID}/documents?*`]: () => jsonResponse(withPhoto(), 201),
        [`GET /api/brokers/${BROKER_ID}/photo`]: picture,
      }),
    );
    const dialog = await openBroker();
    await userEvent.type(await within(dialog).findByLabelText('What the document is'), 'Agreement');
    await userEvent.upload(
      within(dialog).getByLabelText('Add a document'),
      new File(['%PDF-1.4'], 'agreement.pdf', { type: 'application/pdf' }),
    );
    await waitFor(() =>
      expect(
        calls.some((call) =>
          call.key.startsWith(
            `POST /api/brokers/${BROKER_ID}/documents?fileName=agreement.pdf&label=Agreement`,
          ),
        ),
      ).toBe(true),
    );
  });

  it('lets someone who may only view see the photo and documents, and change nothing', async () => {
    open(
      handlers(VIEWER, withPhoto(), {
        [`GET /api/brokers/${BROKER_ID}/photo`]: picture,
      }),
    );
    const dialog = await openBroker();
    await within(dialog).findByRole('table', { name: 'Broker documents' });
    expect(within(dialog).queryByLabelText('Add photo')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Replace photo')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Add a document')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });
});

describe('commission agreed on the invoice, in the list', () => {
  const create = vi.fn(() => 'blob:gift');
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('says what a gift and a fixed amount are, and shows the gift photo', async () => {
    open(
      handlers(MANAGER, broker(), {
        'GET /api/commissions?*': () =>
          jsonResponse(
            pageOf([
              commission({
                kind: 'GIFT',
                ruleType: null,
                ruleValue: null,
                giftName: 'Mixer grinder',
                hasGiftPhoto: true,
                amount: '800.00',
                effective: '800.00',
                adjusted: '0.00',
              }),
              commission({
                id: COMMISSION_2,
                invoiceNo: 'HQ/NG/26-27/00002',
                kind: 'FIXED',
                ruleType: null,
                ruleValue: null,
                amount: '150.00',
                effective: '150.00',
                adjusted: '0.00',
              }),
            ]),
          ),
        [`GET /api/commissions/${COMMISSION_ID}/gift-photo`]: () =>
          new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } }),
      }),
    );
    await tab('Commissions');
    const rows = within(await screen.findByRole('table', { name: 'Commissions' })).getAllByRole(
      'row',
    );
    expect(rows[1]).toHaveTextContent('Gift: Mixer grinder');
    expect(rows[2]).toHaveTextContent('Agreed with the broker');
    await userEvent.click(
      within(rows[1] as HTMLElement).getByRole('button', {
        name: 'View gift photo for HQ/NG/26-27/00001',
      }),
    );
    const dialog = await screen.findByRole('dialog', { name: /Gift: Mixer grinder/ });
    expect(await within(dialog).findByRole('img', { name: 'Gift: Mixer grinder' })).toHaveAttribute(
      'src',
      'blob:gift',
    );
  });
});
