import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { itemPage, makeItem } from '../items/test-data';
import {
  ALL,
  LINE_ID,
  SERIAL_ITEM_ID,
  SERIAL_LINE_ID,
  makeOrder,
  makeReceipt,
  purchasingHandlers,
} from './test-data';

const serialLine = {
  id: SERIAL_LINE_ID,
  itemId: SERIAL_ITEM_ID,
  itemCode: 'BATT-SN',
  itemName: 'Serial battery',
  unitCode: 'PCS',
  isSerialized: true,
  qtyOrdered: 3,
  unitCost: '500.00',
  lineTotal: '1500.00',
  accepted: 0,
  closed: 0,
  remaining: 3,
};
const approved = makeOrder({ status: 'APPROVED', lines: [makeOrder().lines[0]!, serialLine] });

const openReceive = async (
  extra: Record<string, RouteHandler> = {},
  order = approved,
  permissions: string[] = ALL,
) => {
  const state = routeFetch({
    ...purchasingHandlers(permissions, [order]),
    'GET /api/items?*': () =>
      jsonResponse(
        itemPage([
          makeItem({
            id: SERIAL_ITEM_ID,
            itemCode: 'WRONG-1',
            name: 'Wrong part',
            isSerialized: false,
          }),
        ]),
      ),
    ...extra,
  });
  renderApp('/purchasing');
  await userEvent.click(await screen.findByRole('button', { name: `Open ${order.poNo}` }));
  await userEvent.click(await screen.findByRole('button', { name: 'Receive goods' }));
  const dialog = await screen.findByRole('dialog', { name: /Receive goods for/ });
  return { ...state, dialog };
};
const bodyOf = (calls: { key: string; body: unknown }[]) =>
  calls.find((call) => call.key === `POST /api/purchase-orders/po-1/receive`)?.body as Record<
    string,
    unknown
  >;
const refusal = (message: string, details: { field: string; message: string }[] = []) =>
  jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, 422);
const setDate = (dialog: HTMLElement, label: string, value: string) =>
  fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });

describe('receiving goods', () => {
  it('lists each line that still has goods to come, and only those', async () => {
    const { dialog } = await openReceive(
      {},
      makeOrder({
        status: 'PARTIALLY_RECEIVED',
        lines: [
          { ...makeOrder().lines[0]!, accepted: 10, remaining: 0 },
          { ...serialLine, remaining: 2, accepted: 1 },
        ],
      }),
    );
    expect(
      within(dialog).getByText('BATT-SN · Serial battery: 2 still to come'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Receive BATT-48V')).not.toBeInTheDocument();
  });

  it('asks for something to be entered and sends nothing when the form is empty', async () => {
    const { dialog, calls } = await openReceive();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    expect(await within(dialog).findByText('Enter what arrived')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('POST /api/purchase-orders'))).toBe(false);
  });

  it('refuses more damaged units than arrived', async () => {
    const { dialog } = await openReceive();
    await userEvent.type(within(dialog).getByLabelText('Arrived for BATT-48V'), '3');
    await userEvent.type(within(dialog).getByLabelText('Damaged for BATT-48V'), '4');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    expect(await within(dialog).findByText('More damaged than arrived')).toBeInTheDocument();
  });

  it('records a count with damaged units and the delivery note, and says a decision is needed', async () => {
    const receipt = makeReceipt({
      grnNo: 'GRN-HQ-0002',
      lines: [
        {
          id: 'gl-9',
          poLineId: LINE_ID,
          itemId: makeOrder().lines[0]!.itemId,
          itemCode: 'BATT-48V',
          itemName: '48V battery',
          qtyReceived: 8,
          qtyAccepted: 7,
          discrepancies: [
            { id: 'd-1', type: 'DAMAGED', qty: 1, status: 'OPEN' },
            { id: 'd-2', type: 'SHORT', qty: 2, status: 'OPEN' },
          ],
        },
      ],
    });
    const { dialog, calls } = await openReceive({
      'POST /api/purchase-orders/po-1/receive': () => jsonResponse(receipt, 201),
    });
    await userEvent.type(within(dialog).getByLabelText('Arrived for BATT-48V'), '8');
    await userEvent.type(within(dialog).getByLabelText('Damaged for BATT-48V'), '1');
    await userEvent.type(
      within(dialog).getByLabelText('Delivery note quantity for BATT-48V'),
      '10',
    );
    await userEvent.type(within(dialog).getByLabelText('Delivery note number'), 'DN-77');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    expect(
      await screen.findByText(
        'Goods receipt GRN-HQ-0002 recorded. 2 discrepancies need a decision.',
      ),
    ).toBeInTheDocument();
    expect(bodyOf(calls)).toEqual({
      lines: [{ poLineId: LINE_ID, received: 8, damaged: 1, deliveryNoteQty: 10 }],
      wrongItems: [],
      deliveryNoteNo: 'DN-77',
    });
  });

  it('says nothing about decisions when everything arrived in good order', async () => {
    const { dialog } = await openReceive({
      'POST /api/purchase-orders/po-1/receive': () =>
        jsonResponse(makeReceipt({ grnNo: 'GRN-HQ-0003' }), 201),
    });
    await userEvent.type(within(dialog).getByLabelText('Arrived for BATT-48V'), '10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    expect(await screen.findByText('Goods receipt GRN-HQ-0003 recorded.')).toBeInTheDocument();
  });

  it('counts serial items by serial number, with damaged ones marked and battery dates added', async () => {
    const { dialog, calls } = await openReceive({
      'POST /api/purchase-orders/po-1/receive': () =>
        jsonResponse(makeReceipt({ grnNo: 'GRN-HQ-0004' }), 201),
    });
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers for BATT-SN'),
      'sn-001{enter}sn-002, sn-003',
    );
    await userEvent.type(
      within(dialog).getByLabelText('Damaged serial numbers for BATT-SN'),
      'sn-002',
    );
    setDate(dialog, 'Manufactured on for BATT-SN', '2026-09-01');
    setDate(dialog, 'Expires on for BATT-SN', '2027-09-01');
    await userEvent.type(within(dialog).getByLabelText('Warranty months for BATT-SN'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    await screen.findByText('Goods receipt GRN-HQ-0004 recorded.');
    const dates = { manufacturedOn: '2026-09-01', expiryOn: '2027-09-01', warrantyMonths: 12 };
    expect(bodyOf(calls)).toMatchObject({
      lines: [
        {
          poLineId: SERIAL_LINE_ID,
          serials: [
            { serialNo: 'SN-001', damaged: false, ...dates },
            { serialNo: 'SN-002', damaged: true, ...dates },
            { serialNo: 'SN-003', damaged: false, ...dates },
          ],
        },
      ],
    });
  });

  it('refuses a damaged serial number that was not in the list that arrived', async () => {
    const { dialog } = await openReceive();
    await userEvent.type(within(dialog).getByLabelText('Serial numbers for BATT-SN'), 'sn-001');
    await userEvent.type(
      within(dialog).getByLabelText('Damaged serial numbers for BATT-SN'),
      'sn-999',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    expect(
      await within(dialog).findByText('SN-999 is not in the list of serial numbers that arrived'),
    ).toBeInTheDocument();
  });

  it('refuses the same serial number twice', async () => {
    const { dialog } = await openReceive();
    await userEvent.type(
      within(dialog).getByLabelText('Serial numbers for BATT-SN'),
      'sn-001{enter}sn-001',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    expect(await within(dialog).findByText('A serial number appears twice')).toBeInTheDocument();
  });

  it('records something else that arrived, with the item and the quantity', async () => {
    const { dialog, calls } = await openReceive({
      'POST /api/purchase-orders/po-1/receive': () =>
        jsonResponse(makeReceipt({ grnNo: 'GRN-HQ-0005' }), 201),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Something else arrived' }));
    await userEvent.type(
      within(dialog).getByLabelText('Item that arrived for wrong item 1'),
      'WRONG',
    );
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching items for Item that arrived for wrong item 1'),
      SERIAL_ITEM_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Quantity of wrong item 1'), '2');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    await screen.findByText('Goods receipt GRN-HQ-0005 recorded.');
    expect(bodyOf(calls)).toMatchObject({
      lines: [],
      wrongItems: [{ itemId: SERIAL_ITEM_ID, qty: 2 }],
    });
  });

  it('lets a wrong item be taken off again', async () => {
    const { dialog } = await openReceive();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Something else arrived' }));
    expect(within(dialog).getByLabelText('Wrong item 1')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove wrong item 1' }));
    expect(within(dialog).queryByLabelText('Wrong item 1')).not.toBeInTheDocument();
  });

  it('shows every reason the server gave and keeps the dialog open', async () => {
    const { dialog } = await openReceive({
      'POST /api/purchase-orders/po-1/receive': () =>
        refusal('The goods cannot be received', [
          { field: 'lines', message: 'Serial number SN-001 already exists' },
        ]),
    });
    await userEvent.type(within(dialog).getByLabelText('Arrived for BATT-48V'), '5');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record goods receipt' }));
    expect(await within(dialog).findByText('The goods cannot be received')).toBeInTheDocument();
    expect(within(dialog).getByText('Serial number SN-001 already exists')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});
