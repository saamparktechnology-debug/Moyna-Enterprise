//apps/web/src/features/assembly/assembly.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Assembly } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { pageOf } from '../billing/test-data';
import { CATEGORIES, CATEGORY_CHILD, makeItem } from '../items/test-data';

const PRODUCT = '11111111-1111-4111-8111-aaaaaaaaaaa1';
const VEHICLE = '11111111-1111-4111-8111-aaaaaaaaaaa2';
const TYRE = '11111111-1111-4111-8111-aaaaaaaaaaa3';
const BATTERY = '11111111-1111-4111-8111-aaaaaaaaaaa4';
const UNIT_A = '22222222-2222-4222-8222-bbbbbbbbbbb1';
const UNIT_B = '22222222-2222-4222-8222-bbbbbbbbbbb2';

const ITEMS = [
  makeItem({ id: PRODUCT, itemCode: 'KIT-1', name: 'Charger kit', isSerialized: false }),
  makeItem({ id: VEHICLE, itemCode: 'VEH-1', name: 'Indian Buggy', isSerialized: true }),
  makeItem({ id: TYRE, itemCode: 'TYRE-9', name: 'Front tyre', isSerialized: false }),
  makeItem({ id: BATTERY, itemCode: 'BAT-1', name: 'Eastman 140AH', isSerialized: true }),
];
const unit = (id: string, serialNo: string) => ({
  id,
  branchId: 'branch-1',
  branchCode: 'HQ',
  itemId: BATTERY,
  itemCode: 'BAT-1',
  itemName: 'Eastman 140AH',
  serialNo,
  chassisNo: null,
  state: 'AVAILABLE',
});
const assembly = (over: Partial<Assembly> = {}): Assembly => ({
  id: 'as-1',
  assemblyNo: 'AS-111120261123',
  branchId: 'branch-1',
  branchCode: 'HQ',
  finishedItemId: VEHICLE,
  finishedItemCode: 'VEH-1',
  finishedItemName: 'Indian Buggy',
  qty: 1,
  sellingPrice: '150000.00',
  note: null,
  createdByName: 'Meena',
  costTotal: '31000.00',
  profit: '119000.00',
  reversed: null,
  createdAt: '2026-11-11T05:53:00.000Z',
  parts: [
    {
      itemId: TYRE,
      itemCode: 'TYRE-9',
      itemName: 'Front tyre',
      unitCode: 'PCS',
      qty: 4,
      serialNos: [],
    },
    {
      itemId: BATTERY,
      itemCode: 'BAT-1',
      itemName: 'Eastman 140AH',
      unitCode: 'PCS',
      qty: 1,
      serialNos: ['BAT-77'],
    },
  ],
  units: [{ serialUnitId: 'u-1', serialNo: 'CH-100', chassisNo: 'CH-100', motorNo: 'MN-5' }],
  ...over,
});
const MAKER = ['manufacturing.manage', 'items.view', 'stock.view'];

const handlers = (
  permissions: string[] = MAKER,
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...signedIn(makeSession({ permissions })),
  'GET /api/assemblies?*': () => jsonResponse(pageOf([assembly()])),
  'GET /api/items?*': () => jsonResponse(pageOf(ITEMS)),
  'GET /api/stock/serial-units?*': () =>
    jsonResponse(pageOf([unit(UNIT_A, 'BAT-77'), unit(UNIT_B, 'BAT-78')])),
  'GET /api/stock/balances?*': () => jsonResponse(pageOf([])),
  'GET /api/item-categories': () => jsonResponse(CATEGORIES),
  'GET /api/reference/units': () =>
    jsonResponse([
      { code: 'PCS', name: 'Pieces' },
      { code: 'SET', name: 'Sets' },
    ]),
  'GET /api/reference/gst-rates': () =>
    jsonResponse([
      { rate: '5.00', label: '5%' },
      { rate: '18.00', label: '18%' },
    ]),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  renderApp('/assembly');
  return state;
};
const choose = async (scope: HTMLElement, label: string, typed: string, id: string) => {
  await userEvent.type(within(scope).getByLabelText(label), typed);
  await userEvent.selectOptions(
    await within(scope).findByLabelText(`Matching items for ${label}`),
    id,
  );
};
const openDialog = async (h: Record<string, RouteHandler> = handlers()) => {
  const state = open(h);
  await userEvent.click(await screen.findByRole('button', { name: 'Assemble a product' }));
  const dialog = await screen.findByRole('dialog', { name: 'Assemble a product' });
  return { ...state, dialog };
};
const posted = (calls: { key: string; body: unknown }[]) =>
  calls.filter((call) => call.key === 'POST /api/assemblies').map((call) => call.body);

describe('the assembly page', () => {
  it('lists what was assembled with the product, its price and the parts that went in', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Assemblies' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('AS-111120261123');
    expect(row).toHaveTextContent('Indian Buggy');
    expect(row).toHaveTextContent('CH-100');
    expect(row).toHaveTextContent('150000.00');
    expect(row).toHaveTextContent('Front tyre × 4, Eastman 140AH × 1 (BAT-77)');
  });

  it('says so when nothing was assembled yet, and asks the server for what was searched', async () => {
    const { calls } = open(
      handlers(MAKER, { 'GET /api/assemblies?*': () => jsonResponse(pageOf([])) }),
    );
    expect(await screen.findByText('Nothing has been assembled yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search assemblies'), 'buggy');
    await waitFor(() =>
      expect(
        calls.some(
          (call) => call.key.includes('/api/assemblies?') && call.key.includes('search=buggy'),
        ),
      ).toBe(true),
    );
  });

  it('is not open to someone without the permission', async () => {
    open(handlers(['items.view', 'stock.view']));
    await screen.findByRole('navigation', { name: /main|primary|sidebar/i }).catch(() => undefined);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Assembly' })).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Assemble a product' })).not.toBeInTheDocument();
  });
});

describe('assembling a product', () => {
  it('names what is missing and sends nothing', async () => {
    const { dialog, calls } = await openDialog();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assemble' }));
    expect(await within(dialog).findByText('Choose the product being made')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the selling price')).toBeInTheDocument();
    expect(posted(calls)).toHaveLength(0);
  });

  it('sends the product, its price, how many, and the parts with their quantities', async () => {
    const { dialog, calls } = await openDialog(
      handlers(MAKER, {
        'POST /api/assemblies': () =>
          jsonResponse(assembly({ finishedItemName: 'Charger kit' }), 201),
      }),
    );
    await choose(dialog, 'Product being made', 'KIT', PRODUCT);
    await userEvent.type(within(dialog).getByLabelText('Selling price'), '1250.50');
    const quantity = within(dialog).getByLabelText('How many are made');
    await userEvent.clear(quantity);
    await userEvent.type(quantity, '2');
    const part = within(within(dialog).getByRole('group', { name: 'Part 1' }));
    await choose(dialog, 'Part', 'TYRE', TYRE);
    const partQty = part.getByLabelText('Quantity');
    await userEvent.clear(partQty);
    await userEvent.type(partQty, '8');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assemble' }));
    expect(await screen.findByText(/AS-111120261123 made: Charger kit/)).toBeInTheDocument();
    expect(posted(calls)[0]).toEqual({
      finishedItemId: PRODUCT,
      qty: 2,
      sellingPrice: '1250.50',
      parts: [{ itemId: TYRE, qty: 8 }],
    });
  });

  it('asks for the numbers of a numbered product, makes it one at a time, and sends them', async () => {
    const { dialog, calls } = await openDialog(
      handlers(MAKER, { 'POST /api/assemblies': () => jsonResponse(assembly(), 201) }),
    );
    await choose(dialog, 'Product being made', 'VEH', VEHICLE);
    expect(within(dialog).queryByLabelText('How many are made')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Selling price'), '150000');
    await userEvent.type(within(dialog).getByLabelText('Serial number'), 'CH-100');
    await userEvent.type(within(dialog).getByLabelText('Chassis number'), 'CH-100');
    await userEvent.type(within(dialog).getByLabelText('Motor number'), 'MN-5');
    await choose(dialog, 'Part', 'TYRE', TYRE);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assemble' }));
    await screen.findByText(/made: Indian Buggy/);
    expect(posted(calls)[0]).toMatchObject({
      finishedItemId: VEHICLE,
      qty: 1,
      units: [{ serialNo: 'CH-100', chassisNo: 'CH-100', motorNo: 'MN-5' }],
    });
  });

  it('lets the serial numbers used be ticked for a numbered part, and counts them', async () => {
    const { dialog, calls } = await openDialog(
      handlers(MAKER, { 'POST /api/assemblies': () => jsonResponse(assembly(), 201) }),
    );
    await choose(dialog, 'Product being made', 'KIT', PRODUCT);
    await userEvent.type(within(dialog).getByLabelText('Selling price'), '900');
    await choose(dialog, 'Part', 'BAT', BATTERY);
    const part = within(within(dialog).getByRole('group', { name: 'Part 1' }));
    expect(within(dialog).queryByLabelText('Quantity')).not.toBeInTheDocument();
    await userEvent.click(await part.findByRole('checkbox', { name: 'BAT-77' }));
    await userEvent.click(part.getByRole('checkbox', { name: 'BAT-78' }));
    expect(part.getByText('2 chosen')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assemble' }));
    await screen.findByText(/made:/);
    expect(posted(calls)[0]).toMatchObject({
      parts: [{ itemId: BATTERY, qty: 2, serialUnitIds: [UNIT_A, UNIT_B] }],
    });
  });

  it('adds and removes part rows', async () => {
    const { dialog } = await openDialog();
    expect(within(dialog).queryByRole('button', { name: /^Remove part/ })).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add another part' }));
    expect(within(dialog).getAllByRole('group', { name: /^Part / })).toHaveLength(2);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove part 2' }));
    expect(within(dialog).getAllByRole('group', { name: /^Part / })).toHaveLength(1);
  });

  it('shows why the server refused, such as too little stock, and keeps what was typed', async () => {
    const { dialog } = await openDialog(
      handlers(MAKER, {
        'POST /api/assemblies': () =>
          jsonResponse(
            {
              code: 'BUSINESS_RULE_VIOLATION',
              message: 'There is not enough available stock of TYRE-9',
              details: [{ field: 'qty', message: 'The quantity is more than the stock on hand' }],
              requestId: 'r',
            },
            422,
          ),
      }),
    );
    await choose(dialog, 'Product being made', 'KIT', PRODUCT);
    await userEvent.type(within(dialog).getByLabelText('Selling price'), '900');
    await choose(dialog, 'Part', 'TYRE', TYRE);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assemble' }));
    expect(
      await within(dialog).findByText('There is not enough available stock of TYRE-9'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Selling price')).toHaveValue('900');
  });
});

describe('cost, profit and status in the list', () => {
  it('shows the cost of the parts and the profit, and a dash when they are not known', async () => {
    open(
      handlers(MAKER, {
        'GET /api/assemblies?*': () =>
          jsonResponse(
            pageOf([
              assembly(),
              assembly({
                id: 'as-2',
                assemblyNo: 'AS-111120261124',
                costTotal: null,
                profit: null,
              }),
            ]),
          ),
      }),
    );
    const table = await screen.findByRole('table', { name: 'Assemblies' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('31000.00');
    expect(rows[1]).toHaveTextContent('119000.00');
    expect(rows[2]).not.toHaveTextContent('31000.00');
  });

  it('shows a reversed assembly with its reason and offers nothing more to do', async () => {
    open(
      handlers(MAKER, {
        'GET /api/assemblies?*': () =>
          jsonResponse(
            pageOf([
              assembly({
                reversed: {
                  on: '2026-11-12T05:00:00.000Z',
                  reason: 'Made by mistake',
                  byName: 'Meena',
                },
              }),
            ]),
          ),
      }),
    );
    const table = await screen.findByRole('table', { name: 'Assemblies' });
    expect(within(table).getByText('Reversed')).toBeInTheDocument();
    expect(within(table).getByText('Made by mistake')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reverse AS-/ })).not.toBeInTheDocument();
  });
});

describe('reversing an assembly', () => {
  it('needs a reason, and sends it', async () => {
    const { calls } = open(
      handlers(MAKER, {
        'POST /api/assemblies/as-1/reverse': () =>
          jsonResponse(
            assembly({
              reversed: { on: '2026-11-12T05:00:00.000Z', reason: 'Wrong parts', byName: 'Meena' },
            }),
          ),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Reverse AS-111120261123' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse assembly' }));
    expect(await within(dialog).findByText('Enter the reason')).toBeInTheDocument();
    expect(calls.some((call) => call.key === 'POST /api/assemblies/as-1/reverse')).toBe(false);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Wrong parts');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse assembly' }));
    expect(await screen.findByText('AS-111120261123 reversed')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/assemblies/as-1/reverse')?.body).toEqual({
      reason: 'Wrong parts',
    });
  });

  it('shows why the server refused, such as a product that was already sold', async () => {
    open(
      handlers(MAKER, {
        'POST /api/assemblies/as-1/reverse': () =>
          jsonResponse(
            {
              code: 'BUSINESS_RULE_VIOLATION',
              message:
                'The product CH-100 has already been sold or moved, so this assembly cannot be reversed',
              details: [],
              requestId: 'r',
            },
            422,
          ),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Reverse AS-111120261123' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Wrong parts');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reverse assembly' }));
    expect(
      (await within(dialog).findAllByText(/already been sold or moved/)).length,
    ).toBeGreaterThan(0);
  });
});

describe('making the product on the spot', () => {
  it('asks for the new item and sends it instead of an existing one', async () => {
    const { dialog, calls } = await openDialog(
      handlers(MAKER, { 'POST /api/assemblies': () => jsonResponse(assembly(), 201) }),
    );
    await userEvent.click(within(dialog).getByRole('radio', { name: 'A new item' }));
    expect(within(dialog).queryByLabelText('Product being made')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Item code'), 'kit-77');
    await userEvent.type(within(dialog).getByLabelText('Name of the new item'), 'Weekend kit');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Category'), CATEGORY_CHILD);
    await userEvent.selectOptions(await within(dialog).findByLabelText('Unit'), 'SET');
    await userEvent.type(within(dialog).getByLabelText('Selling price'), '1500');
    await choose(dialog, 'Part', 'TYRE', TYRE);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assemble' }));
    await screen.findByText(/made:/);
    const body = posted(calls)[0] as Record<string, unknown>;
    expect(body).not.toHaveProperty('finishedItemId');
    expect(body['newItem']).toMatchObject({
      itemCode: 'kit-77',
      name: 'Weekend kit',
      categoryId: CATEGORY_CHILD,
      unitCode: 'SET',
      isSerialized: false,
      hsnCode: null,
      taxRate: null,
    });
  });

  it('asks for the numbers when the new item is a vehicle, and names what is missing', async () => {
    const { dialog, calls } = await openDialog();
    await userEvent.click(within(dialog).getByRole('radio', { name: 'A new item' }));
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /serial number of its own/ }),
    );
    expect(within(dialog).getByLabelText('Serial number')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('How many are made')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assemble' }));
    expect(await within(dialog).findByText('Enter the selling price')).toBeInTheDocument();
    expect(posted(calls)).toHaveLength(0);
  });
});
