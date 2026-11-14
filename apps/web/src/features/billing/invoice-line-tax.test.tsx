//apps/web/src/features/billing/invoice-line-tax.test.tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Invoice } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { MANAGER, billingHandlers, makeInvoice } from './test-data';

const RATES = [
  { rate: '0.00', label: '0%' },
  { rate: '5.00', label: '5%' },
  { rate: '18.00', label: '18%' },
];

const open = (invoice: Invoice, extra: Record<string, RouteHandler> = {}) => {
  const state = routeFetch({
    ...billingHandlers(MANAGER, [invoice]),
    'GET /api/reference/gst-rates': () => jsonResponse(RATES),
    'PATCH /api/invoices/inv-1': () => jsonResponse(invoice),
    ...extra,
  });
  renderApp('/sales');
  return state;
};
const editDraft = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Open draft for Ravi Kumar' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Edit draft invoice' });
};
const sentLine = (calls: { key: string; body: unknown }[]) =>
  (
    calls.find((call) => call.key === 'PATCH /api/invoices/inv-1')?.body as {
      lines: Record<string, unknown>[];
    }
  ).lines[0] ?? {};

describe('the GST rate and HSN code on an invoice line', () => {
  it('are chosen on the bill, starting from what the line had', async () => {
    open(makeInvoice({ type: 'GST' }));
    const dialog = await editDraft();
    const line = within(within(dialog).getByRole('group', { name: 'Line 1' }));
    expect(line.getByLabelText('GST rate')).toHaveValue('18.00');
    expect(line.getByLabelText('HSN code')).toHaveValue('8507');
  });

  it('are sent as the biller changed them', async () => {
    const state = open(makeInvoice({ type: 'GST' }));
    const dialog = await editDraft();
    const line = within(within(dialog).getByRole('group', { name: 'Line 1' }));
    await userEvent.selectOptions(line.getByLabelText('GST rate'), '5.00');
    const hsn = line.getByLabelText('HSN code');
    await userEvent.clear(hsn);
    await userEvent.type(hsn, ' 87116010 ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Draft saved');
    expect(sentLine(state.calls)).toMatchObject({ taxRate: '5.00', hsnCode: '87116010' });
  });

  it('can be left empty for a buyer who is not registered, and are then sent as none', async () => {
    const state = open(makeInvoice({ type: 'GST' }));
    const dialog = await editDraft();
    const line = within(within(dialog).getByRole('group', { name: 'Line 1' }));
    await userEvent.clear(line.getByLabelText('HSN code'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Draft saved');
    expect(sentLine(state.calls)).toMatchObject({ taxRate: '18.00', hsnCode: null });
  });

  it('are not asked for, or sent, when the biller chooses an invoice without GST', async () => {
    const state = open(makeInvoice({ type: 'GST' }));
    const dialog = await editDraft();
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of invoice'), 'NON_GST');
    expect(within(dialog).queryByLabelText('GST rate')).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText('HSN code')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Draft saved');
    const line = sentLine(state.calls);
    expect(line).not.toHaveProperty('taxRate');
    expect(line).not.toHaveProperty('hsnCode');
  });

  it('show what the server refused, beside the field', async () => {
    open(makeInvoice({ type: 'GST' }), {
      'PATCH /api/invoices/inv-1': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'The invoice has problems',
            details: [{ field: 'lines.0.taxRate', message: 'Choose a GST rate from the list' }],
            requestId: 'r',
          },
          400,
        ),
    });
    const dialog = await editDraft();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Choose a GST rate from the list')).toBeInTheDocument();
  });
});
