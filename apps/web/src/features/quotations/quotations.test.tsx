import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Quotation, QuotationSummary } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import {
  BRANCH_ID,
  CUSTOMER,
  CUSTOMER_ID,
  ITEM_ID,
  makeInvoice,
  pageOf,
  serialUnits,
} from '../billing/test-data';
import { itemPage, makeItem } from '../items/test-data';

const QUOTE_ID = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const LINE_ID = '3b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const UNIT_ID = '4b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const VIEWER = ['quotations.view'];
const WORKER = [
  'quotations.view',
  'quotations.manage',
  'payments.create',
  'invoices.create',
  'customers.view',
  'items.view',
];

const quotation = (over: Partial<Quotation> = {}): Quotation => ({
  id: QUOTE_ID,
  quotationNo: 'HQ/QT/26-27/00001',
  status: 'ACCEPTED',
  branchId: BRANCH_ID,
  branchCode: 'HQ',
  customerId: CUSTOMER_ID,
  customerName: 'Ravi Kumar',
  type: 'NON_GST',
  validUntil: '2026-11-30',
  isCustomBuild: false,
  buildStage: 'NOT_STARTED',
  total: '95000.00',
  advancePaid: '25000.00',
  createdAt: '2026-10-09T05:00:00.000Z',
  subtotal: '95000.00',
  discountTotal: '0.00',
  taxableValue: '95000.00',
  cgstAmount: '0.00',
  sgstAmount: '0.00',
  igstAmount: '0.00',
  roundOff: '0.00',
  placeOfSupply: null,
  interState: false,
  brokerId: null,
  brokerName: null,
  specification: null,
  balanceDue: '70000.00',
  sentAt: '2026-10-09T06:00:00.000Z',
  acceptedAt: '2026-10-09T07:00:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  createdByName: 'Meera Nair',
  rowVersion: 4,
  lines: [
    {
      id: LINE_ID,
      lineNo: 1,
      itemId: ITEM_ID,
      itemCode: 'TOTO-X1',
      itemName: 'TOTO X1',
      isSerialized: false,
      qty: 1,
      unitPrice: '95000.00',
      discountAmount: '0.00',
      taxRate: null,
      taxableAmount: '95000.00',
      amount: '95000.00',
      unit: null,
    },
  ],
  advances: [
    {
      paymentId: 'pay-1',
      receiptNo: 'HQRCT/2627/00007',
      mode: 'UPI',
      modeName: 'UPI',
      amount: '25000.00',
      paidOn: '2026-10-09',
      reference: null,
      status: 'ACTIVE',
    },
  ],
  buildUpdates: [],
  invoiceId: null,
  invoiceNo: null,
  invoiceStatus: null,
  ...over,
});
const summaryOf = (q: Quotation): QuotationSummary => ({
  id: q.id,
  quotationNo: q.quotationNo,
  status: q.status,
  branchId: q.branchId,
  branchCode: q.branchCode,
  customerId: q.customerId,
  customerName: q.customerName,
  type: q.type,
  validUntil: q.validUntil,
  isCustomBuild: q.isCustomBuild,
  buildStage: q.buildStage,
  total: q.total,
  advancePaid: q.advancePaid,
  createdAt: q.createdAt,
});

const handlers = (
  permissions: string[] = WORKER,
  current: Quotation = quotation(),
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...signedIn(
    makeSession({ permissions, branches: [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }] }),
  ),
  'GET /api/quotations?*': () => jsonResponse(pageOf([summaryOf(current)])),
  [`GET /api/quotations/${current.id}`]: () => jsonResponse(current),
  'GET /api/customers?*': () => jsonResponse(pageOf([CUSTOMER])),
  'GET /api/reference/payment-modes': () =>
    jsonResponse([
      { code: 'CASH', name: 'Cash' },
      { code: 'UPI', name: 'UPI' },
    ]),
  'GET /api/stock/serial-units?*': () => jsonResponse(serialUnits([[UNIT_ID, 'VEH-0001']])),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  const view = renderApp('/quotations');
  return { ...state, ...view };
};
const sent = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((c) => c.key === key);
const lastList = (calls: { key: string }[], prefix: string) =>
  calls.filter((c) => c.key.startsWith(prefix)).at(-1)?.key ?? '';
const openQuote = async () => {
  await userEvent.click(
    await screen.findByRole('button', { name: 'Open quotation HQ/QT/26-27/00001' }),
  );
  return screen.findByRole('dialog');
};

describe('the quotation list', () => {
  it('shows each quotation with its total, advance and status, and the build stage of a custom order', async () => {
    open(handlers(WORKER, quotation({ isCustomBuild: true, buildStage: 'IN_BUILD' })));
    const row = within(await screen.findByRole('table', { name: 'Quotations' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('HQ/QT/26-27/00001');
    expect(row).toHaveTextContent('Ravi Kumar');
    expect(row).toHaveTextContent('95000.00');
    expect(row).toHaveTextContent('25000.00');
    expect(row).toHaveTextContent('Accepted');
    expect(row).toHaveTextContent('Build: Being built');
  });

  it('asks the server for the search, status and custom-build filter the user chose', async () => {
    const { calls } = open();
    await screen.findByRole('table', { name: 'Quotations' });
    expect(lastList(calls, 'GET /api/quotations?')).toContain('status=open');
    await userEvent.type(screen.getByLabelText('Search quotations'), 'ravi');
    await userEvent.selectOptions(screen.getByLabelText('Quotation status'), 'EXPIRED');
    await userEvent.click(screen.getByLabelText('Only customized builds'));
    await waitFor(() => {
      const last = lastList(calls, 'GET /api/quotations?');
      expect(last).toContain('search=ravi');
      expect(last).toContain('status=EXPIRED');
      expect(last).toContain('customOnly=true');
    });
  });

  it('says so when there are none, and recovers from an error', async () => {
    let fail = true;
    open(
      handlers(WORKER, quotation(), {
        'GET /api/quotations?*': () =>
          fail
            ? jsonResponse(
                { code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' },
                500,
              )
            : jsonResponse(pageOf([])),
      }),
    );
    expect(await screen.findByText('Could not load the quotations.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('There are no quotations yet.')).toBeInTheDocument();
  });
});

describe('writing a quotation', () => {
  it('names what is missing and sends nothing', async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'New quotation' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByText('Choose the customer')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Item')).toHaveAttribute('aria-invalid', 'true');
    expect(sent(calls, 'POST /api/quotations')).toHaveLength(0);
  });

  it('asks for a description when the order is a customized build', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'New quotation' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('What is to be built')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('A customized build'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByText('Describe what is to be built')).toBeInTheDocument();
  });

  it('sends the customer, type, validity, build details and lines', async () => {
    const { calls } = open(
      handlers(WORKER, quotation(), {
        'POST /api/quotations': () => jsonResponse(quotation({ status: 'DRAFT' }), 201),
        'GET /api/items?*': () =>
          jsonResponse(
            itemPage([
              makeItem({ id: ITEM_ID, itemCode: 'TOTO-X1', name: 'TOTO X1', isSerialized: true }),
            ]),
          ),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'New quotation' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Customer'), 'Ravi');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching customers'),
      CUSTOMER_ID,
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Type'), 'NON_GST');
    await userEvent.click(within(dialog).getByLabelText('A customized build'));
    await userEvent.type(
      within(dialog).getByLabelText('What is to be built'),
      'Red body, 60V motor',
    );
    await userEvent.type(within(dialog).getByLabelText('Item'), 'TOTO');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching items for Item'),
      ITEM_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Price'), '95000.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Quotation written')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/quotations')[0]?.body).toMatchObject({
      customerId: CUSTOMER_ID,
      type: 'NON_GST',
      isCustomBuild: true,
      specification: 'Red body, 60V motor',
      brokerId: null,
      lines: [{ itemId: ITEM_ID, qty: 1, unitPrice: '95000.00', discountAmount: '0.00' }],
    });
  });

  it('shows what the server refused', async () => {
    open(
      handlers(WORKER, quotation(), {
        'POST /api/quotations': () =>
          jsonResponse(
            {
              code: 'VALIDATION_ERROR',
              message: 'The quotation has problems',
              details: [{ field: 'lines.0.itemId', message: 'TOTO-X1 has no GST rate' }],
              requestId: 'r',
            },
            400,
          ),
        'GET /api/items?*': () =>
          jsonResponse(
            itemPage([
              makeItem({ id: ITEM_ID, itemCode: 'TOTO-X1', name: 'TOTO X1', isSerialized: true }),
            ]),
          ),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'New quotation' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Customer'), 'Ravi');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching customers'),
      CUSTOMER_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Item'), 'TOTO');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching items for Item'),
      ITEM_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Price'), '100.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByText('The quotation has problems')).toBeInTheDocument();
    expect(within(dialog).getAllByText('TOTO-X1 has no GST rate').length).toBeGreaterThan(0);
  });
});

describe('working a quotation', () => {
  it('shows its lines, totals, advances and what is still to pay', async () => {
    open();
    const dialog = await openQuote();
    const lines = await within(dialog).findByRole('table', { name: 'Quoted lines' });
    expect(lines).toHaveTextContent('TOTO-X1');
    expect(lines).toHaveTextContent('95000.00');
    expect(within(dialog).getByText('70000.00')).toBeInTheDocument();
    const advances = within(dialog).getByRole('table', { name: 'Advances' });
    expect(advances).toHaveTextContent('HQRCT/2627/00007');
    expect(advances).toHaveTextContent('Held');
  });

  it('sends a draft and records that the customer accepted a sent one', async () => {
    const { calls } = open(
      handlers(
        WORKER,
        quotation({ status: 'DRAFT', advances: [], advancePaid: '0.00', balanceDue: '95000.00' }),
        {
          [`POST /api/quotations/${QUOTE_ID}/send`]: () =>
            jsonResponse(quotation({ status: 'SENT', advances: [] })),
        },
      ),
    );
    const dialog = await openQuote();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Send to customer' }));
    await waitFor(() =>
      expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/send`)).toHaveLength(1),
    );
    expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/send`)[0]?.body).toEqual({
      rowVersion: 4,
    });
  });

  it('accepts a sent quotation', async () => {
    const { calls } = open(
      handlers(WORKER, quotation({ status: 'SENT', advances: [], advancePaid: '0.00' }), {
        [`POST /api/quotations/${QUOTE_ID}/accept`]: () => jsonResponse(quotation()),
      }),
    );
    const dialog = await openQuote();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Customer accepted' }));
    await waitFor(() =>
      expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/accept`)).toHaveLength(1),
    );
  });

  it('needs a reason to cancel, and sends it', async () => {
    const { calls } = open(
      handlers(WORKER, quotation({ advances: [], advancePaid: '0.00' }), {
        [`POST /api/quotations/${QUOTE_ID}/cancel`]: () =>
          jsonResponse(quotation({ status: 'CANCELLED' })),
      }),
    );
    const dialog = await openQuote();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Cancel quotation' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 3 characters'),
    ).toBeInTheDocument();
    expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/cancel`)).toHaveLength(0);
    await userEvent.type(
      within(dialog).getByLabelText('Reason for cancelling'),
      'Customer withdrew',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel quotation' }));
    expect(await screen.findByText('HQ/QT/26-27/00001 cancelled')).toBeInTheDocument();
    expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/cancel`)[0]?.body).toEqual({
      reason: 'Customer withdrew',
      rowVersion: 4,
    });
  });

  it('shows why a cancellation was refused, such as an advance still held', async () => {
    open(
      handlers(WORKER, quotation(), {
        [`POST /api/quotations/${QUOTE_ID}/cancel`]: () =>
          jsonResponse(
            {
              code: 'BUSINESS_RULE_VIOLATION',
              message: 'An advance has been paid against this quotation',
              details: [
                {
                  field: 'advances',
                  message: 'Reverse the advance payments before cancelling the quotation',
                },
              ],
              requestId: 'r',
            },
            422,
          ),
      }),
    );
    const dialog = await openQuote();
    await userEvent.type(
      await within(dialog).findByLabelText('Reason for cancelling'),
      'Customer withdrew',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel quotation' }));
    expect(
      await within(dialog).findByText('An advance has been paid against this quotation'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Reverse the advance payments before cancelling the quotation'),
    ).toBeInTheDocument();
  });

  it('takes an advance with a retry key, and refuses a bad amount without asking the server', async () => {
    const { calls } = open(
      handlers(WORKER, quotation(), {
        [`POST /api/quotations/${QUOTE_ID}/advance`]: () => jsonResponse(quotation(), 201),
      }),
    );
    const dialog = await openQuote();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Take advance' }));
    expect(
      await within(dialog).findByText('Enter an amount in rupees, with at most 2 decimals'),
    ).toBeInTheDocument();
    expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/advance`)).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Advance amount'), '10000');
    await userEvent.selectOptions(within(dialog).getByLabelText('Paid by'), 'UPI');
    await userEvent.type(within(dialog).getByLabelText('Advance reference'), 'UTR55');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Take advance' }));
    await waitFor(() =>
      expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/advance`)).toHaveLength(1),
    );
    const body = sent(calls, `POST /api/quotations/${QUOTE_ID}/advance`)[0]?.body as Record<
      string,
      string
    >;
    expect(body).toMatchObject({ amount: '10000', mode: 'UPI', reference: 'UTR55' });
    expect(body['idempotencyKey']?.length).toBeGreaterThanOrEqual(8);
  });

  it('offers no advance once the quotation is fully paid', async () => {
    open(handlers(WORKER, quotation({ advancePaid: '95000.00', balanceDue: '0.00' })));
    const dialog = await openQuote();
    await within(dialog).findByRole('table', { name: 'Advances' });
    expect(within(dialog).queryByRole('button', { name: 'Take advance' })).not.toBeInTheDocument();
  });

  it('chooses a vehicle with its chassis and motor numbers', async () => {
    const serialLine = { ...quotation().lines[0]!, isSerialized: true };
    const { calls } = open(
      handlers(WORKER, quotation({ isCustomBuild: true, lines: [serialLine] }), {
        [`POST /api/quotations/${QUOTE_ID}/lines/${LINE_ID}/unit`]: () => jsonResponse(quotation()),
      }),
    );
    const dialog = await openQuote();
    expect(await within(dialog).findByText('No vehicle chosen yet')).toBeInTheDocument();
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Vehicle for TOTO-X1'),
      UNIT_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Chassis number for TOTO-X1'), 'CH-0042');
    await userEvent.type(within(dialog).getByLabelText('Motor number for TOTO-X1'), 'MT-0042');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Set the vehicle for TOTO-X1' }),
    );
    await waitFor(() =>
      expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/lines/${LINE_ID}/unit`)).toHaveLength(1),
    );
    expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/lines/${LINE_ID}/unit`)[0]?.body).toEqual({
      serialUnitId: UNIT_ID,
      chassisNo: 'CH-0042',
      motorNo: 'MT-0042',
      rowVersion: 4,
    });
  });

  it('shows the vehicle, its numbers and its batteries once chosen', async () => {
    const serialLine = {
      ...quotation().lines[0]!,
      isSerialized: true,
      unit: {
        id: UNIT_ID,
        serialNo: 'VEH-0001',
        chassisNo: 'CH-0042',
        motorNo: null,
        batteries: [
          { id: 'b1', serialNo: 'BAT-1' },
          { id: 'b2', serialNo: 'BAT-2' },
        ],
      },
    };
    open(handlers(WORKER, quotation({ lines: [serialLine] })));
    const dialog = await openQuote();
    expect(
      await within(dialog).findByText(
        /Vehicle VEH-0001 · chassis CH-0042 · motor not recorded · batteries BAT-1, BAT-2/,
      ),
    ).toBeInTheDocument();
  });

  it('tracks the build of a custom order, offering only the stages it may move to', async () => {
    const { calls } = open(
      handlers(
        WORKER,
        quotation({
          isCustomBuild: true,
          specification: 'Red body',
          buildStage: 'QUALITY_CHECK',
          buildUpdates: [
            {
              id: 'u1',
              stage: 'QUALITY_CHECK',
              note: 'Brakes tested',
              createdByName: 'Meera Nair',
              createdAt: '2026-10-10T05:00:00.000Z',
            },
          ],
        }),
        {
          [`POST /api/quotations/${QUOTE_ID}/build`]: () => jsonResponse(quotation()),
        },
      ),
    );
    const dialog = await openQuote();
    expect(await within(dialog).findByText('Build: Quality check')).toBeInTheDocument();
    const select = within(dialog).getByLabelText('Move the build to');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a stage', 'Being built', 'Ready for delivery']);
    expect(
      within(within(dialog).getByRole('list', { name: 'Build history' })).getByText(
        /Brakes tested/,
      ),
    ).toBeInTheDocument();
    await userEvent.selectOptions(select, 'READY');
    await userEvent.type(within(dialog).getByLabelText('Build note'), 'All checks passed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Update build' }));
    await waitFor(() =>
      expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/build`)).toHaveLength(1),
    );
    expect(sent(calls, `POST /api/quotations/${QUOTE_ID}/build`)[0]?.body).toEqual({
      stage: 'READY',
      note: 'All checks passed',
      rowVersion: 4,
    });
  });

  it('makes the draft invoice and says where to issue it', async () => {
    const { calls } = open(
      handlers(WORKER, quotation(), {
        'POST /api/invoices/from-quotation': () => jsonResponse(makeInvoice({ id: 'inv-9' }), 201),
      }),
    );
    const dialog = await openQuote();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Make the invoice' }));
    expect(
      await screen.findByText(/A draft invoice was made from HQ\/QT\/26-27\/00001/),
    ).toBeInTheDocument();
    expect(sent(calls, 'POST /api/invoices/from-quotation')[0]?.body).toEqual({
      quotationId: QUOTE_ID,
      rowVersion: 4,
      dueDate: null,
    });
  });

  it('shows why delivery was refused, such as an order not fully paid', async () => {
    open(
      handlers(WORKER, quotation(), {
        'POST /api/invoices/from-quotation': () =>
          jsonResponse(
            {
              code: 'BUSINESS_RULE_VIOLATION',
              message: 'This quotation is not ready to deliver',
              details: [{ field: 'stage', message: 'The build is not marked ready yet' }],
              requestId: 'r',
            },
            422,
          ),
      }),
    );
    const dialog = await openQuote();
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Make the invoice' }));
    expect(
      await within(dialog).findByText('This quotation is not ready to deliver'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('The build is not marked ready yet')).toBeInTheDocument();
  });

  it('shows the invoice made from the quotation instead of offering another', async () => {
    open(
      handlers(WORKER, quotation({ invoiceId: 'inv-9', invoiceNo: null, invoiceStatus: 'DRAFT' })),
    );
    const dialog = await openQuote();
    expect(await within(dialog).findByText('Draft, not yet issued')).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Make the invoice' }),
    ).not.toBeInTheDocument();
  });

  it('says an expired quotation no longer holds its prices, and offers nothing to do with it', async () => {
    open(handlers(WORKER, quotation({ status: 'EXPIRED', advances: [], advancePaid: '0.00' })));
    const dialog = await openQuote();
    expect(await within(dialog).findByText(/no longer held/)).toBeInTheDocument();
    for (const name of [
      'Send to customer',
      'Customer accepted',
      'Take advance',
      'Make the invoice',
      'Cancel quotation',
    ])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
  });
});

describe('who sees what', () => {
  it('offers a viewer the list and the detail but nothing to change', async () => {
    open(handlers(VIEWER));
    await screen.findByRole('table', { name: 'Quotations' });
    expect(screen.queryByRole('button', { name: 'New quotation' })).not.toBeInTheDocument();
    const dialog = await openQuote();
    await within(dialog).findByRole('table', { name: 'Quoted lines' });
    for (const name of [
      'Send to customer',
      'Customer accepted',
      'Take advance',
      'Make the invoice',
      'Cancel quotation',
      'Edit quotation',
    ])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('offers no advance to someone who may not take payments', async () => {
    open(handlers(['quotations.view', 'quotations.manage', 'invoices.create']));
    const dialog = await openQuote();
    await within(dialog).findByRole('table', { name: 'Quoted lines' });
    expect(within(dialog).queryByRole('button', { name: 'Take advance' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Make the invoice' })).toBeInTheDocument();
  });

  it('keeps people without quotations.view away, and lists Quotations in the menu for those who may', async () => {
    open(handlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Quotations' })).not.toBeInTheDocument();
  });

  it('lists Quotations in the menu for people who may view them', async () => {
    open(handlers(VIEWER));
    expect(await screen.findByRole('link', { name: 'Quotations' })).toBeInTheDocument();
  });
});
