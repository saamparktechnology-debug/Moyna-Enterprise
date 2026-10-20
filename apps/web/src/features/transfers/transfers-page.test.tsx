import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { itemPage, makeItem } from '../items/test-data';
import {
  ALL,
  FROM_ID,
  ITEM_ID,
  TO_ID,
  VIEWER,
  makeLine,
  makeTransfer,
  pageOf,
  summaryOf,
  transferHandlers,
} from './test-data';

const open = (handlers: Record<string, RouteHandler> = transferHandlers()) => {
  const state = routeFetch(handlers);
  const view = renderApp('/transfers');
  return { ...state, ...view };
};
const listCalls = (calls: { key: string }[]) =>
  calls.filter((c) => c.key.startsWith('GET /api/transfers?'));
const failure = () =>
  jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500);

describe('the transfer list', () => {
  it('shows each transfer with its branches, status, size and open problems', async () => {
    open(
      transferHandlers(ALL, [
        makeTransfer(),
        makeTransfer({
          id: 'tr-2',
          transferNo: 'TRF-HQ-0002',
          status: 'DISPATCHED',
          lines: [
            makeLine({
              qtySent: 5,
              discrepancies: [{ id: 'd-1', type: 'SHORT', qty: 2, status: 'OPEN' }],
            }),
          ],
        }),
      ]),
    );
    const table = await screen.findByRole('table', { name: 'Transfers' });
    const [first, second] = within(table).getAllByRole('row').slice(1) as HTMLElement[];
    expect(first).toHaveTextContent('TRF-HQ-0001');
    expect(first).toHaveTextContent('EAB');
    expect(first).toHaveTextContent('HQ');
    expect(first).toHaveTextContent('Requested');
    expect(first).toHaveTextContent('Asha Rao');
    expect(second).toHaveTextContent('On its way');
    expect(second).toHaveTextContent('1');
  });

  it('shows loading, empty and error states, and recovers on Retry', async () => {
    open({
      ...transferHandlers(),
      'GET /api/transfers?*': () => new Promise<Response>(() => undefined),
    });
    expect(await screen.findByText('Loading transfers…')).toBeInTheDocument();

    open({ ...transferHandlers(), 'GET /api/transfers?*': () => jsonResponse(pageOf([])) });
    expect(await screen.findByText('There are no transfers yet.')).toBeInTheDocument();

    let fail = true;
    open({
      ...transferHandlers(),
      'GET /api/transfers?*': () =>
        fail ? failure() : jsonResponse(pageOf([summaryOf(makeTransfer())])),
    });
    expect(await screen.findByText('Could not load the transfers.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('TRF-HQ-0001')).toBeInTheDocument();
  });

  it('asks the server for the search, status and direction the user chose, and for the next page', async () => {
    const { calls } = open({
      ...transferHandlers(),
      'GET /api/transfers?*': () =>
        jsonResponse(pageOf([summaryOf(makeTransfer())], { total: 25, totalPages: 3 })),
    });
    await screen.findByText('TRF-HQ-0001');
    await userEvent.type(screen.getByLabelText('Search'), '0001');
    await waitFor(() =>
      expect(listCalls(calls).some((c) => c.key.includes('search=0001'))).toBe(true),
    );
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'DISPATCHED');
    await userEvent.selectOptions(screen.getByLabelText('Direction'), 'incoming');
    await waitFor(() => {
      const last = listCalls(calls).at(-1)?.key ?? '';
      expect(last).toContain('status=DISPATCHED');
      expect(last).toContain('direction=incoming');
    });
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('page=2'));
  });

  it('offers a request only to people who may make one', async () => {
    open(transferHandlers(ALL));
    await screen.findByText('TRF-HQ-0001');
    expect(screen.getByRole('button', { name: 'Ask for stock' })).toBeInTheDocument();
  });

  it('offers no request to people who may only view', async () => {
    open(transferHandlers(VIEWER));
    await screen.findByText('TRF-HQ-0001');
    expect(screen.queryByRole('button', { name: 'Ask for stock' })).not.toBeInTheDocument();
  });

  it('keeps people without transfers.view away', async () => {
    open(transferHandlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });
});

describe('asking another branch for stock', () => {
  const openForm = async (extra: Record<string, RouteHandler> = {}) => {
    const state = open({
      ...transferHandlers(ALL),
      'GET /api/items?*': () =>
        jsonResponse(
          itemPage([makeItem({ id: ITEM_ID, itemCode: 'BATT-48V', name: '48V battery' })]),
        ),
      ...extra,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for stock' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'EAB · East Branch' });
    return { ...state, dialog };
  };
  const fill = async (dialog: HTMLElement) => {
    await userEvent.selectOptions(within(dialog).getByLabelText('Take stock from'), FROM_ID);
    await userEvent.type(within(dialog).getByLabelText('Item'), 'BATT');
    await userEvent.selectOptions(
      await within(dialog).findByLabelText('Matching items for Item'),
      ITEM_ID,
    );
    await userEvent.type(within(dialog).getByLabelText('Quantity'), '10');
  };

  it('starts with the person’s own branch chosen and never offers it as the source', async () => {
    const { dialog } = await openForm();
    expect(within(dialog).getByLabelText('Receiving branch')).toHaveValue(TO_ID);
    const from = within(dialog).getByLabelText('Take stock from');
    expect(
      within(from).queryByRole('option', { name: 'HQ · Head Office' }),
    ).not.toBeInTheDocument();
    expect(within(from).getByRole('option', { name: 'EAB · East Branch' })).toBeInTheDocument();
  });

  it('names what is missing and sends nothing', async () => {
    const { dialog, calls } = await openForm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Take stock from')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    expect(within(dialog).getByLabelText('Item ')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByLabelText('Quantity')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((c) => c.key === 'POST /api/transfers')).toBe(false);
  });

  it('lets lines be added and removed', async () => {
    const { dialog } = await openForm();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add a line' }));
    expect(within(dialog).getByLabelText('Line 2')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove line 2' }));
    expect(within(dialog).queryByLabelText('Line 2')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: /Remove line/ })).not.toBeInTheDocument();
  });

  it('sends the request and says which branch was asked', async () => {
    const { dialog, calls } = await openForm({
      'POST /api/transfers': () => jsonResponse(makeTransfer({ transferNo: 'TRF-HQ-0007' }), 201),
    });
    await fill(dialog);
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Urgent for a customer');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(await screen.findByText('Transfer TRF-HQ-0007 requested from EAB')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/transfers')?.body).toEqual({
      fromBranchId: FROM_ID,
      toBranchId: TO_ID,
      note: 'Urgent for a customer',
      lines: [{ itemId: ITEM_ID, qty: 10 }],
    });
  });

  it('shows every reason the server gave for refusing', async () => {
    const { dialog } = await openForm({
      'POST /api/transfers': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'The branches are not valid',
            details: [{ field: 'fromBranchId', message: 'Choose an active branch' }],
            requestId: 'r',
          },
          400,
        ),
    });
    await fill(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(await within(dialog).findByText('The branches are not valid')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Choose an active branch').length).toBeGreaterThan(0);
  });
});
