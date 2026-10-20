import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { itemHandlers, itemPage, makeItem, MANAGER, VIEWER } from './test-data';

const open = (handlers: Record<string, RouteHandler> = itemHandlers()) => {
  const fetchState = routeFetch(handlers);
  const view = renderApp('/items');
  return { ...fetchState, ...view };
};
const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith('GET /api/items?'));
const rows = () =>
  within(screen.getByRole('table', { name: 'Items' }))
    .getAllByRole('row')
    .slice(1);

describe('item list', () => {
  it('shows a loading message while the items are fetched', async () => {
    open({ ...itemHandlers(), 'GET /api/items?*': () => new Promise<Response>(() => undefined) });
    expect(await screen.findByText('Loading items…')).toBeInTheDocument();
  });

  it('shows each item with its category, unit, GST rate, barcode and status', async () => {
    open(
      itemHandlers(MANAGER, [
        makeItem(),
        makeItem({
          id: 'i-2',
          itemCode: 'TYRE-1',
          name: 'Tyre',
          isSerialized: false,
          isActive: false,
          taxRate: null,
          barcodes: [],
        }),
      ]),
    );
    expect(await screen.findByRole('table', { name: 'Items' })).toBeInTheDocument();
    const [first, second] = rows();
    expect(first).toHaveTextContent('TOTO-X1');
    expect(first).toHaveTextContent('Serial');
    expect(first).toHaveTextContent('5.00%');
    expect(first).toHaveTextContent('2000000000015');
    expect(first).toHaveTextContent('Active');
    expect(second).toHaveTextContent('Inactive');
    expect(second).toHaveTextContent('—');
  });

  it('tells the user when nothing exists yet and when a search finds nothing', async () => {
    open(itemHandlers(MANAGER, []));
    expect(await screen.findByText('There are no items yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search'), 'zzz');
    expect(await screen.findByText(/No items match your search/)).toBeInTheDocument();
  });

  it('shows an error and recovers when Retry is pressed', async () => {
    let fail = true;
    open({
      ...itemHandlers(),
      'GET /api/items?*': () =>
        fail
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse(itemPage([makeItem()])),
    });
    expect(await screen.findByText('Could not load the items.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('TOTO-X1')).toBeInTheDocument();
  });

  it('asks the server for the search, category, status and tracking the user chose', async () => {
    const { calls } = open();
    await screen.findByText('TOTO-X1');
    await userEvent.type(screen.getByLabelText('Search'), 'tyre');
    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.key.includes('search=tyre'))).toBe(true),
    );
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'inactive');
    await userEvent.selectOptions(screen.getByLabelText('Tracking'), 'serialized');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'Spare Parts › Tyres');
    await waitFor(() => {
      const last = listCalls(calls).at(-1)?.key ?? '';
      expect(last).toContain('status=inactive');
      expect(last).toContain('tracking=serialized');
      expect(last).toContain('categoryId=22222222');
      expect(last).toContain('page=1');
    });
  });

  it('moves between pages on the server', async () => {
    const { calls } = open({
      ...itemHandlers(),
      'GET /api/items?*': () => jsonResponse(itemPage([makeItem()], { total: 25, totalPages: 3 })),
    });
    await screen.findByText('Page 1 of 3');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('page=2'));
  });
});

describe('who sees what', () => {
  it('lets a manager create, edit, deactivate and manage categories', async () => {
    open();
    await screen.findByText('TOTO-X1');
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Categories' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit TOTO-X1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate TOTO-X1' })).toBeInTheDocument();
  });

  it('shows read-only staff the list, the scan box and label printing only', async () => {
    open(itemHandlers(VIEWER));
    await screen.findByText('TOTO-X1');
    expect(screen.queryByRole('button', { name: 'New item' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Categories' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit TOTO-X1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate TOTO-X1' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Scan or type a barcode')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print labels/ })).toBeInTheDocument();
  });

  it('keeps people without items.view away from the page', async () => {
    open(itemHandlers(['branches.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Items' })).not.toBeInTheDocument();
  });
});

describe('deactivating', () => {
  it('asks first, then deactivates and says so', async () => {
    const { count } = open({
      ...itemHandlers(),
      'POST /api/items/i-1/deactivate': () => jsonResponse(makeItem({ isActive: false })),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate TOTO-X1' }));
    const dialog = await screen.findByRole('dialog');
    expect(count('POST /api/items/i-1/deactivate')).toBe(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Item TOTO-X1 deactivated')).toBeInTheDocument();
  });

  it('shows why an item that still has stock cannot be deactivated', async () => {
    open({
      ...itemHandlers(),
      'POST /api/items/i-1/deactivate': () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'This item cannot be deactivated yet',
            details: [{ field: 'isActive', message: '3 units are still in stock.' }],
            requestId: 'r',
          },
          422,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate TOTO-X1' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    );
    expect(await screen.findByText('3 units are still in stock.')).toBeInTheDocument();
  });

  it('offers Reactivate for an inactive item', async () => {
    open({
      ...itemHandlers(MANAGER, [makeItem({ isActive: false })]),
      'POST /api/items/i-1/reactivate': () => jsonResponse(makeItem()),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivate TOTO-X1' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }),
    );
    expect(await screen.findByText('Item TOTO-X1 reactivated')).toBeInTheDocument();
  });
});

describe('scan lookup', () => {
  const scan = async (value: string) => {
    await userEvent.type(screen.getByLabelText('Scan or type a barcode'), `${value}{Enter}`);
  };

  it('looks the barcode up on Enter and flags a serial-number item', async () => {
    const { calls } = open({
      ...itemHandlers(),
      'GET /api/items/lookup*': () => jsonResponse(makeItem()),
    });
    await screen.findByText('TOTO-X1');
    await scan('  2000000000015  ');
    expect(await screen.findByText('Serial number required')).toBeInTheDocument();
    expect(calls.some((call) => call.key === 'GET /api/items/lookup?barcode=2000000000015')).toBe(
      true,
    );
  });

  it('does nothing for an empty scan', async () => {
    const { calls } = open();
    await screen.findByText('TOTO-X1');
    await userEvent.type(screen.getByLabelText('Scan or type a barcode'), '   {Enter}');
    expect(calls.some((call) => call.key.startsWith('GET /api/items/lookup'))).toBe(false);
  });

  it('explains an unknown and an inactive item', async () => {
    let code = 'NOT_FOUND';
    open({
      ...itemHandlers(),
      'GET /api/items/lookup*': () =>
        jsonResponse(
          {
            code,
            message: 'x',
            details: [],
            requestId: 'r',
          },
          code === 'NOT_FOUND' ? 404 : 422,
        ),
    });
    await screen.findByText('TOTO-X1');
    await scan('NOPE-0001');
    expect(await screen.findByText('No item has this barcode or code.')).toBeInTheDocument();
    code = 'BUSINESS_RULE_VIOLATION';
    await scan('OLD-0001');
    expect(
      await screen.findByText('This item is inactive and cannot be used.'),
    ).toBeInTheDocument();
  });
});

describe('label printing', () => {
  it('enables printing once items are ticked and prepares the labels', async () => {
    const { calls } = open({
      ...itemHandlers(),
      'POST /api/items/labels': () =>
        jsonResponse({
          labels: Array.from({ length: 3 }, () => ({
            itemId: 'i-1',
            itemCode: 'TOTO-X1',
            name: 'TOTO X1 e-rickshaw',
            barcode: '2000000000015',
          })),
        }),
    });
    await screen.findByText('TOTO-X1');
    expect(screen.getByRole('button', { name: 'Print labels (0)' })).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select TOTO-X1 for labels' }));
    await userEvent.click(screen.getByRole('button', { name: 'Print labels (1)' }));
    const dialog = await screen.findByRole('dialog');
    const copies = within(dialog).getByLabelText('Copies of TOTO-X1');
    await userEvent.clear(copies);
    await userEvent.type(copies, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Prepare labels' }));
    await waitFor(() => expect(calls.some((c) => c.key === 'POST /api/items/labels')).toBe(true));
    expect(calls.find((c) => c.key === 'POST /api/items/labels')?.body).toEqual({
      items: [{ itemId: 'i-1', copies: 3 }],
    });
    expect(
      (await screen.findAllByRole('img', { name: 'Barcode 2000000000015' })).length,
    ).toBeGreaterThan(0);
  });

  it('leaves out items with no barcode and blocks more than 500 labels', async () => {
    open(
      itemHandlers(MANAGER, [
        makeItem(),
        makeItem({ id: 'i-2', itemCode: 'BARE-1', barcodes: [] }),
        makeItem({ id: 'i-3', itemCode: 'ONE-1', barcodes: [{ id: 'b3', barcode: 'MFR-123456' }] }),
        makeItem({ id: 'i-4', itemCode: 'TWO-1', barcodes: [{ id: 'b4', barcode: 'MFR-654321' }] }),
      ]),
    );
    await screen.findByText('TOTO-X1');
    for (const code of ['TOTO-X1', 'BARE-1', 'ONE-1', 'TWO-1'])
      await userEvent.click(screen.getByRole('checkbox', { name: `Select ${code} for labels` }));
    await userEvent.click(screen.getByRole('button', { name: 'Print labels (4)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/No barcode yet, so no label for: BARE-1/)).toBeInTheDocument();
    for (const code of ['TOTO-X1', 'ONE-1', 'TWO-1']) {
      const input = within(dialog).getByLabelText(`Copies of ${code}`);
      await userEvent.clear(input);
      await userEvent.type(input, '200');
    }
    expect(within(dialog).getByRole('alert')).toHaveTextContent(
      'Print at most 500 labels at a time.',
    );
    expect(within(dialog).getByRole('button', { name: 'Prepare labels' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Print' })).toBeDisabled();
  });
});
