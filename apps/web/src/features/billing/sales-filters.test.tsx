//apps/web/src/features/billing/sales-filters.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { BrokerSummary, ItemCategory } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { ISSUED, MANAGER, billingHandlers, makeInvoice, pageOf } from './test-data';

const GROUP_A = '11111111-1111-4111-8111-aaaaaaaaaaa1';
const GROUP_B = '11111111-1111-4111-8111-aaaaaaaaaaa2';
const TYRES = '22222222-2222-4222-8222-bbbbbbbbbbb1';
const BATTERIES = '22222222-2222-4222-8222-bbbbbbbbbbb2';
const BROKER_ID = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

const category = (id: string, name: string, parentId: string | null): ItemCategory => ({
  id,
  name,
  parentId,
  parentName: null,
  isActive: true,
  itemCount: 1,
  rowVersion: 1,
});
const CATEGORIES = [
  category(GROUP_A, 'Spare parts', null),
  category(GROUP_B, 'Vehicles', null),
  category(TYRES, 'Tyres', GROUP_A),
  category(BATTERIES, 'Batteries', GROUP_B),
];
const broker: BrokerSummary = {
  id: BROKER_ID,
  name: 'Ravi Broker',
  phone: '9000000001',
  address: null,
  hasPhoto: false,
  isActive: true,
  activeRule: null,
  payable: '0.00',
  toRecover: '0.00',
  createdAt: '2026-10-01T05:00:00.000Z',
};

const open = (permissions: string[] = [...MANAGER, 'items.view', 'brokers.view']) => {
  const extra: Record<string, RouteHandler> = {
    ...billingHandlers(permissions, [makeInvoice()]),
    'GET /api/item-categories': () => jsonResponse(CATEGORIES),
    'GET /api/brokers?*': () => jsonResponse(pageOf([broker])),
  };
  const state = routeFetch(extra);
  renderApp('/sales');
  return state;
};
const lastList = (calls: { key: string }[]): string =>
  calls.filter((call) => call.key.startsWith('GET /api/invoices?')).at(-1)?.key ?? '';

describe('the sale history filters', () => {
  it('offers the groups, the product categories and the brokers', async () => {
    open();
    const group = await screen.findByLabelText('Group');
    expect(
      within(group)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All', 'Spare parts', 'Vehicles']);
    expect(
      within(screen.getByLabelText('Product category'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All', 'Tyres', 'Batteries']);
    expect(
      within(await screen.findByLabelText('Broker')).getByRole('option', { name: 'Ravi Broker' }),
    ).toBeInTheDocument();
  });

  it('asks the server for the chosen group, category and broker, and shows each as a chip', async () => {
    const state = open();
    await userEvent.selectOptions(await screen.findByLabelText('Group'), GROUP_A);
    await waitFor(() => expect(lastList(state.calls)).toContain(`groupId=${GROUP_A}`));
    await userEvent.selectOptions(screen.getByLabelText('Product category'), TYRES);
    await waitFor(() => expect(lastList(state.calls)).toContain(`categoryId=${TYRES}`));
    await userEvent.selectOptions(screen.getByLabelText('Broker'), BROKER_ID);
    await waitFor(() => expect(lastList(state.calls)).toContain(`brokerId=${BROKER_ID}`));
    expect(await screen.findByText('Group: Spare parts')).toBeInTheDocument();
    expect(screen.getByText('Category: Tyres')).toBeInTheDocument();
    expect(screen.getByText('Broker: Ravi Broker')).toBeInTheDocument();
  });

  it('shows only the categories under the chosen group, and drops a category that is not under it', async () => {
    const state = open();
    await userEvent.selectOptions(await screen.findByLabelText('Group'), GROUP_A);
    expect(
      within(screen.getByLabelText('Product category'))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['All', 'Tyres']);
    await userEvent.selectOptions(screen.getByLabelText('Product category'), TYRES);
    await waitFor(() => expect(lastList(state.calls)).toContain(`categoryId=${TYRES}`));
    await userEvent.selectOptions(screen.getByLabelText('Group'), GROUP_B);
    await waitFor(() => expect(lastList(state.calls)).not.toContain('categoryId='));
    expect(lastList(state.calls)).toContain(`groupId=${GROUP_B}`);
  });

  it('removes a filter with its chip', async () => {
    const state = open();
    await userEvent.selectOptions(await screen.findByLabelText('Broker'), BROKER_ID);
    await userEvent.click(await screen.findByRole('button', { name: /Broker: Ravi Broker/ }));
    await waitFor(() => expect(lastList(state.calls)).not.toContain('brokerId='));
  });

  it('shows no broker filter to someone who may not view brokers, and asks for no categories without items.view', async () => {
    const state = open(MANAGER.filter((permission) => permission !== 'items.view'));
    await screen.findByLabelText('Status');
    expect(screen.queryByLabelText('Broker')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Group')).not.toBeInTheDocument();
    expect(state.calls.some((call) => call.key === 'GET /api/item-categories')).toBe(false);
  });
});

describe('the HSN code on an invoice', () => {
  const openInvoice = async (invoice: ReturnType<typeof ISSUED>) => {
    routeFetch({
      ...billingHandlers(MANAGER, [invoice]),
      ...signedIn(makeSession({ permissions: MANAGER })),
    });
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: `Open ${invoice.invoiceNo}` }));
    return screen.findByRole('dialog');
  };

  it('shows the HSN code of each line on a GST invoice', async () => {
    const dialog = await openInvoice(ISSUED({ type: 'GST' }));
    const table = await within(dialog).findByRole('table', { name: 'Invoice lines' });
    expect(within(table).getByRole('columnheader', { name: 'HSN' })).toBeInTheDocument();
    expect(table).toHaveTextContent('8507');
  });

  it('has no HSN column on an invoice without GST', async () => {
    const dialog = await openInvoice(ISSUED({ type: 'NON_GST' }));
    const table = await within(dialog).findByRole('table', { name: 'Invoice lines' });
    expect(within(table).queryByRole('columnheader', { name: 'HSN' })).not.toBeInTheDocument();
  });
});
