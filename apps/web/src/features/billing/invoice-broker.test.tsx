import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { CUSTOMER_ID, ITEM_ID, MANAGER, billingHandlers, makeInvoice, pageOf } from './test-data';

const BROKER_ID = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const NO_RULE_ID = '3b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

const summary = (
  id: string,
  name: string,
  rule: { type: 'PERCENT' | 'FIXED'; value: string } | null,
) => ({
  id,
  name,
  phone: null,
  isActive: true,
  activeRule: rule,
  payable: '0.00',
  toRecover: '0.00',
  createdAt: '2026-10-01T05:00:00.000Z',
});

const withBrokers = (
  permissions: string[] = [...MANAGER, 'brokers.view'],
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...billingHandlers(permissions),
  'GET /api/brokers?*': () =>
    jsonResponse(
      pageOf([
        summary(BROKER_ID, 'Ravi Broker', { type: 'PERCENT', value: '2.50' }),
        summary(NO_RULE_ID, 'Bare Broker', null),
      ]),
    ),
  ...extra,
});
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((call) => call.key === key).at(-1)?.body as Record<string, unknown>;

const openNew = async (h: Record<string, RouteHandler>) => {
  const state = routeFetch(h);
  renderApp('/sales');
  await userEvent.click(await screen.findByRole('button', { name: 'New invoice' }));
  const dialog = await screen.findByRole('dialog', { name: 'New invoice' });
  return { ...state, dialog };
};
const fillLine = async (dialog: HTMLElement) => {
  await userEvent.type(within(dialog).getByLabelText('Customer'), 'Ravi');
  await userEvent.selectOptions(
    await within(dialog).findByLabelText('Matching customers'),
    CUSTOMER_ID,
  );
  await userEvent.type(within(dialog).getByLabelText('Item'), 'BATT');
  await userEvent.selectOptions(await within(dialog).findByLabelText('Matching items'), ITEM_ID);
  await userEvent.type(within(dialog).getByLabelText('Price'), '1000.00');
};

describe('the broker on an invoice', () => {
  it('offers only brokers who have a rule, and sends the one chosen', async () => {
    const { dialog, calls } = await openNew(
      withBrokers([...MANAGER, 'brokers.view'], {
        'POST /api/invoices': () => jsonResponse(makeInvoice({ id: 'inv-9' }), 201),
        'GET /api/invoices/inv-9': () => jsonResponse(makeInvoice({ id: 'inv-9' })),
      }),
    );
    const select = await within(dialog).findByLabelText('Broker');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['No broker', 'Ravi Broker · 2.5%']);
    await fillLine(dialog);
    await userEvent.selectOptions(select, BROKER_ID);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft invoice created')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/invoices')).toMatchObject({ brokerId: BROKER_ID });
  });

  it('sends no broker unless one is chosen', async () => {
    const { dialog, calls } = await openNew(
      withBrokers([...MANAGER, 'brokers.view'], {
        'POST /api/invoices': () => jsonResponse(makeInvoice({ id: 'inv-9' }), 201),
        'GET /api/invoices/inv-9': () => jsonResponse(makeInvoice({ id: 'inv-9' })),
      }),
    );
    await within(dialog).findByLabelText('Broker');
    await fillLine(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('Draft invoice created')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/invoices')).toMatchObject({ brokerId: null });
  });

  it("shows the server's reason when the broker cannot be used", async () => {
    const { dialog } = await openNew(
      withBrokers([...MANAGER, 'brokers.view'], {
        'POST /api/invoices': () =>
          jsonResponse(
            {
              code: 'VALIDATION_ERROR',
              message: 'This broker cannot be used',
              details: [{ field: 'brokerId', message: 'This broker is no longer active' }],
              requestId: 'r',
            },
            400,
          ),
      }),
    );
    await fillLine(dialog);
    await userEvent.selectOptions(await within(dialog).findByLabelText('Broker'), BROKER_ID);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save draft' }));
    expect(await within(dialog).findByText('This broker is no longer active')).toBeInTheDocument();
  });

  it('shows no broker field to someone who may not view brokers', async () => {
    const { dialog, calls } = await openNew(withBrokers(MANAGER));
    await within(dialog).findByLabelText('Due date');
    expect(within(dialog).queryByLabelText('Broker')).not.toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('GET /api/brokers'))).toBe(false);
  });

  it('keeps the broker of a draft being edited, even when they can no longer be chosen, and shows it on the invoice', async () => {
    const draft = makeInvoice({ brokerId: BROKER_ID, brokerName: 'Ravi Broker' });
    const state = routeFetch({
      ...billingHandlers([...MANAGER, 'brokers.view']),
      'GET /api/invoices/inv-1': () => jsonResponse(draft),
      'GET /api/brokers?*': () => jsonResponse(pageOf([])),
      'PATCH /api/invoices/inv-1': () => jsonResponse(makeInvoice({ rowVersion: 5 })),
    });
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open draft for Ravi Kumar' }));
    expect(await screen.findByText('Broker')).toBeInTheDocument();
    expect(screen.getAllByText('Ravi Broker').length).toBeGreaterThan(0);
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit draft invoice' });
    const select = await within(dialog).findByLabelText('Broker');
    expect(select).toHaveValue(BROKER_ID);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(state.calls.some((c) => c.key === 'PATCH /api/invoices/inv-1')).toBe(true),
    );
    expect(bodyOf(state.calls, 'PATCH /api/invoices/inv-1')).toMatchObject({ brokerId: BROKER_ID });
  });
});
