import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PaymentSummarySchema } from '@erp/contracts';
import type {
  CustomerDue,
  CustomerLedger,
  DueInvoice,
  Payment,
  PaymentSummary,
} from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { BRANCH_ID, CUSTOMER, CUSTOMER_ID, pageOf } from '../billing/test-data';

const VIEWER = ['payments.view'];
const CASHIER = ['payments.view', 'payments.create', 'customers.view'];
const MANAGER = [...CASHIER, 'payments.reverse'];

const INVOICE_ID = '3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f';
const due = (over: Partial<DueInvoice> = {}): DueInvoice => ({
  invoiceId: INVOICE_ID,
  invoiceNo: 'HQ/GI/26-27/00001',
  type: 'GST',
  branchId: BRANCH_ID,
  branchCode: 'HQ',
  customerId: CUSTOMER_ID,
  customerName: 'Ravi Kumar',
  issuedOn: '2026-10-01',
  dueDate: '2026-10-05',
  total: '1000.00',
  credited: '0.00',
  paid: '400.00',
  outstanding: '600.00',
  surplus: '0.00',
  status: 'PARTIAL',
  overdue: true,
  overdueDays: 5,
  ...over,
});
const dueList = (items: DueInvoice[] = [due()]) => ({
  ...pageOf(items),
  totals: { invoices: items.length, outstanding: '600.00', overdue: '600.00' },
});
const customerDue = (over: Partial<CustomerDue> = {}): CustomerDue => ({
  customerId: CUSTOMER_ID,
  customerName: 'Ravi Kumar',
  phone: '9000000001',
  openInvoices: 2,
  outstanding: '900.00',
  overdue: '600.00',
  credit: '50.00',
  ...over,
});
const payment = (over: Partial<Payment> = {}): Payment => ({
  id: 'pay-1',
  receiptNo: 'HQRCT/2627/00001',
  status: 'ACTIVE',
  branchId: BRANCH_ID,
  branchCode: 'HQ',
  customerId: CUSTOMER_ID,
  customerName: 'Ravi Kumar',
  mode: 'UPI',
  modeName: 'UPI',
  amount: '1000.00',
  allocated: '700.00',
  unallocated: '300.00',
  paidOn: '2026-10-09',
  reference: 'UTR123',
  note: null,
  allocations: [{ invoiceId: 'inv-1', invoiceNo: 'HQ/GI/26-27/00001', amount: '700.00' }],
  reversal: null,
  createdByName: 'Asha Rao',
  createdAt: '2026-10-09T05:00:00.000Z',
  ...over,
});
const summaryOf = (p: Payment): PaymentSummary => PaymentSummarySchema.parse(p);
const ledger = (over: Partial<CustomerLedger> = {}): CustomerLedger => ({
  ...pageOf([
    {
      date: '2026-10-09',
      type: 'PAYMENT' as const,
      documentNo: 'HQRCT/2627/00001',
      documentId: 'pay-1',
      branchCode: 'HQ',
      description: 'Payment received by UPI',
      debit: '0.00',
      credit: '1000.00',
      balance: '-100.00',
    },
    {
      date: '2026-10-01',
      type: 'INVOICE' as const,
      documentNo: 'HQ/GI/26-27/00001',
      documentId: 'inv-1',
      branchCode: 'HQ',
      description: 'Invoice issued',
      debit: '900.00',
      credit: '0.00',
      balance: '900.00',
    },
  ]),
  customerId: CUSTOMER_ID,
  customerName: 'Ravi Kumar',
  balance: '-100.00',
  ...over,
});

const handlers = (
  permissions: string[] = MANAGER,
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...signedIn(
    makeSession({ permissions, branches: [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }] }),
  ),
  'GET /api/dues?*': () => jsonResponse(dueList()),
  'GET /api/dues/customers?*': () => jsonResponse(pageOf([customerDue()])),
  [`GET /api/dues/customers/${CUSTOMER_ID}/ledger?*`]: () => jsonResponse(ledger()),
  'GET /api/payments?*': () => jsonResponse(pageOf([summaryOf(payment())])),
  'GET /api/payments/pay-1': () => jsonResponse(payment()),
  'GET /api/customers?*': () => jsonResponse(pageOf([CUSTOMER])),
  'GET /api/reference/payment-modes': () =>
    jsonResponse([
      { code: 'CASH', name: 'Cash' },
      { code: 'UPI', name: 'UPI' },
    ]),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  const view = renderApp('/payments');
  return { ...state, ...view };
};
const tab = async (name: string) => userEvent.click(await screen.findByRole('tab', { name }));
const posts = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((call) => call.key === key);

const fillCustomerAndAmount = async (amount: string) => {
  await userEvent.type(screen.getByLabelText('Customer'), 'ravi');
  await userEvent.selectOptions(await screen.findByLabelText('Matching customers'), CUSTOMER_ID);
  await userEvent.type(screen.getByLabelText('Amount received'), amount);
};

describe('the dues list', () => {
  it('shows what each invoice owes, with overdue days and the totals', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Invoices due' });
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(row).toHaveTextContent('HQ/GI/26-27/00001');
    expect(row).toHaveTextContent('Ravi Kumar');
    expect(row).toHaveTextContent('600.00');
    expect(row).toHaveTextContent('Part paid');
    expect(row).toHaveTextContent('Overdue by 5 days');
    expect(
      screen.getByText(/1 invoices owing · Outstanding 600.00 · Overdue 600.00/),
    ).toBeInTheDocument();
  });

  it('asks the server for the scope and search the user chose', async () => {
    const { calls } = open();
    await screen.findByRole('table', { name: 'Invoices due' });
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'overdue');
    await userEvent.type(screen.getByLabelText('Search dues'), 'ravi');
    await waitFor(() => {
      const last = calls.filter((c) => c.key.startsWith('GET /api/dues?')).at(-1)?.key ?? '';
      expect(last).toContain('scope=overdue');
      expect(last).toContain('search=ravi');
    });
  });

  it('says so when nothing is owed, and recovers from an error', async () => {
    let fail = true;
    open(
      handlers(MANAGER, {
        'GET /api/dues?*': () =>
          fail
            ? jsonResponse(
                { code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' },
                500,
              )
            : jsonResponse(dueList([])),
      }),
    );
    expect(await screen.findByText('Could not load the dues.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Nothing is owed.')).toBeInTheDocument();
  });

  it('offers to take a payment from a customer who owes money', async () => {
    open();
    await userEvent.click(
      await screen.findByRole('button', { name: 'Take payment for HQ/GI/26-27/00001' }),
    );
    expect(await screen.findByText('Chosen: Ravi Kumar')).toBeInTheDocument();
  });
});

describe('customers and their ledger', () => {
  it('lists what each customer owes and the credit held, and opens the ledger', async () => {
    open();
    await tab('Customers');
    const table = await screen.findByRole('table', { name: 'Customer dues' });
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(row).toHaveTextContent('Ravi Kumar');
    expect(row).toHaveTextContent('900.00');
    expect(row).toHaveTextContent('50.00');

    await userEvent.click(screen.getByRole('button', { name: 'Open ledger of Ravi Kumar' }));
    const book = await screen.findByRole('table', { name: 'Customer ledger' });
    const lines = within(book).getAllByRole('row');
    expect(lines[1]).toHaveTextContent('Payment');
    expect(lines[1]).toHaveTextContent('100.00 credit');
    expect(lines[2]).toHaveTextContent('Invoice');
    expect(lines[2]).toHaveTextContent('900.00');
    expect(screen.getByText(/Balance now: 100.00 credit/)).toBeInTheDocument();
  });

  it('says so when the ledger is empty', async () => {
    open(
      handlers(MANAGER, {
        [`GET /api/dues/customers/${CUSTOMER_ID}/ledger?*`]: () =>
          jsonResponse(ledger({ ...pageOf([]), balance: '0.00' })),
      }),
    );
    await tab('Customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Open ledger of Ravi Kumar' }));
    expect(await screen.findByText('Nothing has been billed or paid yet.')).toBeInTheDocument();
  });
});

describe('recording a payment', () => {
  it('checks the form before it asks the server', async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record payment', hidden: false }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(await within(dialog).findByText('Choose the customer')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter an amount in rupees, with at most 2 decimals'),
    ).toBeInTheDocument();
    expect(posts(calls, 'POST /api/payments')).toHaveLength(0);
  });

  it('sends the customer, amount, mode, a retry key and the allocation choice', async () => {
    const { calls } = open(
      handlers(MANAGER, { 'POST /api/payments': () => jsonResponse(payment(), 201) }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await fillCustomerAndAmount('1000');
    await userEvent.selectOptions(within(dialog).getByLabelText('Paid by'), 'UPI');
    await userEvent.type(within(dialog).getByLabelText('Reference'), ' UTR123 ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));

    expect(
      await screen.findByText('Receipt HQRCT/2627/00001 recorded for Ravi Kumar'),
    ).toBeInTheDocument();
    const sent = posts(calls, 'POST /api/payments')[0]?.body as Record<string, unknown>;
    expect(sent).toMatchObject({
      customerId: CUSTOMER_ID,
      mode: 'UPI',
      amount: '1000',
      reference: 'UTR123',
      allocateAutomatically: true,
      allocations: [],
    });
    expect(String(sent['idempotencyKey']).length).toBeGreaterThanOrEqual(8);
  });

  it('reuses the retry key when the same form is sent again, and makes a new one after an edit', async () => {
    let fail = true;
    const { calls } = open(
      handlers(MANAGER, {
        'POST /api/payments': () =>
          fail
            ? jsonResponse(
                { code: 'INTERNAL_ERROR', message: 'Lost', details: [], requestId: 'r' },
                500,
              )
            : jsonResponse(payment(), 201),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await fillCustomerAndAmount('250');
    const submit = within(dialog).getByRole('button', { name: 'Record payment' });
    await userEvent.click(submit);
    await within(dialog).findByText('Lost');
    await userEvent.click(submit);
    await waitFor(() => expect(posts(calls, 'POST /api/payments')).toHaveLength(2));
    const [first, second] = posts(calls, 'POST /api/payments').map(
      (c) => (c.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(second).toBe(first);

    await userEvent.type(within(dialog).getByLabelText('Amount received'), '0');
    fail = false;
    await userEvent.click(submit);
    await waitFor(() => expect(posts(calls, 'POST /api/payments')).toHaveLength(3));
    const third = (posts(calls, 'POST /api/payments')[2]?.body as { idempotencyKey: string })
      .idempotencyKey;
    expect(third).not.toBe(first);
  });

  it('shows what the server refused, such as a repeated reference', async () => {
    open(
      handlers(MANAGER, {
        'POST /api/payments': () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'This reference was already used for a payment',
              details: [
                {
                  field: 'reference',
                  message: 'Receipt HQRCT/2627/00009 already has this reference.',
                },
              ],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await fillCustomerAndAmount('50');
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'UTR9');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(
      await within(dialog).findByText('This reference was already used for a payment'),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText(/already has this reference/).length).toBeGreaterThan(0);
  });

  it('lets the user choose the invoices and sends the amounts for each', async () => {
    const { calls } = open(
      handlers(MANAGER, { 'POST /api/payments': () => jsonResponse(payment(), 201) }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await fillCustomerAndAmount('600');
    await userEvent.click(within(dialog).getByLabelText('Choose the invoices'));
    await userEvent.type(
      await within(dialog).findByLabelText('Amount for HQ/GI/26-27/00001'),
      '600',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    await screen.findByText(/recorded for Ravi Kumar/);
    expect(posts(calls, 'POST /api/payments')[0]?.body).toMatchObject({
      allocateAutomatically: false,
      allocations: [{ invoiceId: INVOICE_ID, amount: '600' }],
    });
  });

  it('says which invoice amount is wrong when it is zero', async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await fillCustomerAndAmount('100');
    await userEvent.click(within(dialog).getByLabelText('Choose the invoices'));
    await userEvent.type(await within(dialog).findByLabelText('Amount for HQ/GI/26-27/00001'), '0');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(
      await within(dialog).findByText('The amount must be more than zero'),
    ).toBeInTheDocument();
    expect(posts(calls, 'POST /api/payments')).toHaveLength(0);
  });

  it('refuses invoice amounts that add up to more than the payment', async () => {
    const { calls } = open();
    await userEvent.click(await screen.findByRole('button', { name: 'Record payment' }));
    const dialog = await screen.findByRole('dialog');
    await fillCustomerAndAmount('100');
    await userEvent.click(within(dialog).getByLabelText('Choose the invoices'));
    await userEvent.type(
      await within(dialog).findByLabelText('Amount for HQ/GI/26-27/00001'),
      '150',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record payment' }));
    expect(
      await within(dialog).findByText('The invoice amounts add up to more than the payment'),
    ).toBeInTheDocument();
    expect(posts(calls, 'POST /api/payments')).toHaveLength(0);
  });
});

describe('a single payment', () => {
  it('shows its details and the invoices it settled', async () => {
    open();
    await tab('Payments');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open receipt HQRCT/2627/00001' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('UTR123')).toBeInTheDocument();
    const table = within(dialog).getByRole('table', { name: 'Invoices settled' });
    expect(table).toHaveTextContent('HQ/GI/26-27/00001');
    expect(table).toHaveTextContent('700.00');
  });

  it('reverses a payment with a reason, and refuses an empty reason', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        'POST /api/payments/pay-1/reverse': () =>
          jsonResponse(payment({ status: 'REVERSED', unallocated: '0.00' })),
      }),
    );
    await tab('Payments');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open receipt HQRCT/2627/00001' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Reverse payment' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 3 characters'),
    ).toBeInTheDocument();
    expect(posts(calls, 'POST /api/payments/pay-1/reverse')).toHaveLength(0);

    await userEvent.type(within(dialog).getByLabelText('Reason for reversing'), 'Cheque bounced');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse payment' }));
    expect(await screen.findByText('Receipt HQRCT/2627/00001 reversed')).toBeInTheDocument();
    expect(posts(calls, 'POST /api/payments/pay-1/reverse')[0]?.body).toEqual({
      reason: 'Cheque bounced',
    });
  });

  it('applies what is left to the oldest dues', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        'POST /api/payments/pay-1/allocations': () =>
          jsonResponse(payment({ unallocated: '0.00' })),
      }),
    );
    await tab('Payments');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open receipt HQRCT/2627/00001' }),
    );
    await userEvent.click(
      await screen.findByRole('button', { name: 'Apply the rest to the oldest dues' }),
    );
    expect(await screen.findByText(/was applied to the oldest dues/)).toBeInTheDocument();
    expect(posts(calls, 'POST /api/payments/pay-1/allocations')[0]?.body).toEqual({
      allocateAutomatically: true,
    });
  });

  it("shows the server's reason when a reversal is refused", async () => {
    open(
      handlers(MANAGER, {
        'POST /api/payments/pay-1/reverse': () =>
          jsonResponse(
            {
              code: 'INVALID_STATE',
              message: 'The payment cannot move from REVERSED to REVERSED',
              details: [],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    await tab('Payments');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open receipt HQRCT/2627/00001' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(await within(dialog).findByLabelText('Reason for reversing'), 'Twice');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse payment' }));
    expect(await within(dialog).findByText(/cannot move from REVERSED/)).toBeInTheDocument();
  });

  it('shows a reversed payment with no actions', async () => {
    const reversed = payment({
      status: 'REVERSED',
      unallocated: '0.00',
      reversal: {
        reason: 'Cheque bounced',
        reversedOn: '2026-10-10',
        reversedAt: '2026-10-10T05:00:00.000Z',
        reversedByName: 'Meera Nair',
      },
    });
    open(handlers(MANAGER, { 'GET /api/payments/pay-1': () => jsonResponse(reversed) }));
    await tab('Payments');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open receipt HQRCT/2627/00001' }),
    );
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Cheque bounced/)).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Reverse payment' }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Apply the rest to the oldest dues' }),
    ).not.toBeInTheDocument();
  });

  it('asks the server for the status the user chose', async () => {
    const { calls } = open();
    await tab('Payments');
    await screen.findByRole('table', { name: 'Payments' });
    await userEvent.selectOptions(screen.getByLabelText('Payment status'), 'REVERSED');
    await waitFor(() =>
      expect(calls.filter((c) => c.key.startsWith('GET /api/payments?')).at(-1)?.key).toContain(
        'status=REVERSED',
      ),
    );
  });
});

describe('who sees what', () => {
  it('offers recording to people who may create payments', async () => {
    open(handlers(CASHIER));
    await screen.findByRole('table', { name: 'Invoices due' });
    expect(screen.getByRole('button', { name: 'Record payment' })).toBeInTheDocument();
  });

  it('offers no recording or reversing to people who may only view', async () => {
    open(handlers(VIEWER));
    await screen.findByRole('table', { name: 'Invoices due' });
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Take payment for/ })).not.toBeInTheDocument();
    await tab('Payments');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Open receipt HQRCT/2627/00001' }),
    );
    await screen.findByRole('table', { name: 'Invoices settled' });
    expect(screen.queryByRole('button', { name: 'Reverse payment' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Apply the rest to the oldest dues' }),
    ).not.toBeInTheDocument();
  });

  it('keeps people without payments.view away', async () => {
    open(handlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Invoices due' })).not.toBeInTheDocument();
  });

  it('lists Payments in the menu only for people who may view them', async () => {
    open(handlers(VIEWER));
    expect(await screen.findByRole('link', { name: 'Payments' })).toBeInTheDocument();
  });
});

describe("refunding a customer's credit", () => {
  const REFUNDER = [...MANAGER, 'payments.refund'];
  const creditOf = (over: Record<string, string> = {}) => ({
    customerId: CUSTOMER_ID,
    branchId: BRANCH_ID,
    credit: '1000.00',
    heldForOrders: '0.00',
    refunded: '0.00',
    refundable: '1000.00',
    ...over,
  });
  const refundHandlers = (
    permissions: string[] = REFUNDER,
    extra: Record<string, RouteHandler> = {},
  ) =>
    handlers(permissions, {
      'GET /api/refunds/credit?*': () => jsonResponse(creditOf()),
      'GET /api/reference/payment-modes': () =>
        jsonResponse([
          { code: 'CASH', name: 'Cash' },
          { code: 'UPI', name: 'UPI' },
          { code: 'EXCHANGE', name: 'Exchange (old unit taken back)' },
        ]),
      ...extra,
    });
  const openRefund = async (h: Record<string, RouteHandler> = refundHandlers()) => {
    const state = open(h);
    await tab('Customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Open ledger of Ravi Kumar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Refund credit' }));
    const dialog = await screen.findByRole('dialog', { name: /Refund Ravi Kumar/ });
    return { ...state, dialog };
  };

  it('offers a refund only to someone who may pay one, and only when the customer has credit', async () => {
    open(refundHandlers(MANAGER));
    await tab('Customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Open ledger of Ravi Kumar' }));
    await screen.findByRole('table', { name: 'Customer ledger' });
    expect(screen.queryByRole('button', { name: 'Refund credit' })).not.toBeInTheDocument();
  });

  it('offers no refund when the customer owes money instead', async () => {
    open(
      refundHandlers(REFUNDER, {
        [`GET /api/dues/customers/${CUSTOMER_ID}/ledger?*`]: () =>
          jsonResponse(ledger({ balance: '250.00' })),
      }),
    );
    await tab('Customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Open ledger of Ravi Kumar' }));
    await screen.findByRole('table', { name: 'Customer ledger' });
    expect(screen.queryByRole('button', { name: 'Refund credit' })).not.toBeInTheDocument();
  });

  it('shows what is held and what can be refunded, and what is held for an order', async () => {
    const { dialog } = await openRefund(
      refundHandlers(REFUNDER, {
        'GET /api/refunds/credit?*': () =>
          jsonResponse(creditOf({ heldForOrders: '700.00', refundable: '300.00' })),
      }),
    );
    const summary = await within(dialog).findByRole('region', { name: 'Credit held' });
    expect(summary).toHaveTextContent('Credit held: 1000.00');
    expect(summary).toHaveTextContent(
      '700.00 is held for an accepted order and cannot be refunded.',
    );
    expect(summary).toHaveTextContent('Can be refunded: 300.00');
  });

  it('does not offer the mode only exchanges use', async () => {
    const { dialog } = await openRefund();
    const modes = await within(dialog).findByLabelText('Paid back by');
    await within(modes).findByRole('option', { name: 'UPI' });
    expect(within(modes).queryByRole('option', { name: /Exchange/ })).not.toBeInTheDocument();
  });

  it('names what is missing and sends nothing', async () => {
    const { dialog, calls } = await openRefund();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay refund' }));
    expect(await within(dialog).findByText(/Enter an amount/)).toBeInTheDocument();
    expect(within(dialog).getByText('Give a reason of at least 3 characters')).toBeInTheDocument();
    expect(posts(calls, 'POST /api/refunds')).toHaveLength(0);
  });

  it('pays a refund and says which number it got', async () => {
    const { dialog, calls } = await openRefund(
      refundHandlers(REFUNDER, {
        'POST /api/refunds': () =>
          jsonResponse(
            {
              id: 'rf-1',
              refundNo: 'HQRFD/2627/00001',
              branchId: BRANCH_ID,
              branchCode: 'HQ',
              customerId: CUSTOMER_ID,
              customerName: 'Ravi Kumar',
              amount: '250.00',
              mode: 'UPI',
              modeName: 'UPI',
              paidOn: '2026-10-10',
              reference: 'UTR-1',
              reason: 'Asked for it back',
              createdByName: 'Meera Nair',
              createdAt: '2026-10-10T05:00:00.000Z',
            },
            201,
          ),
      }),
    );
    await userEvent.type(within(dialog).getByLabelText('Amount'), ' 250.00 ');
    await userEvent.selectOptions(within(dialog).getByLabelText('Paid back by'), 'UPI');
    await userEvent.type(within(dialog).getByLabelText('Reference'), 'UTR-1');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Asked for it back');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay refund' }));
    expect(
      await screen.findByText('Refund HQRFD/2627/00001 of 250.00 paid to Ravi Kumar'),
    ).toBeInTheDocument();
    const body = posts(calls, 'POST /api/refunds')[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      customerId: CUSTOMER_ID,
      amount: '250.00',
      mode: 'UPI',
      reference: 'UTR-1',
      reason: 'Asked for it back',
    });
    expect(body).not.toHaveProperty('branchId');
    expect(String(body['idempotencyKey']).length).toBeGreaterThanOrEqual(8);
  });

  it('shows what the server refused, and keeps the same retry key for the second try', async () => {
    let refuse = true;
    const { dialog, calls } = await openRefund(
      refundHandlers(REFUNDER, {
        'POST /api/refunds': () =>
          refuse
            ? jsonResponse(
                {
                  code: 'VALIDATION_ERROR',
                  message: 'That is more than can be refunded',
                  details: [{ field: 'amount', message: 'Only 1000.00 can be refunded' }],
                  requestId: 'r',
                },
                400,
              )
            : jsonResponse(
                {
                  id: 'rf-2',
                  refundNo: 'HQRFD/2627/00002',
                  branchId: BRANCH_ID,
                  branchCode: 'HQ',
                  customerId: CUSTOMER_ID,
                  customerName: 'Ravi Kumar',
                  amount: '900.00',
                  mode: 'CASH',
                  modeName: 'Cash',
                  paidOn: '2026-10-10',
                  reference: null,
                  reason: 'Asked for it back',
                  createdByName: null,
                  createdAt: '2026-10-10T05:00:00.000Z',
                },
                201,
              ),
      }),
    );
    await userEvent.type(within(dialog).getByLabelText('Amount'), '1500');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Asked for it back');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay refund' }));
    expect(
      await within(dialog).findByText('That is more than can be refunded'),
    ).toBeInTheDocument();
    expect(within(dialog).getAllByText('Only 1000.00 can be refunded').length).toBeGreaterThan(0);
    refuse = false;
    await userEvent.clear(within(dialog).getByLabelText('Amount'));
    await userEvent.type(within(dialog).getByLabelText('Amount'), '900');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Pay refund' }));
    expect(await screen.findByText(/Refund HQRFD\/2627\/00002 of 900.00 paid/)).toBeInTheDocument();
    const keys = posts(calls, 'POST /api/refunds').map(
      (c) => (c.body as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  it('labels a refund in the ledger', async () => {
    open(
      refundHandlers(REFUNDER, {
        [`GET /api/dues/customers/${CUSTOMER_ID}/ledger?*`]: () =>
          jsonResponse(
            ledger({
              ...pageOf([
                {
                  date: '2026-10-10',
                  type: 'REFUND' as const,
                  documentNo: 'HQRFD/2627/00001',
                  documentId: 'rf-1',
                  branchCode: 'HQ',
                  description: 'Refund paid by Cash',
                  debit: '250.00',
                  credit: '0.00',
                  balance: '-750.00',
                },
              ]),
              balance: '-750.00',
            }),
          ),
      }),
    );
    await tab('Customers');
    await userEvent.click(await screen.findByRole('button', { name: 'Open ledger of Ravi Kumar' }));
    const book = await screen.findByRole('table', { name: 'Customer ledger' });
    expect(within(book).getAllByRole('row')[1]).toHaveTextContent('Refund paid');
    expect(within(book).getAllByRole('row')[1]).toHaveTextContent('HQRFD/2627/00001');
  });
});
