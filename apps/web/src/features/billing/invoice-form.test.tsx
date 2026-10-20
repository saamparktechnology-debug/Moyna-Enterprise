import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import {
  CUSTOMER_ID,
  ITEM_ID,
  SERIAL_ITEM_ID,
  UNIT_ID,
  billingHandlers,
  makeInvoice,
  previewOf,
} from './test-data';

const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((call) => call.key === key).at(-1)?.body as Record<string, unknown>;

const openNew = async (extra: Record<string, RouteHandler> = {}) => {
  const state = routeFetch({ ...billingHandlers(), ...extra });
  renderApp('/sales');
  await userEvent.click(await screen.findByRole('button', { name: 'New invoice' }));
  const dialog = await screen.findByRole('dialog', { name: 'New invoice' });
  return { ...state, dialog };
};
const chooseCustomer = async (dialog: HTMLElement) => {
  await userEvent.type(within(dialog).getByLabelText('Customer'), 'Ravi');
  await userEvent.selectOptions(
    await within(dialog).findByLabelText('Matching customers'),
    CUSTOMER_ID,
  );
};
const chooseItem = async (dialog: HTMLElement, typed: string, id: string) => {
  await userEvent.type(within(dialog).getByLabelText('Item'), typed);
  await userEvent.selectOptions(
    await within(dialog).findByLabelText('Matching items for Item'),
    id,
  );
};
const fillPlainLine = async (dialog: HTMLElement, discount = '') => {
  await chooseCustomer(dialog);
  await chooseItem(dialog, 'BATT', ITEM_ID);
  const qty = within(dialog).getByLabelText('Quantity');
  await userEvent.clear(qty);
  await userEvent.type(qty, '2');
  await userEvent.type(within(dialog).getByLabelText('Price'), '1000.00');
  if (discount) await userEvent.type(within(dialog).getByLabelText('Discount'), discount);
};

describe('writing an invoice', () => {
  it('names what is missing and sends nothing', async () => {
    const { dialog, calls } = await openNew();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Customer')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(within(dialog).getByLabelText('Item')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('Price')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.key === 'POST /api/invoices')).toBe(false);
  });

  it('shows the totals the server works out, with IGST across a state border', async () => {
    const { dialog } = await openNew();
    await fillPlainLine(dialog, '100.00');
    const totals = await within(dialog).findByRole('region', { name: 'Invoice totals' });
    await waitFor(() => expect(within(totals).getByText('2242.00')).toBeInTheDocument());
    expect(within(totals).getByText('IGST')).toBeInTheDocument();
    expect(within(totals).getByText('342.00')).toBeInTheDocument();
    expect(within(totals).queryByText('CGST')).not.toBeInTheDocument();
  });

  it('shows CGST and SGST inside the state and no tax for an invoice without GST', async () => {
    const { dialog } = await openNew({
      'POST /api/invoices/preview': () =>
        jsonResponse(
          previewOf({
            interState: false,
            cgstAmount: '171.00',
            sgstAmount: '171.00',
            igstAmount: '0.00',
          }),
        ),
    });
    await fillPlainLine(dialog);
    const totals = await within(dialog).findByRole('region', { name: 'Invoice totals' });
    await waitFor(() => expect(within(totals).getByText('CGST')).toBeInTheDocument());
    expect(within(totals).getByText('SGST')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of invoice'), 'NON_GST');
    await waitFor(() => expect(within(totals).queryByText('CGST')).not.toBeInTheDocument());
    expect(within(totals).queryByText('IGST')).not.toBeInTheDocument();
  });

  it('tells the user when a discount is above what staff may give', async () => {
    const { dialog } = await openNew();
    await chooseItem(dialog, 'BATT', ITEM_ID);
    await userEvent.type(within(dialog).getByLabelText('Price'), '1000.00');
    await userEvent.type(within(dialog).getByLabelText('Discount'), '50.00');
    expect(within(dialog).queryByText(/a manager must issue this invoice/)).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Discount'), '1');
    expect(
      await within(dialog).findByText('More than 5%: a manager must issue this invoice'),
    ).toBeInTheDocument();
  });

  it('asks for a serial number instead of a quantity for a serialized item, and sends the unit', async () => {
    const { dialog, calls } = await openNew({
      'POST /api/invoices': () => jsonResponse(makeInvoice({ id: 'inv-9' }), 201),
      'GET /api/invoices/inv-9': () => jsonResponse(makeInvoice({ id: 'inv-9' })),
    });
    await chooseCustomer(dialog);
    await chooseItem(dialog, 'TOTO', SERIAL_ITEM_ID);
    expect(within(dialog).queryByLabelText('Quantity')).not.toBeInTheDocument();
    await userEvent.selectOptions(await within(dialog).findByLabelText('Serial number'), UNIT_ID);
    await userEvent.type(within(dialog).getByLabelText('Price'), '95000.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft invoice created')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/invoices')).toMatchObject({
      customerId: CUSTOMER_ID,
      type: 'GST',
      lines: [
        {
          itemId: SERIAL_ITEM_ID,
          qty: 1,
          unitPrice: '95000.00',
          discountAmount: '0.00',
          serialUnitId: UNIT_ID,
        },
      ],
    });
  });

  it('adds and removes lines, and does not offer to remove the only one', async () => {
    const { dialog } = await openNew();
    expect(within(dialog).queryByRole('button', { name: 'Remove line 1' })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a line' }));
    expect(within(dialog).getByLabelText('Line 2')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove line 2' }));
    expect(within(dialog).queryByLabelText('Line 2')).not.toBeInTheDocument();
  });

  it('creates the draft and opens it', async () => {
    const { dialog, calls } = await openNew({
      'POST /api/invoices': () => jsonResponse(makeInvoice({ id: 'inv-9' }), 201),
      'GET /api/invoices/inv-9': () => jsonResponse(makeInvoice({ id: 'inv-9' })),
    });
    await fillPlainLine(dialog, '100.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft invoice created')).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: 'Draft invoice' })).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/invoices')).toMatchObject({
      lines: [{ itemId: ITEM_ID, qty: 2, unitPrice: '1000.00', discountAmount: '100.00' }],
    });
  });

  it('shows the server’s reasons and keeps what was typed', async () => {
    const { dialog } = await openNew({
      'POST /api/invoices': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'The invoice has problems',
            details: [{ field: 'lines.0.itemId', message: 'BATT-48V has no GST rate' }],
            requestId: 'r',
          },
          400,
        ),
    });
    await fillPlainLine(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByText('The invoice has problems')).toBeInTheDocument();
    expect(within(dialog).getByText('BATT-48V has no GST rate')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Price')).toHaveValue('1000.00');
  });

  it('edits a draft with the version that was read', async () => {
    const draft = makeInvoice();
    const state = routeFetch({
      ...billingHandlers(),
      'PATCH /api/invoices/inv-1': () => jsonResponse(makeInvoice({ rowVersion: 5 })),
    });
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open draft for Ravi Kumar' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit draft invoice' });
    expect(within(dialog).getByLabelText('Price')).toHaveValue(draft.lines[0]?.unitPrice);
    const price = within(dialog).getByLabelText('Price');
    await userEvent.clear(price);
    await userEvent.type(price, '1100.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    expect(bodyOf(state.calls, 'PATCH /api/invoices/inv-1')).toMatchObject({
      rowVersion: 4,
      customerId: CUSTOMER_ID,
      lines: [{ unitPrice: '1100.00', qty: 2 }],
    });
  });
});
