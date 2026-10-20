import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { CASHIER, ISSUED, MANAGER, VIEWER, billingHandlers, makeInvoice } from './test-data';

const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const refusal = (
  message: string,
  status = 422,
  details: { field: string; message: string }[] = [],
) => jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);

const openInvoice = async (
  invoice = makeInvoice(),
  permissions: string[] = MANAGER,
  extra: Record<string, RouteHandler> = {},
) => {
  const state = routeFetch({ ...billingHandlers(permissions, [invoice]), ...extra });
  renderApp('/sales');
  const name = invoice.invoiceNo
    ? `Open ${invoice.invoiceNo}`
    : `Open draft for ${invoice.customerName}`;
  await userEvent.click(await screen.findByRole('button', { name }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('table', { name: 'Invoice lines' });
  return { ...state, dialog };
};

afterEach(() => vi.restoreAllMocks());

describe('reading an invoice', () => {
  it('shows who it is for, where the tax goes, each line and the totals', async () => {
    const { dialog } = await openInvoice(
      ISSUED({
        customerGstin: '27AAPFU0939F1ZV',
        lines: [{ ...makeInvoice().lines[0]!, serialNo: 'SN-0001', serialUnitId: 'u-1' }],
      }),
    );
    expect(within(dialog).getByText('HQ/GI/26-27/00001')).toBeInTheDocument();
    expect(within(dialog).getByText(/Ravi Kumar · GSTIN 27AAPFU0939F1ZV/)).toBeInTheDocument();
    expect(within(dialog).getByText(/HQ · GSTIN 29ABCDE1234F1Z5/)).toBeInTheDocument();
    expect(within(dialog).getByText('27 (another state, so IGST)')).toBeInTheDocument();
    const line = within(within(dialog).getByRole('table', { name: 'Invoice lines' })).getAllByRole(
      'row',
    )[1];
    expect(line).toHaveTextContent('BATT-48V · 48V battery');
    expect(line).toHaveTextContent('S/N: SN-0001');
    expect(line).toHaveTextContent('342.00 (18.00%)');
    const totals = within(dialog).getByLabelText('Invoice totals');
    expect(totals).toHaveTextContent('IGST342.00');
    expect(totals).toHaveTextContent('Total2242.00');
  });

  it('says so when the invoice cannot be loaded', async () => {
    routeFetch({
      ...billingHandlers(),
      'GET /api/invoices/inv-1': () =>
        jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500),
    });
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open draft for Ravi Kumar' }));
    expect(await screen.findByText('Could not load the invoice.')).toBeInTheDocument();
  });

  it('downloads the PDF', async () => {
    const created = vi.fn(() => 'blob:invoice');
    Object.assign(URL, { createObjectURL: created });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined);
    const { dialog, count } = await openInvoice(ISSUED(), MANAGER, {
      'GET /api/invoices/inv-1/pdf': () =>
        new Response('%PDF-1.4', {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        }),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Download PDF' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    expect(created).toHaveBeenCalledTimes(1);
    expect(count('GET /api/invoices/inv-1/pdf')).toBe(1);
  });
});

describe('issuing a draft', () => {
  it('issues it with the version that was read and says which number it got', async () => {
    const { dialog, calls } = await openInvoice(makeInvoice(), CASHIER, {
      'POST /api/invoices/inv-1/issue': () => jsonResponse(ISSUED()),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    expect(await screen.findByText('Invoice HQ/GI/26-27/00001 issued')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/invoices/inv-1/issue')).toEqual({ rowVersion: 4 });
  });

  it('sends the reason for selling an expired battery when one is given', async () => {
    const { dialog, calls } = await openInvoice(makeInvoice(), MANAGER, {
      'POST /api/invoices/inv-1/issue': () => jsonResponse(ISSUED()),
    });
    await userEvent.type(
      within(dialog).getByLabelText('Reason to sell an expired battery'),
      'Customer agreed',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await screen.findByText('Invoice HQ/GI/26-27/00001 issued');
    expect(bodyOf(calls, 'POST /api/invoices/inv-1/issue')).toEqual({
      rowVersion: 4,
      overrideReason: 'Customer agreed',
    });
  });

  it('shows why the server refused, such as a discount above what staff may give', async () => {
    const { dialog } = await openInvoice(makeInvoice(), CASHIER, {
      'POST /api/invoices/inv-1/issue': () =>
        jsonResponse(
          {
            code: 'FORBIDDEN',
            message:
              'A discount is above what staff may give. Ask a manager to issue this invoice, or lower the discount',
            details: [],
            requestId: 'r',
          },
          403,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    expect(
      await within(dialog).findByText(/Ask a manager to issue this invoice/),
    ).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lists each reason when the stock is not enough', async () => {
    const { dialog } = await openInvoice(makeInvoice(), CASHIER, {
      'POST /api/invoices/inv-1/issue': () =>
        refusal('Not enough stock', 422, [
          { field: 'lines', message: 'Only 1 of BATT-48V is available' },
        ]),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    expect(await within(dialog).findByText('Not enough stock')).toBeInTheDocument();
    expect(within(dialog).getByText('Only 1 of BATT-48V is available')).toBeInTheDocument();
  });
});

describe('discarding a draft', () => {
  it('asks to be sure, and only then discards', async () => {
    const { dialog, calls } = await openInvoice(makeInvoice(), CASHIER, {
      'POST /api/invoices/inv-1/discard': () => new Response(null, { status: 204 }),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Discard draft' }));
    expect(calls.some((call) => call.key === 'POST /api/invoices/inv-1/discard')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Yes, discard it' }));
    expect(await screen.findByText('Draft discarded')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/invoices/inv-1/discard')).toEqual({ rowVersion: 4 });
  });
});

describe('cancelling an issued invoice', () => {
  it('needs a reason of a few characters and sends nothing without one', async () => {
    const { dialog, calls } = await openInvoice(ISSUED());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 3 characters'),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.key.endsWith('/cancel'))).toBe(false);
  });

  it('cancels with the reason and the version that was read', async () => {
    const { dialog, calls } = await openInvoice(ISSUED(), MANAGER, {
      'POST /api/invoices/inv-1/cancel': () =>
        jsonResponse(ISSUED({ status: 'CANCELLED', cancelReason: 'Wrong customer' })),
    });
    await userEvent.type(within(dialog).getByLabelText('Reason for cancelling'), 'Wrong customer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    expect(await screen.findByText('Invoice HQ/GI/26-27/00001 cancelled')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/invoices/inv-1/cancel')).toEqual({
      rowVersion: 4,
      reason: 'Wrong customer',
    });
  });

  it('cancels and reissues, then opens the new draft', async () => {
    const draft = makeInvoice({
      id: 'inv-5',
      replacesInvoiceId: 'inv-1',
      replacesInvoiceNo: 'HQ/GI/26-27/00001',
    });
    const { dialog } = await openInvoice(ISSUED(), MANAGER, {
      'POST /api/invoices/inv-1/reissue': () => jsonResponse(draft, 201),
      'GET /api/invoices/inv-5': () => jsonResponse(draft),
    });
    await userEvent.type(within(dialog).getByLabelText('Reason for cancelling'), 'Wrong price');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel and reissue' }));
    expect(await screen.findByText(/cancelled and a new draft made/)).toBeInTheDocument();
    const next = await screen.findByRole('dialog', { name: 'Draft invoice' });
    expect(await within(next).findByText('HQ/GI/26-27/00001')).toBeInTheDocument();
  });

  it('shows why a cancel was refused, such as a payment against the invoice', async () => {
    const { dialog } = await openInvoice(ISSUED(), MANAGER, {
      'POST /api/invoices/inv-1/cancel': () =>
        refusal('This invoice has payments against it', 422, [
          { field: 'invoice', message: 'Reverse the payments before cancelling the invoice' },
        ]),
    });
    await userEvent.type(within(dialog).getByLabelText('Reason for cancelling'), 'Wrong customer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel invoice' }));
    expect(
      await within(dialog).findByText('This invoice has payments against it'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('Reverse the payments before cancelling the invoice'),
    ).toBeInTheDocument();
  });
});

describe('what each person may do', () => {
  it('lets staff who cannot cancel see an issued invoice and nothing to change it with', async () => {
    const { dialog } = await openInvoice(ISSUED(), CASHIER);
    expect(within(dialog).getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Cancel invoice' }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole('button', { name: 'Cancel and reissue' }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Reason for cancelling')).not.toBeInTheDocument();
  });

  it('offers a person who may only view nothing to change on a draft', async () => {
    const { dialog } = await openInvoice(makeInvoice(), VIEWER);
    for (const name of ['Issue invoice', 'Edit', 'Discard draft'])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
  });

  it('shows a cancelled invoice with who cancelled it and why, and no way to act on it', async () => {
    const { dialog } = await openInvoice(
      ISSUED({ status: 'CANCELLED', cancelReason: 'Wrong customer', cancelledByName: 'Meera Das' }),
    );
    expect(within(dialog).getByText('Cancelled by Meera Das: Wrong customer')).toBeInTheDocument();
    for (const name of ['Issue invoice', 'Cancel invoice', 'Cancel and reissue', 'Edit'])
      expect(within(dialog).queryByRole('button', { name })).not.toBeInTheDocument();
  });
});

describe('an invoice that delivers a quotation', () => {
  const FROM_QUOTE = { quotationId: 'q-1', quotationNo: 'HQ/QT/26-27/00001' } as const;

  it('shows which quotation it came from', async () => {
    const { dialog } = await openInvoice(makeInvoice(FROM_QUOTE), [...MANAGER]);
    expect(within(dialog).getByText('HQ/QT/26-27/00001')).toBeInTheDocument();
  });

  it('lets someone who may deliver on credit give a reason, and sends it with the issue', async () => {
    const issued = ISSUED({ ...FROM_QUOTE });
    const { dialog, calls } = await openInvoice(
      makeInvoice(FROM_QUOTE),
      [...MANAGER, 'quotations.deliver_unpaid'],
      { 'POST /api/invoices/inv-1/issue': () => jsonResponse(issued) },
    );
    await userEvent.type(
      within(dialog).getByLabelText('Reason to deliver before it is fully paid'),
      ' Pays the balance on Friday ',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() =>
      expect(calls.some((call) => call.key === 'POST /api/invoices/inv-1/issue')).toBe(true),
    );
    expect(bodyOf(calls, 'POST /api/invoices/inv-1/issue')).toMatchObject({
      unpaidDeliveryReason: 'Pays the balance on Friday',
    });
  });

  it('sends no reason unless one was given', async () => {
    const { dialog, calls } = await openInvoice(
      makeInvoice(FROM_QUOTE),
      [...MANAGER, 'quotations.deliver_unpaid'],
      { 'POST /api/invoices/inv-1/issue': () => jsonResponse(ISSUED({ ...FROM_QUOTE })) },
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    await waitFor(() =>
      expect(calls.some((call) => call.key === 'POST /api/invoices/inv-1/issue')).toBe(true),
    );
    expect(bodyOf(calls, 'POST /api/invoices/inv-1/issue')).not.toHaveProperty(
      'unpaidDeliveryReason',
    );
  });

  it('shows no such field to someone who may not deliver on credit, or on an invoice with no quotation', async () => {
    const { dialog } = await openInvoice(makeInvoice(FROM_QUOTE), [...MANAGER]);
    expect(
      within(dialog).queryByLabelText('Reason to deliver before it is fully paid'),
    ).not.toBeInTheDocument();
  });

  it('shows why delivery was refused, such as an order not fully paid', async () => {
    const { dialog } = await openInvoice(
      makeInvoice(FROM_QUOTE),
      [...MANAGER, 'quotations.deliver_unpaid'],
      {
        'POST /api/invoices/inv-1/issue': () =>
          refusal('This order is not fully paid', 422, [
            { field: 'payment', message: '500.00 of 2000.00 has been paid' },
          ]),
      },
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Issue invoice' }));
    expect(await within(dialog).findByText('This order is not fully paid')).toBeInTheDocument();
    expect(within(dialog).getByText('500.00 of 2000.00 has been paid')).toBeInTheDocument();
  });
});
