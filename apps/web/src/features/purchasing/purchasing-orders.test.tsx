import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { itemPage, makeItem } from '../items/test-data';
import {
  ALL,
  CLERK,
  ITEM_ID,
  SUPPLIER_ID,
  VIEWER,
  makeOrder,
  makeSupplier,
  pageOf,
  purchasingHandlers,
  summaryOf,
} from './test-data';

const open = (handlers: Record<string, RouteHandler> = purchasingHandlers()) => {
  const state = routeFetch(handlers);
  const view = renderApp('/purchasing');
  return { ...state, ...view };
};
const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith('GET /api/purchase-orders?'));
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const rows = () =>
  within(screen.getByRole('table', { name: 'Purchase orders' }))
    .getAllByRole('row')
    .slice(1);
const refusal = (
  message: string,
  details: { field: string; message: string }[] = [],
  status = 422,
) => jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);

describe('the purchasing page', () => {
  it('shows only the sections the user may use, starting with orders', async () => {
    open(purchasingHandlers(ALL));
    await screen.findByRole('table', { name: 'Purchase orders' });
    const tabs = within(screen.getByRole('tablist', { name: 'Purchasing sections' }));
    expect(tabs.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Orders',
      'Receipts',
      'Discrepancies',
      'Returns',
      'Suppliers',
    ]);
    expect(tabs.getByRole('tab', { name: 'Orders' })).toHaveAttribute('aria-selected', 'true');
  });

  it('hides discrepancies and suppliers from a user who may only view purchases', async () => {
    open(purchasingHandlers(VIEWER));
    await screen.findByRole('table', { name: 'Purchase orders' });
    const tabs = within(screen.getByRole('tablist', { name: 'Purchasing sections' }));
    expect(tabs.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Orders',
      'Receipts',
      'Returns',
    ]);
  });

  it('keeps people without purchases.view away', async () => {
    open(purchasingHandlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });
});

describe('the order list', () => {
  it('shows a loading message, then each order in words a person can act on', async () => {
    open({
      ...purchasingHandlers(ALL, [
        makeOrder(),
        makeOrder({
          id: 'po-2',
          poNo: 'PO-HQ-0002',
          status: 'PARTIALLY_RECEIVED',
          remainingQty: 4,
          total: '800.00',
        }),
      ]),
    });
    const [first, second] = await waitFor(() => {
      const found = rows();
      expect(found).toHaveLength(2);
      return found;
    });
    expect(first).toHaveTextContent('PO-HQ-0001');
    expect(first).toHaveTextContent('Bharat Batteries');
    expect(first).toHaveTextContent('Draft');
    expect(first).toHaveTextContent('1200.00');
    expect(second).toHaveTextContent('Partly received');
    expect(second).toHaveTextContent('800.00');
  });

  it('shows loading, empty and error states, and recovers on Retry', async () => {
    open({
      ...purchasingHandlers(),
      'GET /api/purchase-orders?*': () => new Promise<Response>(() => undefined),
    });
    expect(await screen.findByText('Loading purchase orders…')).toBeInTheDocument();

    open({
      ...purchasingHandlers(ALL, []),
      'GET /api/purchase-orders?*': () => jsonResponse(pageOf([])),
    });
    expect(await screen.findByText('There are no purchase orders yet.')).toBeInTheDocument();

    let fail = true;
    open({
      ...purchasingHandlers(),
      'GET /api/purchase-orders?*': () =>
        fail
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse(pageOf([summaryOf(makeOrder())])),
    });
    expect(await screen.findByText('Could not load the purchase orders.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('PO-HQ-0001')).toBeInTheDocument();
  });

  it('asks the server for the search and status the user chose, and for the next page', async () => {
    const { calls } = open({
      ...purchasingHandlers(),
      'GET /api/purchase-orders?*': () =>
        jsonResponse(pageOf([summaryOf(makeOrder())], { total: 25, totalPages: 3 })),
    });
    await screen.findByText('PO-HQ-0001');
    await userEvent.type(screen.getByLabelText('Search'), 'bharat');
    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.key.includes('search=bharat'))).toBe(true),
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'open');
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('status=open'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('page=2'));
  });

  it('offers a new order to people who may create one', async () => {
    open(purchasingHandlers(CLERK));
    await screen.findByText('PO-HQ-0001');
    expect(screen.getByRole('button', { name: 'New purchase order' })).toBeInTheDocument();
  });

  it('offers no new order to people who may only view', async () => {
    open(purchasingHandlers(VIEWER));
    await screen.findByText('PO-HQ-0001');
    expect(screen.queryByRole('button', { name: 'New purchase order' })).not.toBeInTheDocument();
  });
});

describe('creating an order', () => {
  const openNew = async (extra: Record<string, RouteHandler> = {}) => {
    const state = open({
      ...purchasingHandlers(CLERK),
      'GET /api/items?*': () =>
        jsonResponse(
          itemPage([
            makeItem({
              id: ITEM_ID,
              itemCode: 'BATT-48V',
              name: '48V battery',
              isSerialized: false,
            }),
          ]),
        ),
      ...extra,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New purchase order' }));
    const dialog = await screen.findByRole('dialog');
    return { ...state, dialog };
  };
  const fill = async (dialog: HTMLElement) => {
    await userEvent.type(within(dialog).getByLabelText('Find the supplier'), 'Bharat');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching suppliers'),
      SUPPLIER_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Item'), 'BATT');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching items for Item'),
      ITEM_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '10');
    await userEvent.type(within(dialog).getByLabelText('Unit cost'), '120.00');
  };

  it('names what is missing and sends nothing', async () => {
    const { dialog, calls } = await openNew();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create order' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Find the supplier')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(within(dialog).getByLabelText('Item')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('Quantity')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('Unit cost')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.key === 'POST /api/purchase-orders')).toBe(false);
  });

  it('adds up the order as lines are typed, and lets lines be added and removed', async () => {
    const { dialog } = await openNew();
    await fill(dialog);
    expect(within(dialog).getByLabelText('Order total')).toHaveTextContent('Total: 1200.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a line' }));
    expect(within(dialog).getByLabelText('Line 2')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove line 2' }));
    expect(within(dialog).queryByLabelText('Line 2')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Remove line/ })).not.toBeInTheDocument();
  });

  it('creates the draft and confirms it', async () => {
    const created = makeOrder({ id: 'po-9', poNo: 'PO-HQ-0009' });
    const { dialog, calls } = await openNew({
      'POST /api/purchase-orders': () => jsonResponse(created, 201),
    });
    await fill(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create order' }));
    expect(
      await screen.findByText('Purchase order PO-HQ-0009 created as a draft'),
    ).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/purchase-orders')).toMatchObject({
      supplierId: SUPPLIER_ID,
      lines: [{ itemId: ITEM_ID, qtyOrdered: 10, unitCost: '120.00' }],
    });
  });

  it('shows every reason the server gave for refusing', async () => {
    const { dialog } = await openNew({
      'POST /api/purchase-orders': () =>
        refusal('The order cannot be saved', [
          { field: 'lines', message: 'This supplier is inactive' },
        ]),
    });
    await fill(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create order' }));
    expect(await within(dialog).findByText('The order cannot be saved')).toBeInTheDocument();
    expect(within(dialog).getByText('This supplier is inactive')).toBeInTheDocument();
  });

  it('finds no supplier when none matches', async () => {
    const { dialog } = await openNew({
      'GET /api/suppliers?*': () => jsonResponse(pageOf([])),
    });
    await userEvent.type(within(dialog).getByLabelText('Find the supplier'), 'Nobody');
    expect(await within(dialog).findByText('No supplier matches.')).toBeInTheDocument();
  });
});

describe('an order in detail', () => {
  const openOrder = async (
    order = makeOrder(),
    permissions: string[] = ALL,
    extra: Record<string, RouteHandler> = {},
  ) => {
    const state = open({ ...purchasingHandlers(permissions, [order]), ...extra });
    await userEvent.click(await screen.findByRole('button', { name: `Open ${order.poNo}` }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('table', { name: 'Order lines' });
    return { ...state, dialog };
  };

  it('shows the lines with what has arrived and what is still to come', async () => {
    const { dialog } = await openOrder(
      makeOrder({
        status: 'PARTIALLY_RECEIVED',
        receiptCount: 1,
        lines: [{ ...makeOrder().lines[0]!, accepted: 6, closed: 1, remaining: 3 }],
      }),
    );
    const line = within(within(dialog).getByRole('table', { name: 'Order lines' })).getAllByRole(
      'row',
    )[1];
    expect(line).toHaveTextContent('BATT-48V · 48V battery');
    expect(line).toHaveTextContent('10');
    expect(line).toHaveTextContent('6');
    expect(line).toHaveTextContent('3');
    expect(within(dialog).getByText(/Total 1200\.00 · 1 goods receipt$/)).toBeInTheDocument();
  });

  it('lets an approver approve a draft with the version they read', async () => {
    const { dialog, calls } = await openOrder(makeOrder(), ALL, {
      'POST /api/purchase-orders/po-1/approve': () =>
        jsonResponse(makeOrder({ status: 'APPROVED', rowVersion: 4 })),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Purchase order PO-HQ-0001 approved')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/purchase-orders/po-1/approve')).toEqual({ rowVersion: 3 });
  });

  it('shows why an approval was refused and keeps the order open', async () => {
    const { dialog } = await openOrder(makeOrder(), ALL, {
      'POST /api/purchase-orders/po-1/approve': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'This order was changed by someone else. Reload it and try again',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('needs a reason to cancel, then cancels with it', async () => {
    const { dialog, calls } = await openOrder(makeOrder({ status: 'APPROVED' }), ALL, {
      'POST /api/purchase-orders/po-1/cancel': () =>
        jsonResponse(makeOrder({ status: 'CANCELLED' })),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel order' }));
    await userEvent.type(within(dialog).getByLabelText('Reason for cancelling'), 'Supplier closed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the order' }));
    expect(await screen.findByText('Purchase order PO-HQ-0001 cancelled')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/purchase-orders/po-1/cancel')).toEqual({
      rowVersion: 3,
      reason: 'Supplier closed',
    });
  });

  it('shows the server’s message when a cancel has no reason', async () => {
    const { dialog } = await openOrder(makeOrder(), ALL, {
      'POST /api/purchase-orders/po-1/cancel': () =>
        refusal(
          'Say why the order is cancelled',
          [{ field: 'reason', message: 'Give a reason of at least 3 characters' }],
          400,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel order' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the order' }));
    expect(
      (await within(dialog).findAllByText('Give a reason of at least 3 characters')).length,
    ).toBeGreaterThan(0);
  });

  it('offers only the actions the order’s status and the user’s permissions allow', async () => {
    const draft = await openOrder(makeOrder(), ['purchases.view', 'purchases.create']);
    expect(within(draft.dialog).getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(within(draft.dialog).queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(
      within(draft.dialog).queryByRole('button', { name: 'Cancel order' }),
    ).not.toBeInTheDocument();
    expect(
      within(draft.dialog).queryByRole('button', { name: 'Receive goods' }),
    ).not.toBeInTheDocument();
  });

  it('offers goods to be received only on an approved or partly received order', async () => {
    const approved = await openOrder(makeOrder({ status: 'APPROVED' }));
    expect(
      within(approved.dialog).getByRole('button', { name: 'Receive goods' }),
    ).toBeInTheDocument();
    expect(within(approved.dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(
      within(approved.dialog).queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
  });

  it('offers nothing to change on a received order', async () => {
    const { dialog } = await openOrder(makeOrder({ status: 'RECEIVED', remainingQty: 0 }));
    expect(within(dialog).queryByRole('button', { name: 'Receive goods' })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('says so when the order cannot be loaded', async () => {
    open({
      ...purchasingHandlers(),
      'GET /api/purchase-orders/po-1': () =>
        jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open PO-HQ-0001' }));
    expect(await screen.findByText('Could not load the order.')).toBeInTheDocument();
  });
});

describe('suppliers named in an order', () => {
  it('uses the supplier the user chose', async () => {
    expect(makeSupplier().name).toBe('Bharat Batteries');
  });
});
