import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { itemPage, makeItem } from '@/features/items/test-data';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import {
  adjustment,
  BRANCH_ID,
  inventoryHandlers,
  MANAGER,
  OTHER_BRANCH_ID,
  page,
  serialUnit,
  STAFF,
} from './test-data';

const PLAIN = '33333333-3333-4333-8333-333333333333';
const SERIAL = '44444444-4444-4444-8444-444444444444';
const UNIT = '55555555-5555-4555-8555-555555555555';

const openTab = async (handlers: Record<string, RouteHandler> = inventoryHandlers()) => {
  const state = routeFetch(handlers);
  renderApp('/inventory');
  await userEvent.click(await screen.findByRole('tab', { name: 'Adjustments' }));
  return state;
};
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const refusal = (
  message: string,
  details: { field: string; message: string }[] = [],
  status = 422,
) => jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);

describe('the adjustment list', () => {
  it('lets a manager approve or reject a waiting request', async () => {
    await openTab();
    const table = await screen.findByRole('table', { name: 'Adjustments' });
    const row = within(table).getAllByRole('row')[1] as HTMLElement;
    expect(row).toHaveTextContent('Remove 2 × BAT-1 (available)');
    expect(row).toHaveTextContent('Water damage');
    expect(row).toHaveTextContent('Meera Das');
    expect(row).toHaveTextContent('Waiting for approval');
    expect(within(row).getByRole('button', { name: /^Approve/ })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /^Reject/ })).toBeInTheDocument();
  });

  it('lets Staff cancel their own request but not decide it, and see nobody else’s buttons', async () => {
    await openTab(
      inventoryHandlers(STAFF, {
        'GET /api/stock/adjustments?*': () =>
          jsonResponse(
            page([
              adjustment({ id: 'mine', requestedById: 'user-1', reason: 'Mine to cancel' }),
              adjustment({ id: 'theirs', requestedById: 'user-9', reason: 'Not mine' }),
            ]),
          ),
      }),
    );
    const table = await screen.findByRole('table', { name: 'Adjustments' });
    const [, mine, theirs] = within(table).getAllByRole('row');
    expect(within(mine!).getByRole('button', { name: /^Cancel/ })).toBeInTheDocument();
    expect(within(mine!).queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
    expect(within(theirs!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows decided requests without buttons, with the note', async () => {
    await openTab(
      inventoryHandlers(MANAGER, {
        'GET /api/stock/adjustments?*': () =>
          jsonResponse(page([adjustment({ status: 'REJECTED', decisionNote: 'Count is wrong' })])),
      }),
    );
    const row = within(await screen.findByRole('table', { name: 'Adjustments' })).getAllByRole(
      'row',
    )[1];
    expect(row).toHaveTextContent('Rejected');
    expect(row).toHaveTextContent('Count is wrong');
    expect(within(row!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('asks the server for the status the user picks', async () => {
    const { calls } = await openTab();
    await screen.findByRole('table', { name: 'Adjustments' });
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'APPROVED');
    await waitFor(() =>
      expect(
        calls.filter((c) => c.key.startsWith('GET /api/stock/adjustments')).at(-1)?.key,
      ).toContain('status=APPROVED'),
    );
  });

  it('explains an empty queue', async () => {
    await openTab({
      ...inventoryHandlers(),
      'GET /api/stock/adjustments?*': () => jsonResponse(page([])),
    });
    expect(await screen.findByText('No adjustments are waiting for approval.')).toBeInTheDocument();
  });
});

describe('deciding', () => {
  it('approves with an optional note, using the row version, and says the stock was updated', async () => {
    const { calls } = await openTab({
      ...inventoryHandlers(),
      'POST /api/stock/adjustments/a-1/approve': () =>
        jsonResponse(adjustment({ status: 'APPROVED' })),
    });
    await userEvent.click(await screen.findByRole('button', { name: /^Approve/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Note (optional)'), 'Checked on the shelf');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('Adjustment approved. The stock has been updated.'),
    ).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/stock/adjustments/a-1/approve')).toEqual({
      rowVersion: 1,
      note: 'Checked on the shelf',
    });
  });

  it('shows why an approval was refused and keeps the dialog open', async () => {
    await openTab({
      ...inventoryHandlers(),
      'POST /api/stock/adjustments/a-1/approve': () =>
        refusal('There is not enough available stock of BAT-1', [
          { field: 'qty', message: 'The quantity is more than the stock on hand' },
        ]),
    });
    await userEvent.click(await screen.findByRole('button', { name: /^Approve/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(
      await within(dialog).findByText('There is not enough available stock of BAT-1'),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText('The quantity is more than the stock on hand'),
    ).toBeInTheDocument();
  });

  it('will not reject without a reason, then rejects with one', async () => {
    const { calls } = await openTab({
      ...inventoryHandlers(),
      'POST /api/stock/adjustments/a-1/reject': () =>
        jsonResponse(adjustment({ status: 'REJECTED' })),
    });
    await userEvent.click(await screen.findByRole('button', { name: /^Reject/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await within(dialog).findByText('Say why it is rejected')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/stock/adjustments/a-1/reject')).toBe(false);
    await userEvent.type(within(dialog).getByLabelText('Why is it rejected?'), 'Count is wrong');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    expect(await screen.findByText('Adjustment rejected. No stock moved.')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/stock/adjustments/a-1/reject')).toEqual({
      rowVersion: 1,
      note: 'Count is wrong',
    });
  });

  it('cancels the person’s own request', async () => {
    const { calls } = await openTab(
      inventoryHandlers(STAFF, {
        'GET /api/stock/adjustments?*': () =>
          jsonResponse(page([adjustment({ requestedById: 'user-1' })])),
        'POST /api/stock/adjustments/a-1/cancel': () =>
          jsonResponse(adjustment({ status: 'CANCELLED' })),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Cancel/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel request' }),
    );
    expect(await screen.findByText('Request cancelled.')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/stock/adjustments/a-1/cancel')).toEqual({ rowVersion: 1 });
  });

  it('tells the user when somebody else already decided the request', async () => {
    await openTab({
      ...inventoryHandlers(),
      'POST /api/stock/adjustments/a-1/approve': () =>
        jsonResponse(
          {
            code: 'INVALID_STATE',
            message: 'Stock adjustment cannot move from APPROVED to APPROVED',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: /^Approve/ }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Approve' }),
    );
    expect(await screen.findByText(/cannot move from APPROVED/)).toBeInTheDocument();
  });
});

describe('requesting an adjustment', () => {
  const itemHandlers = (
    items = [makeItem({ id: PLAIN, itemCode: 'BAT-1', name: 'Battery 12V', isSerialized: false })],
  ) => ({
    'GET /api/items?*': () => jsonResponse(itemPage(items)),
  });
  const openForm = async (extra: Record<string, RouteHandler> = {}, permissions = STAFF) => {
    const state = await openTab(inventoryHandlers(permissions, { ...itemHandlers(), ...extra }));
    await userEvent.click(await screen.findByRole('button', { name: 'Request adjustment' }));
    return { ...state, dialog: await screen.findByRole('dialog') };
  };
  const chooseItem = async (dialog: HTMLElement, id = PLAIN) => {
    await userEvent.type(within(dialog).getByLabelText('Find item'), 'bat');
    await within(dialog).findByRole('option', { name: /BAT-1/ });
    await userEvent.selectOptions(within(dialog).getByLabelText('Matching items'), id);
  };

  it('is offered only to people who may adjust stock', async () => {
    await openTab(inventoryHandlers(['stock.view']));
    await screen.findByRole('table', { name: 'Adjustments' });
    expect(screen.queryByRole('button', { name: 'Request adjustment' })).not.toBeInTheDocument();
  });

  it('names what is missing and sends nothing', async () => {
    const { dialog, calls } = await openForm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    expect(await within(dialog).findByText('Choose an item')).toBeInTheDocument();
    expect(within(dialog).getByText('Give a reason of at least 3 characters')).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/stock/adjustments')).toBe(false);
  });

  it('sends a plain stock removal for the branch the user works in', async () => {
    const { dialog, calls } = await openForm({
      'POST /api/stock/adjustments': () => jsonResponse(adjustment(), 201),
    });
    await chooseItem(dialog);
    await userEvent.selectOptions(within(dialog).getByLabelText('What to do'), 'OUT');
    await userEvent.clear(within(dialog).getByLabelText('Quantity'));
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '3');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Water damage');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    expect(
      await screen.findByText(/It waits for approval and no stock has moved yet/),
    ).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/stock/adjustments')).toMatchObject({
      branchId: BRANCH_ID,
      itemId: PLAIN,
      kind: 'OUT',
      state: 'AVAILABLE',
      qty: 3,
      reason: 'Water damage',
    });
  });

  it('asks for the target state of a state change and refuses the same state', async () => {
    const { dialog } = await openForm();
    await chooseItem(dialog);
    await userEvent.selectOptions(within(dialog).getByLabelText('What to do'), 'STATE_CHANGE');
    expect(within(dialog).getByLabelText('From state')).toBeInTheDocument();
    expect(
      within(dialog.querySelector('select[id]:not([aria-label])') as HTMLElement),
    ).toBeTruthy();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Dropped in transit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    expect(
      await within(dialog).findByText('Choose the state the stock moves to'),
    ).toBeInTheDocument();
    const toState = within(dialog).getByLabelText('To state');
    expect(within(toState).queryByRole('option', { name: 'available' })).not.toBeInTheDocument();
  });

  it('asks for a serial number, and no quantity, when stock of a serial item comes in', async () => {
    const { dialog, calls } = await openForm({
      ...itemHandlers([
        makeItem({ id: SERIAL, itemCode: 'BAT-1', name: 'TOTO', isSerialized: true }),
      ]),
      'POST /api/stock/adjustments': () => jsonResponse(adjustment({ kind: 'IN' }), 201),
    });
    await chooseItem(dialog, SERIAL);
    expect(within(dialog).queryByLabelText('Quantity')).not.toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Received unit');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    expect(await within(dialog).findByText('Enter the serial number')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Serial number'), 'sn-77');
    await userEvent.type(within(dialog).getByLabelText('Chassis number'), 'ch-77');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    await waitFor(() => expect(bodyOf(calls, 'POST /api/stock/adjustments')).toBeDefined());
    expect(bodyOf(calls, 'POST /api/stock/adjustments')).toMatchObject({
      itemId: SERIAL,
      kind: 'IN',
      qty: 1,
      serialNo: 'SN-77',
      chassisNo: 'CH-77',
    });
  });

  it('lets the user pick the serial unit when serial stock goes out', async () => {
    const { dialog, calls } = await openForm({
      ...itemHandlers([
        makeItem({ id: SERIAL, itemCode: 'BAT-1', name: 'TOTO', isSerialized: true }),
      ]),
      'GET /api/stock/serial-units?*': () =>
        jsonResponse(page([serialUnit({ id: UNIT, serialNo: 'SN-7', chassisNo: 'CH-7' })])),
      'POST /api/stock/adjustments': () => jsonResponse(adjustment({ kind: 'WRITE_OFF' }), 201),
    });
    await chooseItem(dialog, SERIAL);
    await userEvent.selectOptions(within(dialog).getByLabelText('What to do'), 'WRITE_OFF');
    await within(dialog).findByRole('option', { name: 'SN-7 (CH-7)' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    expect(await within(dialog).findByText('Choose the serial unit')).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Serial unit'), UNIT);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Burnt in fire');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    await waitFor(() => expect(bodyOf(calls, 'POST /api/stock/adjustments')).toBeDefined());
    expect(bodyOf(calls, 'POST /api/stock/adjustments')).toMatchObject({
      kind: 'WRITE_OFF',
      serialUnitId: UNIT,
      qty: 1,
    });
    expect(
      calls.some((c) => c.key.includes('serial-units?') && c.key.includes(`itemId=${SERIAL}`)),
    ).toBe(true);
  });

  it('puts a server refusal next to the field it is about', async () => {
    const { dialog } = await openForm({
      'POST /api/stock/adjustments': () =>
        refusal('Only 1 of BAT-1 available in this branch', [
          { field: 'qty', message: 'The quantity is more than the 1 on hand' },
        ]),
    });
    await chooseItem(dialog);
    await userEvent.selectOptions(within(dialog).getByLabelText('What to do'), 'OUT');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Too many');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    expect(
      await within(dialog).findByText('The quantity is more than the 1 on hand'),
    ).toBeInTheDocument();
  });

  it('makes a multi-branch user choose the branch', async () => {
    const two = [
      { id: BRANCH_ID, code: 'HQ', name: 'Head Office' },
      { id: OTHER_BRANCH_ID, code: 'KOL', name: 'Kolkata' },
    ];
    routeFetch(inventoryHandlers(STAFF, itemHandlers(), two));
    renderApp('/inventory');
    await userEvent.click(await screen.findByRole('tab', { name: 'Adjustments' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Request adjustment' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Request adjustment' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Branch')).toHaveAttribute('aria-invalid', 'true'),
    );
  });
});
