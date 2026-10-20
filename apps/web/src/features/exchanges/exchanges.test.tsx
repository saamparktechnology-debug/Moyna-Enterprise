import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Exchange, ExchangeOptions, ExchangeSummary } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { ISSUED, MANAGER, billingHandlers, pageOf } from '../billing/test-data';

const EXCHANGE_ID = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const NEW_UNIT = '3b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const OLD_UNIT = '4b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const ORIGINAL_ID = '5b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const REQUESTER = [...MANAGER, 'exchanges.request'];
const APPROVER = [...MANAGER, 'exchanges.request', 'exchanges.approve'];
const VIEWER = ['invoices.view'];

const DELIVERY_ID = '6b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const delivery = ISSUED({ id: DELIVERY_ID });
const unit = (id: string, serialNo: string, over: Record<string, unknown> = {}) => ({
  id,
  serialNo,
  itemCode: 'TOTO-X1',
  itemName: 'TOTO X1',
  chassisNo: 'CH-0042',
  motorNo: 'MT-0042',
  state: 'SOLD',
  batteries: [{ id: 'bat-1', serialNo: 'BAT-0001' }],
  ...over,
});

const exchange = (over: Partial<Exchange> = {}): Exchange => ({
  id: EXCHANGE_ID,
  exchangeNo: 'HQEXC/2627/00001',
  status: 'PENDING',
  kind: 'OLD_FOR_NEW',
  branchId: delivery.branchId,
  branchCode: 'HQ',
  customerId: delivery.customerId,
  customerName: delivery.customerName,
  invoiceId: delivery.id,
  invoiceNo: delivery.invoiceNo,
  originalInvoiceId: ORIGINAL_ID,
  originalInvoiceNo: 'HQ/NG/26-27/00007',
  oldSerialNo: 'SN-OLD',
  newSerialNo: 'SN-NEW',
  valuationAmount: '40000.00',
  newAmount: '100000.00',
  differenceAmount: '60000.00',
  settlement: 'PAYABLE',
  disposition: 'STOCK',
  createdAt: '2026-10-10T05:00:00.000Z',
  reason: 'Customer wants the larger model',
  returnedAmount: '60000.00',
  decisionNote: null,
  decidedAt: null,
  decidedByName: null,
  createdByName: 'Asha Rao',
  rowVersion: 3,
  oldUnit: unit(OLD_UNIT, 'SN-OLD'),
  newUnit: unit(NEW_UNIT, 'SN-NEW', { state: 'SOLD', batteries: [] }),
  tradeInPayment: null,
  ...over,
});
const summaryOf = (e: Exchange): ExchangeSummary => ({
  id: e.id,
  exchangeNo: e.exchangeNo,
  status: e.status,
  kind: e.kind,
  branchId: e.branchId,
  branchCode: e.branchCode,
  customerId: e.customerId,
  customerName: e.customerName,
  invoiceId: e.invoiceId,
  invoiceNo: e.invoiceNo,
  originalInvoiceId: e.originalInvoiceId,
  originalInvoiceNo: e.originalInvoiceNo,
  oldSerialNo: e.oldSerialNo,
  newSerialNo: e.newSerialNo,
  valuationAmount: e.valuationAmount,
  newAmount: e.newAmount,
  differenceAmount: e.differenceAmount,
  settlement: e.settlement,
  disposition: e.disposition,
  createdAt: e.createdAt,
});

const options: ExchangeOptions = {
  invoiceId: delivery.id,
  invoiceNo: delivery.invoiceNo,
  customerName: delivery.customerName,
  newUnits: [
    {
      unitId: NEW_UNIT,
      serialNo: 'SN-NEW',
      itemCode: 'TOTO-X1',
      itemName: 'TOTO X1',
      lineAmount: '100000.00',
    },
  ],
  oldUnits: [
    {
      unitId: OLD_UNIT,
      serialNo: 'SN-OLD',
      itemCode: 'TOTO-X1',
      itemName: 'TOTO X1',
      chassisNo: 'CH-0042',
      motorNo: null,
      originalInvoiceId: ORIGINAL_ID,
      originalInvoiceNo: 'HQ/NG/26-27/00007',
      soldOn: '2026-01-05',
      lineAmount: '60000.00',
      batteries: [{ id: 'bat-1', serialNo: 'BAT-0001' }],
    },
  ],
};

const handlers = (
  permissions: string[] = APPROVER,
  current: Exchange = exchange(),
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...billingHandlers(permissions, [delivery]),
  'GET /api/exchanges?*': () => jsonResponse(pageOf([summaryOf(current)])),
  [`GET /api/exchanges/${current.id}`]: () => jsonResponse(current),
  'GET /api/exchanges/options?*': () => jsonResponse(options),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  const view = renderApp('/exchanges');
  return { ...state, ...view };
};
const sent = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((c) => c.key === key);
const lastList = (calls: { key: string }[], prefix: string) =>
  calls.filter((c) => c.key.startsWith(prefix)).at(-1)?.key ?? '';
const openExchange = async () => {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open exchange HQEXC/2627/00001' }),
  );
  return screen.findByRole('dialog');
};
const chooseInvoice = async (dialog: HTMLElement) => {
  await userEvent.type(within(dialog).getByLabelText('Delivery invoice'), 'HQ');
  await userEvent.selectOptions(
    await within(dialog).findByLabelText('Matching invoices'),
    delivery.id,
  );
};
const startRequest = async (h = handlers(REQUESTER)) => {
  const state = open(h);
  await userEvent.click(await screen.findByRole('button', { name: 'New exchange' }));
  const dialog = await screen.findByRole('dialog');
  return { ...state, dialog };
};

describe('the exchange list', () => {
  it('shows each exchange with its vehicles, its difference in words and its status', async () => {
    open();
    const row = within(await screen.findByRole('table', { name: 'Exchanges' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('HQEXC/2627/00001');
    expect(row).toHaveTextContent('Old for new');
    expect(row).toHaveTextContent(delivery.customerName);
    expect(row).toHaveTextContent('SN-OLD');
    expect(row).toHaveTextContent('SN-NEW');
    expect(row).toHaveTextContent('60000.00');
    expect(row).toHaveTextContent('The customer pays 60000.00');
    expect(row).toHaveTextContent('Waiting for approval');
  });

  it('asks the server for the search, status and kind the user chose', async () => {
    const { calls } = open();
    await screen.findByRole('table', { name: 'Exchanges' });
    await userEvent.type(screen.getByLabelText('Search exchanges'), 'SN-OLD');
    await userEvent.selectOptions(screen.getByLabelText('Exchange status'), 'APPROVED');
    await userEvent.selectOptions(screen.getByLabelText('Kind of exchange'), 'NEW_FOR_NEW');
    await waitFor(() => {
      const last = lastList(calls, 'GET /api/exchanges?');
      expect(last).toContain('search=SN-OLD');
      expect(last).toContain('status=APPROVED');
      expect(last).toContain('kind=NEW_FOR_NEW');
    });
  });

  it('says a refundable difference is held as credit', async () => {
    open(handlers(APPROVER, exchange({ differenceAmount: '-10000.00', settlement: 'REFUNDABLE' })));
    expect(
      await screen.findByText('10000.00 is held as credit for the customer'),
    ).toBeInTheDocument();
  });

  it('says so when there are none, and recovers from an error', async () => {
    let fail = true;
    open(
      handlers(APPROVER, exchange(), {
        'GET /api/exchanges?*': () =>
          fail
            ? jsonResponse(
                { code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' },
                500,
              )
            : jsonResponse(pageOf([])),
      }),
    );
    expect(await screen.findByText('Could not load the exchanges.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('No exchange has been asked for yet.')).toBeInTheDocument();
  });
});

describe('asking for an exchange', () => {
  it('names what is missing and sends nothing', async () => {
    const { dialog, calls } = await startRequest();
    await chooseInvoice(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for approval' }));
    expect(await within(dialog).findByText('Choose the new vehicle')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose the old vehicle')).toBeInTheDocument();
    expect(within(dialog).getByText('Say what the old vehicle is worth')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/exchanges')).toHaveLength(0);
  });

  it('offers the vehicles of the chosen invoice, and the batteries that come back with the old one', async () => {
    const { dialog } = await startRequest();
    await chooseInvoice(dialog);
    const newSelect = await within(dialog).findByLabelText('New vehicle');
    expect(
      within(newSelect)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a vehicle', 'SN-NEW · TOTO-X1 · 100000.00']);
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Old vehicle taken back'),
      OLD_UNIT,
    );
    expect(within(dialog).getByText(/Comes back with its batteries: BAT-0001/)).toBeInTheDocument();
  });

  it('shows what the exchange comes to as the user fills it in', async () => {
    const { dialog } = await startRequest();
    await chooseInvoice(dialog);
    await userEvent.selectOptions(await within(dialog).findByLabelText('New vehicle'), NEW_UNIT);
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Old vehicle taken back'),
      OLD_UNIT,
    );
    await userEvent.type(within(dialog).getByLabelText('What the old vehicle is worth'), '40000');
    const summary = within(dialog).getByRole('region', { name: 'What the exchange comes to' });
    expect(summary).toHaveTextContent('New vehicle: 100000.00');
    expect(summary).toHaveTextContent('Old vehicle taken back at: 40000');
    expect(summary).toHaveTextContent('The customer pays 60000.00 (60000.00)');
    await userEvent.clear(within(dialog).getByLabelText('What the old vehicle is worth'));
    await userEvent.type(within(dialog).getByLabelText('What the old vehicle is worth'), '110000');
    expect(
      within(dialog).getByRole('region', { name: 'What the exchange comes to' }),
    ).toHaveTextContent('10000.00 is held as credit for the customer (-10000.00)');
  });

  it('sends an old-for-new exchange with its valuation', async () => {
    const { dialog, calls } = await startRequest(
      handlers(REQUESTER, exchange(), {
        'POST /api/exchanges': () => jsonResponse(exchange(), 201),
      }),
    );
    await chooseInvoice(dialog);
    await userEvent.selectOptions(await within(dialog).findByLabelText('New vehicle'), NEW_UNIT);
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Old vehicle taken back'),
      OLD_UNIT,
    );
    await userEvent.type(
      within(dialog).getByLabelText('What the old vehicle is worth'),
      ' 40000.00 ',
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText('What becomes of the old vehicle'),
      'SCRAP',
    );
    await userEvent.type(
      within(dialog).getByLabelText('Reason'),
      'Customer wants the larger model',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for approval' }));
    expect(
      await screen.findByText('Exchange HQEXC/2627/00001 is waiting for approval'),
    ).toBeInTheDocument();
    expect(sent(calls, 'POST /api/exchanges')[0]?.body).toEqual({
      invoiceId: delivery.id,
      newSerialUnitId: NEW_UNIT,
      oldSerialUnitId: OLD_UNIT,
      kind: 'OLD_FOR_NEW',
      valuationAmount: '40000.00',
      disposition: 'SCRAP',
      reason: 'Customer wants the larger model',
    });
  });

  it('sends a new-for-new exchange with no valuation, because it is taken back at the price paid', async () => {
    const { dialog, calls } = await startRequest(
      handlers(REQUESTER, exchange(), {
        'POST /api/exchanges': () => jsonResponse(exchange({ kind: 'NEW_FOR_NEW' }), 201),
      }),
    );
    await chooseInvoice(dialog);
    await userEvent.selectOptions(await within(dialog).findByLabelText('New vehicle'), NEW_UNIT);
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Old vehicle taken back'),
      OLD_UNIT,
    );
    await userEvent.click(within(dialog).getByLabelText(/New for new/));
    expect(
      within(dialog).queryByLabelText('What the old vehicle is worth'),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('region', { name: 'What the exchange comes to' }),
    ).toHaveTextContent('Old vehicle taken back at: 60000.00');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Wrong model delivered');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for approval' }));
    await screen.findByText(/is waiting for approval/);
    const body = sent(calls, 'POST /api/exchanges')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'NEW_FOR_NEW', disposition: 'STOCK' });
    expect(body).not.toHaveProperty('valuationAmount');
  });

  it('shows what the server refused, such as a valuation above what was paid', async () => {
    const { dialog } = await startRequest(
      handlers(REQUESTER, exchange(), {
        'POST /api/exchanges': () =>
          jsonResponse(
            {
              code: 'VALIDATION_ERROR',
              message: 'The valuation is more than was paid',
              details: [
                {
                  field: 'valuationAmount',
                  message:
                    'The most it can be valued at is 60000.00, what the customer paid for it',
                },
              ],
              requestId: 'r',
            },
            400,
          ),
      }),
    );
    await chooseInvoice(dialog);
    await userEvent.selectOptions(await within(dialog).findByLabelText('New vehicle'), NEW_UNIT);
    await userEvent.selectOptions(
      within(dialog).getByLabelText('Old vehicle taken back'),
      OLD_UNIT,
    );
    await userEvent.type(within(dialog).getByLabelText('What the old vehicle is worth'), '50000');
    await userEvent.type(
      within(dialog).getByLabelText('Reason'),
      'Customer wants the larger model',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for approval' }));
    expect(
      await within(dialog).findByText('The valuation is more than was paid'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getAllByText(/The most it can be valued at is 60000.00/).length,
    ).toBeGreaterThan(0);
  });

  it('says when a customer has no vehicle that can be taken back, and when the invoice cannot take part', async () => {
    const empty = { ...options, oldUnits: [] };
    const first = await startRequest(
      handlers(REQUESTER, exchange(), {
        'GET /api/exchanges/options?*': () => jsonResponse(empty),
      }),
    );
    await chooseInvoice(first.dialog);
    expect(
      await within(first.dialog).findByText(/no vehicle sold to them that can be taken back/),
    ).toBeInTheDocument();
  });

  it('says when the invoice cannot take part in an exchange', async () => {
    const { dialog } = await startRequest(
      handlers(REQUESTER, exchange(), {
        'GET /api/exchanges/options?*': () =>
          jsonResponse(
            { code: 'BUSINESS_RULE_VIOLATION', message: 'x', details: [], requestId: 'r' },
            422,
          ),
      }),
    );
    await chooseInvoice(dialog);
    expect(
      await within(dialog).findByText('This invoice cannot take part in an exchange.'),
    ).toBeInTheDocument();
  });
});

describe('deciding an exchange', () => {
  it('shows the vehicles, their numbers and batteries, and the money', async () => {
    open();
    const dialog = await openExchange();
    const old = await within(dialog).findByRole('region', { name: 'Old vehicle taken back' });
    expect(old).toHaveTextContent('SN-OLD');
    expect(old).toHaveTextContent('Chassis CH-0042');
    expect(old).toHaveTextContent('Motor MT-0042');
    expect(old).toHaveTextContent('Batteries: BAT-0001');
    const money = within(dialog).getByRole('region', { name: 'The money' });
    expect(money).toHaveTextContent('Customer paid for the old vehicle: 60000.00');
    expect(money).toHaveTextContent('Valued at: 40000.00');
    expect(money).toHaveTextContent('The customer pays 60000.00');
    expect(within(dialog).getByText('Back into stock as returned goods')).toBeInTheDocument();
  });

  it('approves with the version that was read, and with an optional note', async () => {
    const { calls } = open(
      handlers(APPROVER, exchange(), {
        [`POST /api/exchanges/${EXCHANGE_ID}/approve`]: () =>
          jsonResponse(exchange({ status: 'APPROVED' })),
      }),
    );
    const dialog = await openExchange();
    await userEvent.type(await within(dialog).findByLabelText('Note'), ' Valuation checked ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Exchange HQEXC/2627/00001 approved')).toBeInTheDocument();
    expect(sent(calls, `POST /api/exchanges/${EXCHANGE_ID}/approve`)[0]?.body).toEqual({
      rowVersion: 3,
      note: 'Valuation checked',
    });
  });

  it('shows why an approval was refused, such as approving your own request', async () => {
    open(
      handlers(APPROVER, exchange(), {
        [`POST /api/exchanges/${EXCHANGE_ID}/approve`]: () =>
          jsonResponse(
            {
              code: 'FORBIDDEN',
              message:
                'You cannot approve an exchange you asked for. Ask another approver to approve it',
              details: [],
              requestId: 'r',
            },
            403,
          ),
      }),
    );
    const dialog = await openExchange();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Approve' }));
    expect(
      await within(dialog).findByText(/You cannot approve an exchange you asked for/),
    ).toBeInTheDocument();
  });

  it('needs a reason to reject, and sends it', async () => {
    const { calls } = open(
      handlers(APPROVER, exchange(), {
        [`POST /api/exchanges/${EXCHANGE_ID}/reject`]: () =>
          jsonResponse(exchange({ status: 'REJECTED' })),
      }),
    );
    const dialog = await openExchange();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Reject' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 3 characters'),
    ).toBeInTheDocument();
    expect(sent(calls, `POST /api/exchanges/${EXCHANGE_ID}/reject`)).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Valuation too high');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Exchange HQEXC/2627/00001 rejected')).toBeInTheDocument();
    expect(sent(calls, `POST /api/exchanges/${EXCHANGE_ID}/reject`)[0]?.body).toEqual({
      rowVersion: 3,
      note: 'Valuation too high',
    });
  });

  it('lets the person who asked withdraw a waiting request', async () => {
    const { calls } = open(
      handlers(REQUESTER, exchange(), {
        [`POST /api/exchanges/${EXCHANGE_ID}/cancel`]: () =>
          jsonResponse(exchange({ status: 'CANCELLED' })),
      }),
    );
    const dialog = await openExchange();
    expect(
      within(
        await within(dialog)
          .findByRole('region', { name: 'The money' })
          .then(() => dialog),
      ).queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw request' }));
    expect(await screen.findByText('Exchange HQEXC/2627/00001 withdrawn')).toBeInTheDocument();
    expect(sent(calls, `POST /api/exchanges/${EXCHANGE_ID}/cancel`)[0]?.body).toEqual({
      rowVersion: 3,
    });
  });

  it('shows an approved exchange with the trade-in receipt and who decided, and nothing more to do', async () => {
    open(
      handlers(
        APPROVER,
        exchange({
          status: 'APPROVED',
          decidedAt: '2026-10-11T05:00:00.000Z',
          decidedByName: 'Meera Nair',
          decisionNote: 'Valuation checked',
          tradeInPayment: {
            id: 'pay-1',
            receiptNo: 'HQRCT/2627/00033',
            amount: '40000.00',
            appliedToInvoice: '40000.00',
          },
        }),
      ),
    );
    const dialog = await openExchange();
    expect(
      await within(dialog).findByText(
        /Receipt HQRCT\/2627\/00033: 40000.00 paid in, of which 40000.00 went against/,
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText(/Approved by Meera Nair/)).toBeInTheDocument();
    for (const name of ['Approve', 'Reject', 'Withdraw request'])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
  });
});

describe('who sees what', () => {
  it('offers a viewer the list and the detail but nothing to change', async () => {
    open(handlers(VIEWER));
    await screen.findByRole('table', { name: 'Exchanges' });
    expect(screen.queryByRole('button', { name: 'New exchange' })).not.toBeInTheDocument();
    const dialog = await openExchange();
    await within(dialog).findByRole('region', { name: 'The money' });
    for (const name of ['Approve', 'Reject', 'Withdraw request'])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('keeps people without invoices.view away, and lists Exchanges in the menu for those who may', async () => {
    open(handlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Exchanges' })).not.toBeInTheDocument();
  });

  it('lists Exchanges in the menu for people who may view them', async () => {
    open(handlers(VIEWER));
    expect(await screen.findByRole('link', { name: 'Exchanges' })).toBeInTheDocument();
  });
});

describe('the payment mode for exchanges', () => {
  it('is not offered when recording a payment, because only an exchange may use it', async () => {
    routeFetch({
      ...billingHandlers(['payments.view', 'payments.create', 'customers.view']),
      'GET /api/dues?*': () =>
        jsonResponse({
          ...pageOf([]),
          totals: { invoices: 0, outstanding: '0.00', overdue: '0.00' },
        }),
      'GET /api/reference/payment-modes': () =>
        jsonResponse([
          { code: 'CASH', name: 'Cash' },
          { code: 'EXCHANGE', name: 'Exchange (old unit taken back)' },
        ]),
    });
    renderApp('/payments');
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    const select = await within(dialog).findByLabelText('Paid by');
    await within(select).findByRole('option', { name: 'Cash' });
    expect(within(select).queryByRole('option', { name: /Exchange/ })).not.toBeInTheDocument();
  });
});
