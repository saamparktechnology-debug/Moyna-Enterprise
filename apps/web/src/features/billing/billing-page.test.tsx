import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import {
  CASHIER,
  ISSUED,
  VIEWER,
  billingHandlers,
  makeInvoice,
  pageOf,
  summaryOf,
} from './test-data';

const open = (handlers: Record<string, RouteHandler> = billingHandlers()) => {
  const state = routeFetch(handlers);
  const view = renderApp('/sales');
  return { ...state, ...view };
};
const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith('GET /api/invoices?'));
const rows = () =>
  within(screen.getByRole('table', { name: 'Invoices' }))
    .getAllByRole('row')
    .slice(1);

describe('the invoice list', () => {
  it('shows each invoice with its number, customer, kind, status and total', async () => {
    open(
      billingHandlers(undefined, [
        makeInvoice(),
        ISSUED({ id: 'inv-2', type: 'NON_GST', total: '500.00' }),
        ISSUED({ id: 'inv-3', status: 'CANCELLED', invoiceNo: 'HQ/GI/26-27/00002' }),
      ]),
    );
    const [draft, issued, cancelled] = await waitFor(() => {
      const found = rows();
      expect(found).toHaveLength(3);
      return found;
    });
    expect(draft).toHaveTextContent('Draft');
    expect(draft).toHaveTextContent('Ravi Kumar');
    expect(draft).toHaveTextContent('GST invoice');
    expect(draft).toHaveTextContent('2242.00');
    expect(issued).toHaveTextContent('HQ/GI/26-27/00001');
    expect(issued).toHaveTextContent('Invoice without GST');
    expect(issued).toHaveTextContent('2026-10-08');
    expect(cancelled).toHaveTextContent('Cancelled');
  });

  it('shows a loading message while the list is fetched', async () => {
    open({
      ...billingHandlers(),
      'GET /api/invoices?*': () => new Promise<Response>(() => undefined),
    });
    expect(await screen.findByText('Loading invoices…')).toBeInTheDocument();
  });

  it('explains an empty list', async () => {
    open({ ...billingHandlers(), 'GET /api/invoices?*': () => jsonResponse(pageOf([])) });
    expect(await screen.findByText('There are no invoices yet.')).toBeInTheDocument();
  });

  it('shows an error and recovers when Retry is pressed', async () => {
    let fail = true;
    open({
      ...billingHandlers(),
      'GET /api/invoices?*': () =>
        fail
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse(pageOf([summaryOf(ISSUED())])),
    });
    expect(await screen.findByText('Could not load the invoices.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('HQ/GI/26-27/00001')).toBeInTheDocument();
  });

  it('asks the server for the search, status and kind the user chose, and for the next page', async () => {
    const { calls } = open({
      ...billingHandlers(),
      'GET /api/invoices?*': () =>
        jsonResponse(pageOf([summaryOf(ISSUED())], { total: 25, totalPages: 3 })),
    });
    await screen.findByText('HQ/GI/26-27/00001');
    await userEvent.type(screen.getByLabelText('Search'), 'ravi');
    await waitFor(() =>
      expect(listCalls(calls).some((c) => c.key.includes('search=ravi'))).toBe(true),
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'ISSUED');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'NON_GST');
    await waitFor(() => {
      const last = listCalls(calls).at(-1)?.key ?? '';
      expect(last).toContain('status=ISSUED');
      expect(last).toContain('type=NON_GST');
      expect(last).toContain('page=1');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('page=2'));
  });
});

describe('who sees what', () => {
  it('offers a new invoice to people who may create one', async () => {
    open(billingHandlers(CASHIER));
    await screen.findByText('Ravi Kumar');
    expect(screen.getByRole('button', { name: 'New invoice' })).toBeInTheDocument();
  });

  it('offers no new invoice to people who may only view', async () => {
    open(billingHandlers(VIEWER));
    await screen.findByText('Ravi Kumar');
    expect(screen.queryByRole('button', { name: 'New invoice' })).not.toBeInTheDocument();
  });

  it('keeps people without invoices.view away', async () => {
    open(billingHandlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Invoices' })).not.toBeInTheDocument();
  });
});
