//apps/web/src/features/items/purchase-price.test.tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { CATEGORY_CHILD, MANAGER, itemHandlers, makeItem } from './test-data';

const asSuperAdmin = (): Record<string, RouteHandler> =>
  signedIn(makeSession({ permissions: MANAGER, isSuperAdmin: true }));

const openNew = async (extra: Record<string, RouteHandler> = {}) => {
  const state = routeFetch({ ...itemHandlers(), ...extra });
  renderApp('/items');
  await userEvent.click(await screen.findByRole('button', { name: 'New item' }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('option', { name: 'Spare Parts › Tyres' });
  return { ...state, dialog };
};
const fillRequired = async (dialog: HTMLElement) => {
  await userEvent.type(within(dialog).getByLabelText('Item code'), 'tyre-9');
  await userEvent.type(within(dialog).getByLabelText('Name'), 'Front tyre');
  await userEvent.selectOptions(within(dialog).getByLabelText('Category'), CATEGORY_CHILD);
  await userEvent.selectOptions(within(dialog).getByLabelText('Unit'), 'PCS');
};
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;

describe('purchase price in the item form', () => {
  it('gives a Super Admin both price fields and sends them', async () => {
    const { dialog, calls } = await openNew({
      ...asSuperAdmin(),
      'POST /api/items': () => jsonResponse(makeItem({ itemCode: 'TYRE-9' }), 201),
    });
    await fillRequired(dialog);
    await userEvent.type(within(dialog).getByLabelText('Actual purchase price'), '300');
    await userEvent.type(within(dialog).getByLabelText('Price shown to Admin and staff'), '400');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await screen.findByText('Item TYRE-9 created')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/items')).toMatchObject({
      actualPurchasePrice: '300',
      displayPurchasePrice: '400',
    });
  });

  it('sends no price at all when the price fields are left empty', async () => {
    const { dialog, calls } = await openNew({
      ...asSuperAdmin(),
      'POST /api/items': () => jsonResponse(makeItem({ itemCode: 'TYRE-9' }), 201),
    });
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    await screen.findByText('Item TYRE-9 created');
    expect(bodyOf(calls, 'POST /api/items')).toMatchObject({
      actualPurchasePrice: null,
      displayPurchasePrice: null,
    });
  });

  it('asks for the real price before a shown price, and checks the amount', async () => {
    const { dialog, calls } = await openNew(asSuperAdmin());
    await fillRequired(dialog);
    await userEvent.type(within(dialog).getByLabelText('Price shown to Admin and staff'), '400');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(
      await within(dialog).findByText('Enter the actual purchase price first'),
    ).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Actual purchase price'), 'abc');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await within(dialog).findByText(/Enter an amount such as/)).toBeInTheDocument();
    expect(calls.some((call) => call.key === 'POST /api/items')).toBe(false);
  });

  it('shows an Admin no price fields and sends no price', async () => {
    const { dialog, calls } = await openNew({
      'POST /api/items': () => jsonResponse(makeItem({ itemCode: 'TYRE-9' }), 201),
    });
    expect(within(dialog).queryByLabelText('Actual purchase price')).not.toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText('Price shown to Admin and staff'),
    ).not.toBeInTheDocument();
    await fillRequired(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    await screen.findByText('Item TYRE-9 created');
    const sent = bodyOf(calls, 'POST /api/items');
    expect(sent).not.toHaveProperty('actualPurchasePrice');
    expect(sent).not.toHaveProperty('displayPurchasePrice');
  });
});

describe('purchase price in the item list', () => {
  const priced = makeItem({ actualPurchasePrice: '300.00', displayPurchasePrice: '400.00' });
  const adminSees = makeItem({ actualPurchasePrice: null, displayPurchasePrice: '400.00' });

  it('shows a Super Admin the real price with the shown one beneath it', async () => {
    routeFetch({ ...itemHandlers(MANAGER, [priced]), ...asSuperAdmin() });
    renderApp('/items');
    const table = await screen.findByRole('table', { name: /items/i });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('300.00');
    expect(row).toHaveTextContent('Shown: 400.00');
  });

  it('shows an Admin only the shown price', async () => {
    routeFetch(itemHandlers(MANAGER, [adminSees]));
    renderApp('/items');
    const table = await screen.findByRole('table', { name: /items/i });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('400.00');
    expect(row).not.toHaveTextContent('300.00');
    expect(row).not.toHaveTextContent('Shown:');
  });

  it('shows a dash for an item with no price', async () => {
    routeFetch(itemHandlers(MANAGER, [makeItem()]));
    renderApp('/items');
    const table = await screen.findByRole('table', { name: /items/i });
    const header = within(table).getByRole('columnheader', { name: 'Purchase price' });
    expect(header).toBeInTheDocument();
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('—');
  });
});
