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
  makeDiscrepancy,
  makeOrder,
  makeReceipt,
  makeReturn,
  pageOf,
  purchasingHandlers,
  summaryOf,
} from './test-data';

const open = async (tab: string, extra: Record<string, RouteHandler> = {}, permissions = ALL) => {
  const state = routeFetch({ ...purchasingHandlers(permissions), ...extra });
  renderApp('/purchasing');
  await userEvent.click(await screen.findByRole('tab', { name: tab }));
  return state;
};
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const refusal = (
  message: string,
  details: { field: string; message: string }[] = [],
  status = 422,
) => jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);
const failure = () =>
  jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500);

const summary = (over: object = {}) => {
  const { lines, ...rest } = makeReceipt();
  void lines;
  return { ...rest, lineCount: 1, openDiscrepancies: 0, ...over };
};

describe('goods receipts', () => {
  it('lists each receipt with its order, supplier, who received it and what waits for a decision', async () => {
    await open('Receipts', {
      'GET /api/goods-receipts?*': () => jsonResponse(pageOf([summary({ openDiscrepancies: 2 })])),
    });
    const row = within(await screen.findByRole('table', { name: 'Goods receipts' })).getAllByRole(
      'row',
    )[1];
    expect(row).toHaveTextContent('GRN-HQ-0001');
    expect(row).toHaveTextContent('PO-HQ-0001');
    expect(row).toHaveTextContent('Bharat Batteries');
    expect(row).toHaveTextContent('2026-10-08');
    expect(row).toHaveTextContent('Asha Rao');
  });

  it('explains an empty list and an error', async () => {
    await open('Receipts', { 'GET /api/goods-receipts?*': () => jsonResponse(pageOf([])) });
    expect(await screen.findByText('No goods have been received yet.')).toBeInTheDocument();
  });

  it('shows an error and recovers on Retry', async () => {
    let fail = true;
    await open('Receipts', {
      'GET /api/goods-receipts?*': () => (fail ? failure() : jsonResponse(pageOf([summary()]))),
    });
    expect(await screen.findByText('Could not load the goods receipts.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('GRN-HQ-0001')).toBeInTheDocument();
  });

  it('opens a receipt to show each line with what arrived, what was accepted and what went wrong', async () => {
    const receipt = makeReceipt({
      lines: [
        {
          id: 'gl-1',
          poLineId: LINE_ID,
          itemId: ITEM_ID,
          itemCode: 'BATT-48V',
          itemName: '48V battery',
          qtyReceived: 8,
          qtyAccepted: 6,
          discrepancies: [
            { id: 'd-1', type: 'DAMAGED', qty: 1, status: 'OPEN' },
            { id: 'd-2', type: 'SHORT', qty: 2, status: 'RESOLVED' },
          ],
        },
      ],
    });
    await open('Receipts', {
      'GET /api/goods-receipts?*': () => jsonResponse(pageOf([summary({ openDiscrepancies: 1 })])),
      'GET /api/goods-receipts/gr-1': () => jsonResponse(receipt),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open GRN-HQ-0001' }));
    const dialog = await screen.findByRole('dialog');
    const line = within(
      await within(dialog).findByRole('table', { name: 'Receipt lines' }),
    ).getAllByRole('row')[1];
    expect(line).toHaveTextContent('BATT-48V · 48V battery');
    expect(line).toHaveTextContent('damaged 1 (waiting), short 2 (settled)');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('says so when a receipt cannot be loaded', async () => {
    await open('Receipts', {
      'GET /api/goods-receipts?*': () => jsonResponse(pageOf([summary()])),
      'GET /api/goods-receipts/gr-1': () => failure(),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open GRN-HQ-0001' }));
    expect(await screen.findByText('Could not load the receipt.')).toBeInTheDocument();
  });
});

describe('discrepancies', () => {
  it('lists what waits for a decision, with its kind, item, quantity and document', async () => {
    const { calls } = await open('Discrepancies');
    const row = within(await screen.findByRole('table', { name: 'Discrepancies' })).getAllByRole(
      'row',
    )[1];
    expect(row).toHaveTextContent('short');
    expect(row).toHaveTextContent('BATT-48V · 48V battery');
    expect(row).toHaveTextContent('GRN-HQ-0001');
    expect(row).toHaveTextContent('Waiting for a decision');
    expect(
      calls.some(
        (call) =>
          call.key.startsWith('GET /api/discrepancies?') && call.key.includes('status=OPEN'),
      ),
    ).toBe(true);
  });

  it('shows how a settled one was settled, and filters by status and kind', async () => {
    const { calls } = await open('Discrepancies', {
      'GET /api/discrepancies?*': () =>
        jsonResponse(pageOf([makeDiscrepancy({ status: 'RESOLVED', resolution: 'WRITE_OFF' })])),
    });
    const row = within(await screen.findByRole('table', { name: 'Discrepancies' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('Settled: Write it off');
    expect(within(row).queryByRole('button', { name: /Resolve/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'all');
    await userEvent.selectOptions(screen.getByLabelText('Kind'), 'EXCESS');
    await waitFor(() => {
      const last =
        calls.filter((call) => call.key.startsWith('GET /api/discrepancies?')).at(-1)?.key ?? '';
      expect(last).toContain('status=all');
      expect(last).toContain('type=EXCESS');
    });
  });

  it('explains an empty queue', async () => {
    await open('Discrepancies', { 'GET /api/discrepancies?*': () => jsonResponse(pageOf([])) });
    expect(await screen.findByText('Nothing is waiting for a decision.')).toBeInTheDocument();
  });

  it('offers to settle one only to people who may resolve', async () => {
    await open('Discrepancies', {}, ['purchases.view', 'discrepancies.view']);
    await screen.findByRole('table', { name: 'Discrepancies' });
    expect(screen.queryByRole('button', { name: /Resolve/ })).not.toBeInTheDocument();
  });

  it('needs a choice, then settles it with the version that was read', async () => {
    const { calls } = await open('Discrepancies', {
      'GET /api/discrepancies?*': () =>
        jsonResponse(
          pageOf([
            makeDiscrepancy({
              allowedResolutions: ['ACCEPT', 'RETURN', 'WRITE_OFF'],
              type: 'EXCESS',
            }),
          ]),
        ),
      'POST /api/discrepancies/d-1/resolve': () =>
        jsonResponse(makeDiscrepancy({ status: 'RESOLVED', resolution: 'ACCEPT' })),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve excess BATT-48V' }));
    const dialog = await screen.findByRole('dialog', { name: 'Settle a excess problem' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Settle' }));
    expect(await within(dialog).findByText('Choose what to do')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Accept into stock'));
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Supplier agreed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Settle' }));
    expect(await screen.findByText('excess settled: Accept into stock')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/discrepancies/d-1/resolve')).toEqual({
      resolution: 'ACCEPT',
      rowVersion: 1,
      note: 'Supplier agreed',
    });
  });

  it('offers only the settlements that fit the kind of problem', async () => {
    await open('Discrepancies');
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve short BATT-48V' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Write it off')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Accept into stock')).not.toBeInTheDocument();
  });

  it('sends transfer problems to the transfer workflow', async () => {
    await open('Discrepancies', {
      'GET /api/discrepancies?*': () =>
        jsonResponse(pageOf([makeDiscrepancy({ allowedResolutions: [] })])),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve short BATT-48V' }));
    expect(
      await screen.findByText(
        'This kind of problem is settled in the transfer workflow, not here.',
      ),
    ).toBeInTheDocument();
  });

  it('shows why a settlement was refused', async () => {
    await open('Discrepancies', {
      'POST /api/discrepancies/d-1/resolve': () =>
        refusal('This problem was already settled', [], 409),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Resolve short BATT-48V' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText('Write it off'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Settle' }));
    expect(await within(dialog).findByText('This problem was already settled')).toBeInTheDocument();
  });
});

describe('returns to a supplier', () => {
  const PO_ID = 'cf6a7b8c-9d0e-4fb1-9bc2-3d4e5f607182';
  const received = makeOrder({
    id: PO_ID,
    status: 'PARTIALLY_RECEIVED',
    lines: [{ ...makeOrder().lines[0]!, accepted: 6, remaining: 4 }],
  });
  const openNew = async (extra: Record<string, RouteHandler> = {}) => {
    const state = await open('Returns', {
      'GET /api/purchase-orders?*': () => jsonResponse(pageOf([summaryOf(received)])),
      [`GET /api/purchase-orders/${PO_ID}`]: () => jsonResponse(received),
      ...extra,
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Return goods to a supplier' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Find the purchase order'), 'PO-HQ');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Matching orders'), PO_ID);
    return { ...state, dialog };
  };

  it('lists each return with its items, reason and credit', async () => {
    await open('Returns');
    const row = within(await screen.findByRole('table', { name: 'Purchase returns' })).getAllByRole(
      'row',
    )[1];
    expect(row).toHaveTextContent('PRN-HQ-0001');
    expect(row).toHaveTextContent('2 × BATT-48V');
    expect(row).toHaveTextContent('Faulty cells');
    expect(row).toHaveTextContent('240.00');
  });

  it('explains an empty list', async () => {
    await open('Returns', { 'GET /api/purchase-returns?*': () => jsonResponse(pageOf([])) });
    expect(
      await screen.findByText('No goods have been returned to a supplier.'),
    ).toBeInTheDocument();
  });

  it('offers a return only to people who may make one', async () => {
    await open('Returns', {}, ['purchases.view']);
    await screen.findByRole('table', { name: 'Purchase returns' });
    expect(
      screen.queryByRole('button', { name: 'Return goods to a supplier' }),
    ).not.toBeInTheDocument();
  });

  it('shows how many were accepted and asks for a reason', async () => {
    const { dialog, calls } = await openNew();
    expect(await within(dialog).findByText('6 accepted so far')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Quantity to return for BATT-48V'), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record return' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Reason')).toHaveAttribute('aria-invalid', 'true'),
    );
    expect(calls.some((call) => call.key === 'POST /api/purchase-returns')).toBe(false);
  });

  it('records the return and says what the supplier credits', async () => {
    const { dialog, calls } = await openNew({
      'POST /api/purchase-returns': () =>
        jsonResponse(makeReturn({ returnNo: 'PRN-HQ-0002' }), 201),
    });
    await userEvent.type(
      await within(dialog).findByLabelText('Quantity to return for BATT-48V'),
      '2',
    );
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Faulty cells');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record return' }));
    expect(
      await screen.findByText('Return PRN-HQ-0002 recorded. Credit from Bharat Batteries: 240.00'),
    ).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/purchase-returns')).toMatchObject({
      poId: PO_ID,
      reason: 'Faulty cells',
      lines: [{ poLineId: LINE_ID, qty: 2 }],
    });
  });

  it('shows the server’s refusal, such as returning more than was accepted', async () => {
    const { dialog } = await openNew({
      'POST /api/purchase-returns': () =>
        refusal('The return is more than was accepted', [
          { field: 'lines', message: 'Only 6 were accepted' },
        ]),
    });
    await userEvent.type(
      await within(dialog).findByLabelText('Quantity to return for BATT-48V'),
      '9',
    );
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Faulty cells');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record return' }));
    expect(
      await within(dialog).findByText('The return is more than was accepted'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Only 6 were accepted')).toBeInTheDocument();
  });

  it('finds no order when none has received goods', async () => {
    await open('Returns', {
      'GET /api/purchase-orders?*': () => jsonResponse(pageOf([])),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Return goods to a supplier' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Find the purchase order'), 'zzz');
    expect(
      await within(dialog).findByText('No order with received goods matches.'),
    ).toBeInTheDocument();
  });
});
