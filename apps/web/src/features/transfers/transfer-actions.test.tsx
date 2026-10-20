import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import {
  ALL,
  ITEM_ID,
  LINE_ID,
  SERIAL_ITEM_ID,
  SERIAL_LINE_ID,
  VIEWER,
  makeLine,
  makeTransfer,
  transferHandlers,
} from './test-data';
import type { Transfer } from '@erp/contracts';

const openTransfer = async (
  transfer: Transfer,
  options: {
    permissions?: string[];
    worksIn?: 'HQ' | 'EAB' | 'both' | 'neither';
    extra?: Record<string, RouteHandler>;
  } = {},
) => {
  const state = routeFetch({
    ...transferHandlers(options.permissions ?? ALL, [transfer], options.worksIn ?? 'EAB'),
    ...options.extra,
  });
  renderApp('/transfers');
  await userEvent.click(await screen.findByRole('button', { name: `Open ${transfer.transferNo}` }));
  const dialog = await screen.findByRole('dialog');
  await within(dialog).findByRole('table', { name: 'Transfer lines' });
  return { ...state, dialog };
};
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const refusal = (
  message: string,
  details: { field: string; message: string }[] = [],
  status = 422,
) => jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);
const buttons = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('button')
    .map((button) => button.textContent);

describe('a transfer in detail', () => {
  it('shows each line with what was asked, sent, received and damaged, and the history', async () => {
    const { dialog } = await openTransfer(
      makeTransfer({
        status: 'RECEIVED',
        lines: [
          makeLine({
            qtySent: 8,
            qtyReceived: 6,
            qtyDamaged: 1,
            discrepancies: [
              { id: 'd-1', type: 'SHORT', qty: 2, status: 'OPEN' },
              { id: 'd-2', type: 'DAMAGED', qty: 1, status: 'RESOLVED' },
            ],
          }),
        ],
        events: [
          {
            id: 'e-1',
            status: 'REQUESTED',
            at: '2026-10-08T05:00:00.000Z',
            userName: 'Asha Rao',
            note: null,
          },
          {
            id: 'e-2',
            status: 'DISPATCHED',
            at: '2026-10-09T05:00:00.000Z',
            userName: 'Ravi Das',
            note: 'Sent by road',
          },
        ],
      }),
    );
    const line = within(within(dialog).getByRole('table', { name: 'Transfer lines' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(line).toHaveTextContent('BATT-48V · 48V battery');
    expect(line).toHaveTextContent('short 2 (waiting), damaged 1 (settled)');
    const history = within(within(dialog).getByRole('region', { name: 'History' })).getAllByRole(
      'listitem',
    );
    expect(history[0]).toHaveTextContent('Requested · Asha Rao · 2026-10-08');
    expect(history[1]).toHaveTextContent('On its way · Ravi Das · 2026-10-09 · Sent by road');
    expect(within(dialog).getByText(/1 problem waits for a decision/)).toBeInTheDocument();
  });

  it('says so when the transfer cannot be loaded', async () => {
    routeFetch({
      ...transferHandlers(),
      'GET /api/transfers/tr-1': () =>
        jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500),
    });
    renderApp('/transfers');
    await userEvent.click(await screen.findByRole('button', { name: 'Open TRF-HQ-0001' }));
    expect(await screen.findByText('Could not load the transfer.')).toBeInTheDocument();
  });

  it('shows the sending branch the choices for a request, and nothing to dispatch yet', async () => {
    const { dialog } = await openTransfer(makeTransfer());
    expect(buttons(dialog)).toEqual(['Approve', 'Reject', 'Cancel transfer', 'Close']);
  });

  it('shows the receiving branch only a cancel for a request', async () => {
    const { dialog } = await openTransfer(makeTransfer(), { worksIn: 'HQ' });
    expect(buttons(dialog)).toEqual(['Cancel transfer', 'Close']);
  });

  it('offers dispatch, and cancel, to the sending branch once approved', async () => {
    const { dialog } = await openTransfer(makeTransfer({ status: 'APPROVED' }));
    expect(buttons(dialog)).toEqual(['Dispatch', 'Cancel transfer', 'Close']);
  });

  it('offers receiving only to the receiving branch once the goods are on their way', async () => {
    const receiving = await openTransfer(makeTransfer({ status: 'DISPATCHED' }), { worksIn: 'HQ' });
    expect(buttons(receiving.dialog)).toEqual(['Receive goods', 'Close']);
  });

  it('offers receiving for goods that are in transit too', async () => {
    const { dialog } = await openTransfer(makeTransfer({ status: 'IN_TRANSIT' }), {
      worksIn: 'HQ',
    });
    expect(buttons(dialog)).toEqual(['Receive goods', 'Close']);
  });

  it('offers nothing to the sending branch while the goods are on their way', async () => {
    const { dialog } = await openTransfer(makeTransfer({ status: 'DISPATCHED' }), {
      worksIn: 'EAB',
    });
    expect(buttons(dialog)).toEqual(['Close']);
  });

  it.each(['RECEIVED', 'REJECTED', 'CANCELLED'] as const)(
    'offers nothing on a %s transfer',
    async (status) => {
      const { dialog } = await openTransfer(makeTransfer({ status }), { worksIn: 'both' });
      expect(buttons(dialog)).toEqual(['Close']);
    },
  );

  it('offers nothing to people who may only view', async () => {
    const { dialog } = await openTransfer(makeTransfer({ status: 'APPROVED' }), {
      permissions: VIEWER,
      worksIn: 'both',
    });
    expect(buttons(dialog)).toEqual(['Close']);
  });

  it('offers nothing to a person who works in neither branch', async () => {
    const { dialog } = await openTransfer(makeTransfer({ status: 'APPROVED' }), {
      worksIn: 'neither',
    });
    expect(buttons(dialog)).toEqual(['Close']);
  });
});

describe('approving, rejecting and cancelling', () => {
  it('approves with the version that was read', async () => {
    const { dialog, calls } = await openTransfer(makeTransfer(), {
      extra: {
        'POST /api/transfers/tr-1/approve': () =>
          jsonResponse(makeTransfer({ status: 'APPROVED' })),
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Transfer TRF-HQ-0001 approved')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/transfers/tr-1/approve')).toEqual({ rowVersion: 3 });
  });

  it('shows why an approval was refused and keeps the transfer open', async () => {
    const { dialog } = await openTransfer(makeTransfer(), {
      extra: {
        'POST /api/transfers/tr-1/approve': () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'This transfer was changed by someone else. Reload it and try again',
              details: [],
              requestId: 'r',
            },
            409,
          ),
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Approve' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('needs a reason to reject, then rejects with it', async () => {
    const { dialog, calls } = await openTransfer(makeTransfer(), {
      extra: {
        'POST /api/transfers/tr-1/reject': () => jsonResponse(makeTransfer({ status: 'REJECTED' })),
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await userEvent.type(within(dialog).getByLabelText('Reason for rejecting'), 'Not enough stock');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject the transfer' }));
    expect(await screen.findByText('Transfer TRF-HQ-0001 rejected')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/transfers/tr-1/reject')).toEqual({
      rowVersion: 3,
      note: 'Not enough stock',
    });
  });

  it('shows the server’s message when a rejection has no reason', async () => {
    const { dialog } = await openTransfer(makeTransfer(), {
      extra: {
        'POST /api/transfers/tr-1/reject': () =>
          refusal('Say why', [{ field: 'note', message: 'Give at least 3 characters' }], 400),
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject the transfer' }));
    expect(
      (await within(dialog).findAllByText('Give at least 3 characters')).length,
    ).toBeGreaterThan(0);
  });

  it('lets either branch cancel, with an optional note', async () => {
    const { dialog, calls } = await openTransfer(makeTransfer({ status: 'APPROVED' }), {
      worksIn: 'HQ',
      extra: {
        'POST /api/transfers/tr-1/cancel': () =>
          jsonResponse(makeTransfer({ status: 'CANCELLED' })),
      },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel transfer' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel the transfer' }));
    expect(await screen.findByText('Transfer TRF-HQ-0001 cancelled')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/transfers/tr-1/cancel')).toEqual({ rowVersion: 3 });
  });

  it('lets a person change their mind about rejecting', async () => {
    const { dialog } = await openTransfer(makeTransfer());
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Go back' }));
    expect(within(dialog).getByRole('button', { name: 'Approve' })).toBeInTheDocument();
  });
});

describe('dispatching', () => {
  const approved = makeTransfer({
    status: 'APPROVED',
    lines: [
      makeLine(),
      makeLine({
        id: SERIAL_LINE_ID,
        itemId: SERIAL_ITEM_ID,
        itemCode: 'TOTO-X1',
        itemName: 'TOTO X1',
        isSerialized: true,
        qtyRequested: 2,
      }),
    ],
  });
  const openDispatch = async (extra: Record<string, RouteHandler> = {}) => {
    const { dialog: detail, ...state } = await openTransfer(approved, { extra });
    await userEvent.click(within(detail).getByRole('button', { name: 'Dispatch' }));
    const dialog = await screen.findByRole('dialog', { name: 'Dispatch TRF-HQ-0001' });
    return { ...state, dialog };
  };

  it('names the receiving branch in its explanation', async () => {
    const { dialog } = await openDispatch();
    expect(within(dialog).getByText(/Count what is being sent to HQ\./)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('{');
  });

  it('starts each plain line at what was asked for and asks for serial numbers on serial lines', async () => {
    const { dialog } = await openDispatch();
    expect(within(dialog).getByLabelText('Quantity to send for BATT-48V')).toHaveValue(10);
    expect(within(dialog).getByText('2 units were asked for. One per line')).toBeInTheDocument();
  });

  it('refuses the wrong number of serial numbers and sends nothing', async () => {
    const { dialog, calls } = await openDispatch();
    await userEvent.type(within(dialog).getByLabelText('Serial numbers for TOTO-X1'), 'tx-001');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dispatch' }));
    expect(
      await within(dialog).findByText('2 units were asked for, 1 entered'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/transfers/tr-1/dispatch')).toBe(false);
  });

  it('refuses sending nothing', async () => {
    const { dialog } = await openDispatch();
    const qty = within(dialog).getByLabelText('Quantity to send for BATT-48V');
    await userEvent.clear(qty);
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers for TOTO-X1'),
      'tx-001{enter}tx-002',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dispatch' }));
    expect(await within(dialog).findByText('Enter a whole number')).toBeInTheDocument();
  });

  it('refuses the same serial number twice', async () => {
    const { dialog } = await openDispatch();
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers for TOTO-X1'),
      'tx-001{enter}tx-001',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dispatch' }));
    expect(await within(dialog).findByText('A serial number appears twice')).toBeInTheDocument();
  });

  it('can send fewer than were asked for, with upper-case serial numbers and a note', async () => {
    const { dialog, calls } = await openDispatch({
      'POST /api/transfers/tr-1/dispatch': () =>
        jsonResponse(makeTransfer({ status: 'DISPATCHED' })),
    });
    const qty = within(dialog).getByLabelText('Quantity to send for BATT-48V');
    await userEvent.clear(qty);
    await userEvent.type(qty, '7');
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers for TOTO-X1'),
      'tx-001, tx-002',
    );
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Sent by road');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dispatch' }));
    expect(await screen.findByText('Transfer TRF-HQ-0001 dispatched')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/transfers/tr-1/dispatch')).toEqual({
      rowVersion: 3,
      note: 'Sent by road',
      items: [
        { itemId: ITEM_ID, qty: 7 },
        { itemId: SERIAL_ITEM_ID, serialNos: ['TX-001', 'TX-002'] },
      ],
    });
  });

  it('shows the server’s reasons, such as stock the sender does not have', async () => {
    const { dialog } = await openDispatch({
      'POST /api/transfers/tr-1/dispatch': () =>
        refusal('Some units cannot be sent', [
          { field: 'items', message: 'TX-002 is not available in the sending branch' },
        ]),
    });
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers for TOTO-X1'),
      'tx-001, tx-002',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dispatch' }));
    expect(await within(dialog).findByText('Some units cannot be sent')).toBeInTheDocument();
    expect(
      within(dialog).getByText('TX-002 is not available in the sending branch'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});

describe('receiving', () => {
  const onItsWay = makeTransfer({
    status: 'DISPATCHED',
    lines: [
      makeLine({ qtySent: 8 }),
      makeLine({
        id: SERIAL_LINE_ID,
        itemId: SERIAL_ITEM_ID,
        itemCode: 'TOTO-X1',
        itemName: 'TOTO X1',
        isSerialized: true,
        serialNo: 'TX-001',
        qtyRequested: 1,
        qtySent: 1,
      }),
      makeLine({
        id: '7d4e5f6a-8b9c-4dae-9bc3-4e5f60718293',
        itemId: SERIAL_ITEM_ID,
        itemCode: 'TOTO-X1',
        itemName: 'TOTO X1',
        isSerialized: true,
        serialNo: 'TX-002',
        qtyRequested: 1,
        qtySent: 1,
      }),
    ],
  });
  const openReceive = async (extra: Record<string, RouteHandler> = {}) => {
    const { dialog: detail, ...state } = await openTransfer(onItsWay, { worksIn: 'HQ', extra });
    await userEvent.click(within(detail).getByRole('button', { name: 'Receive goods' }));
    const dialog = await screen.findByRole('dialog', { name: 'Receive TRF-HQ-0001' });
    return { ...state, dialog };
  };

  it('names the sending branch in its explanation', async () => {
    const { dialog } = await openReceive();
    expect(within(dialog).getByText(/Count what arrived from EAB\./)).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent('{');
  });

  it('starts each plain line at what was sent and lists the serial numbers to look for', async () => {
    const { dialog } = await openReceive();
    expect(within(dialog).getByLabelText('Arrived for BATT-48V')).toHaveValue(8);
    expect(within(dialog).getByText('Serial numbers sent: TX-001, TX-002')).toBeInTheDocument();
  });

  it('refuses more damaged than arrived and a damaged serial number that did not arrive', async () => {
    const { dialog, calls } = await openReceive();
    await userEvent.type(within(dialog).getByLabelText('Damaged for BATT-48V'), '9');
    await userEvent.type(within(dialog).getByLabelText('Serial numbers that arrived'), 'tx-001');
    await userEvent.type(within(dialog).getByLabelText('Damaged serial numbers'), 'tx-002');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(await within(dialog).findByText('More damaged than arrived')).toBeInTheDocument();
    expect(
      within(dialog).getByText('TX-002 is not in the list of serial numbers that arrived'),
    ).toBeInTheDocument();
    expect(calls.some((c) => c.key === 'POST /api/transfers/tr-1/receive')).toBe(false);
  });

  it('records the count, the damaged units and the serial numbers that arrived', async () => {
    const received = makeTransfer({
      status: 'RECEIVED',
      lines: [
        makeLine({
          qtySent: 8,
          qtyReceived: 7,
          qtyDamaged: 1,
          discrepancies: [
            { id: 'd-1', type: 'SHORT', qty: 1, status: 'OPEN' },
            { id: 'd-2', type: 'DAMAGED', qty: 1, status: 'OPEN' },
          ],
        }),
      ],
    });
    const { dialog, calls } = await openReceive({
      'POST /api/transfers/tr-1/receive': () => jsonResponse(received),
    });
    const arrived = within(dialog).getByLabelText('Arrived for BATT-48V');
    await userEvent.clear(arrived);
    await userEvent.type(arrived, '7');
    await userEvent.type(within(dialog).getByLabelText('Damaged for BATT-48V'), '1');
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers that arrived'),
      'tx-001{enter}tx-002',
    );
    await userEvent.type(within(dialog).getByLabelText('Damaged serial numbers'), 'tx-002');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(
      await screen.findByText('Transfer TRF-HQ-0001 received. 2 problems need a decision.'),
    ).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/transfers/tr-1/receive')).toEqual({
      rowVersion: 3,
      lines: [{ lineId: LINE_ID, received: 7, damaged: 1 }],
      serials: [
        { serialNo: 'TX-001', damaged: false },
        { serialNo: 'TX-002', damaged: true },
      ],
    });
  });

  it('says nothing about decisions when everything arrived in good order', async () => {
    const { dialog } = await openReceive({
      'POST /api/transfers/tr-1/receive': () => jsonResponse(makeTransfer({ status: 'RECEIVED' })),
    });
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers that arrived'),
      'tx-001, tx-002',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(await screen.findByText('Transfer TRF-HQ-0001 received.')).toBeInTheDocument();
  });

  it('shows the server’s refusal and keeps the dialog open', async () => {
    const { dialog } = await openReceive({
      'POST /api/transfers/tr-1/receive': () =>
        refusal('The goods do not match this transfer', [
          { field: 'serials', message: 'TX-009 is not part of this transfer' },
        ]),
    });
    await userEvent.type(within(dialog).getByLabelText('Serial numbers that arrived'), 'tx-009');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record receipt' }));
    expect(
      await within(dialog).findByText('The goods do not match this transfer'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('TX-009 is not part of this transfer')).toBeInTheDocument();
  });
});
