//apps/web/src/features/items/hsn.test.tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { CATEGORY_CHILD, itemHandlers, makeItem } from './test-data';

describe('the HSN code of an item', () => {
  it('is shown in the item list, with a dash where there is none', async () => {
    routeFetch(
      itemHandlers(undefined, [
        makeItem(),
        makeItem({ id: 'i-2', itemCode: 'B-2', hsnCode: null, hsnDescription: null }),
      ]),
    );
    renderApp('/items');
    const table = await screen.findByRole('table', { name: /items/i });
    expect(within(table).getByRole('columnheader', { name: 'HSN' })).toBeInTheDocument();
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('8703');
    expect(rows[2]).not.toHaveTextContent('8703');
  });

  it('can be typed even when it is not in the list yet, and is sent as typed', async () => {
    const extra: Record<string, RouteHandler> = {
      'POST /api/items': () =>
        jsonResponse(makeItem({ itemCode: 'TYRE-9', hsnCode: '87116010' }), 201),
    };
    const state = routeFetch({ ...itemHandlers(), ...extra });
    renderApp('/items');
    await userEvent.click(await screen.findByRole('button', { name: 'New item' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Spare Parts › Tyres' });
    expect(within(dialog).getByText(/not in the list is added when you save/)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Item code'), 'tyre-9');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Front tyre');
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), CATEGORY_CHILD);
    await userEvent.selectOptions(within(dialog).getByLabelText('Unit'), 'PCS');
    await userEvent.type(within(dialog).getByLabelText('HSN code'), '87116010');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await screen.findByText('Item TYRE-9 created')).toBeInTheDocument();
    expect(state.calls.find((call) => call.key === 'POST /api/items')?.body).toMatchObject({
      hsnCode: '87116010',
    });
  });

  it('refuses a code that is not 4 to 8 digits before sending anything', async () => {
    const state = routeFetch(itemHandlers());
    renderApp('/items');
    await userEvent.click(await screen.findByRole('button', { name: 'New item' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'Spare Parts › Tyres' });
    await userEvent.type(within(dialog).getByLabelText('Item code'), 'tyre-9');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Front tyre');
    await userEvent.selectOptions(within(dialog).getByLabelText('Category'), CATEGORY_CHILD);
    await userEvent.selectOptions(within(dialog).getByLabelText('Unit'), 'PCS');
    await userEvent.type(within(dialog).getByLabelText('HSN code'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create item' }));
    expect(await within(dialog).findByText('An HSN code has 4 to 8 digits')).toBeInTheDocument();
    expect(state.calls.some((call) => call.key === 'POST /api/items')).toBe(false);
  });
});
