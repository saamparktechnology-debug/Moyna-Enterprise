//apps/web/src/features/billing/invoice-selling-price.test.tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { makeItem } from '../items/test-data';
import { ITEM_ID, billingHandlers, pageOf } from './test-data';

const open = async (sellingPrice: string | null) => {
  routeFetch({
    ...billingHandlers(),
    'GET /api/items?*': () =>
      jsonResponse(
        pageOf([
          makeItem({ id: ITEM_ID, itemCode: 'BATT-48V', name: '48V battery', sellingPrice }),
        ]),
      ),
  });
  renderApp('/sales');
  await userEvent.click(await screen.findByRole('button', { name: 'New invoice' }));
  return screen.findByRole('dialog', { name: 'New invoice' });
};
const choose = async (dialog: HTMLElement) => {
  await userEvent.type(within(dialog).getByLabelText('Item'), 'BATT');
  await userEvent.selectOptions(
    await within(dialog).findByLabelText('Matching items for Item'),
    ITEM_ID,
  );
};

describe('the price of an assembled item on an invoice', () => {
  it('starts from the selling price that was set when it was assembled', async () => {
    const dialog = await open('95000.00');
    await choose(dialog);
    expect(within(dialog).getByLabelText('Price')).toHaveValue('95000.00');
  });

  it('keeps a price the biller already typed', async () => {
    const dialog = await open('95000.00');
    await userEvent.type(within(dialog).getByLabelText('Price'), '90000');
    await choose(dialog);
    expect(within(dialog).getByLabelText('Price')).toHaveValue('90000');
  });

  it('leaves the price empty for an item with no selling price', async () => {
    const dialog = await open(null);
    await choose(dialog);
    expect(within(dialog).getByLabelText('Price')).toHaveValue('');
  });
});
