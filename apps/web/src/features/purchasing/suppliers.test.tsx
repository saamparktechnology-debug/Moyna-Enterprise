import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { ALL, CLERK, SUPPLIER_ID, makeSupplier, pageOf, purchasingHandlers } from './test-data';

const GSTIN = '27AAPFU0939F1ZV';
const balance = {
  supplierId: SUPPLIER_ID,
  charged: '2000.00',
  credited: '300.00',
  paid: '500.00',
  outstanding: '1200.00',
};
const supplierHandlers = (
  permissions: string[] = ALL,
  extra: Record<string, RouteHandler> = {},
) => ({
  ...purchasingHandlers(permissions),
  'GET /api/suppliers?*': () =>
    jsonResponse(pageOf([makeSupplier({ gstin: GSTIN, stateCode: '27' })])),
  'GET /api/reference/states': () =>
    jsonResponse([
      { code: '27', name: 'Maharashtra' },
      { code: '29', name: 'Karnataka' },
    ]),
  'GET /api/reference/payment-modes': () =>
    jsonResponse([
      { code: 'CASH', name: 'Cash' },
      { code: 'UPI', name: 'UPI' },
    ]),
  [`GET /api/suppliers/${SUPPLIER_ID}`]: () => jsonResponse({ ...makeSupplier(), balance }),
  [`GET /api/suppliers/${SUPPLIER_ID}/ledger?*`]: () =>
    jsonResponse({
      ...pageOf([
        {
          at: '2026-10-08T06:00:00.000Z',
          kind: 'RECEIPT',
          documentNo: 'GRN-HQ-0001',
          branchCode: 'HQ',
          description: '8 × BATT-48V',
          debit: '960.00',
          credit: '0.00',
          balance: '960.00',
        },
        {
          at: '2026-10-09T06:00:00.000Z',
          kind: 'PAYMENT',
          documentNo: 'PAY-0001',
          branchCode: 'HQ',
          description: 'UPI',
          debit: '0.00',
          credit: '500.00',
          balance: '460.00',
        },
      ]),
      balance,
    }),
  ...extra,
});
const open = async (permissions: string[] = ALL, extra: Record<string, RouteHandler> = {}) => {
  const state = routeFetch(supplierHandlers(permissions, extra));
  renderApp('/purchasing');
  await userEvent.click(await screen.findByRole('tab', { name: 'Suppliers' }));
  await screen.findByRole('table', { name: 'Suppliers' });
  return state;
};
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const conflict = (
  message: string,
  details: { field: string; message: string }[] = [],
  status = 409,
) => jsonResponse({ code: 'CONFLICT', message, details, requestId: 'r' }, status);

describe('the supplier list', () => {
  it('shows each supplier with GSTIN, phone, state and status', async () => {
    await open();
    const row = within(screen.getByRole('table', { name: 'Suppliers' })).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Bharat Batteries');
    expect(row).toHaveTextContent(GSTIN);
    expect(row).toHaveTextContent('9876543210');
    expect(row).toHaveTextContent('Active');
  });

  it('asks the server for the search and status the user chose', async () => {
    const { calls } = await open();
    await userEvent.type(screen.getByLabelText('Search'), 'bharat');
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'inactive');
    await waitFor(() => {
      const last =
        calls.filter((call) => call.key.startsWith('GET /api/suppliers?')).at(-1)?.key ?? '';
      expect(last).toContain('search=bharat');
      expect(last).toContain('status=inactive');
    });
  });

  it('explains an empty list', async () => {
    routeFetch({ ...supplierHandlers(), 'GET /api/suppliers?*': () => jsonResponse(pageOf([])) });
    renderApp('/purchasing');
    await userEvent.click(await screen.findByRole('tab', { name: 'Suppliers' }));
    expect(await screen.findByText('There are no suppliers yet.')).toBeInTheDocument();
  });

  it('lets only people who manage suppliers create or edit them', async () => {
    await open(CLERK);
    expect(screen.queryByRole('button', { name: 'New supplier' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Bharat Batteries' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ledger of Bharat Batteries' })).toBeInTheDocument();
  });
});

describe('creating and editing a supplier', () => {
  const openNew = async (extra: Record<string, RouteHandler> = {}) => {
    const state = await open(ALL, extra);
    await userEvent.click(screen.getByRole('button', { name: 'New supplier' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: '27 · Maharashtra' });
    return { ...state, dialog };
  };

  it('needs a name and checks the GSTIN against the chosen state', async () => {
    const { dialog, calls } = await openNew();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create supplier' }));
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Karnataka Cells');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), GSTIN);
    await userEvent.selectOptions(within(dialog).getByLabelText('State'), '29');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create supplier' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('GSTIN')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(calls.some((call) => call.key === 'POST /api/suppliers')).toBe(false);
  });

  it('creates the supplier with an upper-case GSTIN and confirms', async () => {
    const { dialog, calls } = await openNew({
      'POST /api/suppliers': () => jsonResponse(makeSupplier({ name: 'Pune Cells' }), 201),
    });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Pune Cells');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), GSTIN.toLowerCase());
    await userEvent.selectOptions(within(dialog).getByLabelText('State'), '27');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9876543210');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create supplier' }));
    expect(await screen.findByText('Supplier Pune Cells created')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/suppliers')).toEqual({
      name: 'Pune Cells',
      gstin: GSTIN,
      stateCode: '27',
      phone: '9876543210',
    });
  });

  it('puts a duplicate GSTIN message next to the field', async () => {
    const { dialog } = await openNew({
      'POST /api/suppliers': () =>
        conflict('A supplier with this GSTIN already exists', [
          { field: 'gstin', message: 'Used by Bharat Batteries' },
        ]),
    });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Copy Cells');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), GSTIN);
    await userEvent.selectOptions(within(dialog).getByLabelText('State'), '27');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create supplier' }));
    expect(await within(dialog).findByText('Used by Bharat Batteries')).toBeInTheDocument();
  });

  it('edits with the row version and can mark the supplier inactive', async () => {
    const { calls } = await open(ALL, {
      [`PATCH /api/suppliers/${SUPPLIER_ID}`]: () =>
        jsonResponse(makeSupplier({ isActive: false })),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Bharat Batteries' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Active'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Supplier Bharat Batteries saved')).toBeInTheDocument();
    expect(bodyOf(calls, `PATCH /api/suppliers/${SUPPLIER_ID}`)).toMatchObject({
      isActive: false,
      rowVersion: 2,
      gstin: GSTIN,
    });
  });

  it('shows why a supplier cannot be made inactive', async () => {
    await open(ALL, {
      [`PATCH /api/suppliers/${SUPPLIER_ID}`]: () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'This supplier still has open purchase orders',
            details: [],
            requestId: 'r',
          },
          422,
        ),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Edit Bharat Batteries' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Active'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(
      await within(dialog).findByText('This supplier still has open purchase orders'),
    ).toBeInTheDocument();
  });
});

describe('a supplier’s ledger and payments', () => {
  const openLedger = async (
    permissions: string[] = ALL,
    extra: Record<string, RouteHandler> = {},
  ) => {
    const state = await open(permissions, extra);
    await userEvent.click(screen.getByRole('button', { name: 'Ledger of Bharat Batteries' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('table', { name: 'Supplier ledger' });
    return { ...state, dialog };
  };

  it('shows what is owed, entry by entry', async () => {
    const { dialog } = await openLedger();
    expect(within(dialog).getByLabelText('Balance')).toHaveTextContent(
      'Charged 2000.00 · Credited 300.00 · Paid 500.00 · Owed 1200.00',
    );
    const [receipt, payment] = within(
      within(dialog).getByRole('table', { name: 'Supplier ledger' }),
    )
      .getAllByRole('row')
      .slice(1);
    expect(receipt).toHaveTextContent('Goods received: 8 × BATT-48V');
    expect(receipt).toHaveTextContent('960.00');
    expect(payment).toHaveTextContent('PAY-0001');
  });

  it('explains an empty ledger', async () => {
    await open(ALL, {
      [`GET /api/suppliers/${SUPPLIER_ID}/ledger?*`]: () =>
        jsonResponse({ ...pageOf([]), balance }),
    });
    await userEvent.click(screen.getByRole('button', { name: 'Ledger of Bharat Batteries' }));
    expect(
      await screen.findByText('Nothing has been bought from this supplier yet.'),
    ).toBeInTheDocument();
  });

  it('records a payment and says what is still owed', async () => {
    const { dialog, calls } = await openLedger(ALL, {
      [`POST /api/suppliers/${SUPPLIER_ID}/payments`]: () =>
        jsonResponse(
          {
            id: 'p-1',
            supplierId: SUPPLIER_ID,
            branchId: 'b-1',
            amount: '500.00',
            paidOn: '2026-10-09',
            mode: 'UPI',
            reference: 'UTR1',
            outstanding: '700.00',
          },
          201,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a payment' }));
    const form = within(dialog).getByRole('form', { name: 'Record a payment' });
    expect(within(form).getByText('Owed now: 1200.00')).toBeInTheDocument();
    await userEvent.type(within(form).getByLabelText('Amount'), '500.00');
    await userEvent.selectOptions(await within(form).findByLabelText('Paid by'), 'UPI');
    await userEvent.type(within(form).getByLabelText('Reference'), 'UTR1');
    await userEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    expect(
      await screen.findByText('Payment of 500.00 to Bharat Batteries recorded. Still owed: 700.00'),
    ).toBeInTheDocument();
    expect(bodyOf(calls, `POST /api/suppliers/${SUPPLIER_ID}/payments`)).toMatchObject({
      amount: '500.00',
      mode: 'UPI',
      reference: 'UTR1',
    });
  });

  it('shows the server’s refusal, such as paying more than is owed', async () => {
    const { dialog } = await openLedger(ALL, {
      [`POST /api/suppliers/${SUPPLIER_ID}/payments`]: () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'The payment is more than the supplier is owed',
            details: [{ field: 'amount', message: 'At most 1200.00' }],
            requestId: 'r',
          },
          422,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record a payment' }));
    const form = within(dialog).getByRole('form', { name: 'Record a payment' });
    await userEvent.type(within(form).getByLabelText('Amount'), '9999.00');
    await userEvent.selectOptions(await within(form).findByLabelText('Paid by'), 'CASH');
    await userEvent.click(within(form).getByRole('button', { name: 'Record payment' }));
    expect((await within(dialog).findAllByText('At most 1200.00')).length).toBeGreaterThan(0);
  });

  it('offers payments only to people who may record them', async () => {
    const { dialog } = await openLedger(['purchases.view', 'suppliers.view']);
    expect(
      within(dialog).queryByRole('button', { name: 'Record a payment' }),
    ).not.toBeInTheDocument();
  });
});
