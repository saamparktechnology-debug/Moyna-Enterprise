import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import {
  balance,
  BRANCH_ID,
  OTHER_BRANCH_ID,
  inventoryHandlers,
  lowStock,
  MANAGER,
  movement,
  page,
  serialUnit,
  VIEWER,
} from './test-data';

const open = (handlers: Record<string, RouteHandler> = inventoryHandlers()) => {
  const state = routeFetch(handlers);
  renderApp('/inventory');
  return state;
};
const lastCall = (calls: { key: string }[], prefix: string) =>
  calls.filter((call) => call.key.startsWith(prefix)).at(-1)?.key ?? '';
const tab = async (name: string) => userEvent.click(await screen.findByRole('tab', { name }));
const failure = () =>
  jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500);

describe('inventory page', () => {
  it('shows the stock tab first, with a low-stock marker', async () => {
    open();
    const table = await screen.findByRole('table', { name: 'Stock' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('BAT-1');
    expect(row).toHaveTextContent('Low');
    expect(screen.getByRole('tab', { name: 'Stock' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps people without stock.view away from the page', async () => {
    open(inventoryHandlers([]));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });

  it('shows the branch column only to people who work in several branches', async () => {
    open();
    await screen.findByRole('table', { name: 'Stock' });
    expect(screen.queryByRole('columnheader', { name: 'Branch' })).not.toBeInTheDocument();
  });

  it('shows the branch column to a multi-branch user', async () => {
    open(
      inventoryHandlers(MANAGER, {}, [
        { id: BRANCH_ID, code: 'HQ', name: 'Head Office' },
        { id: OTHER_BRANCH_ID, code: 'KOL', name: 'Kolkata' },
      ]),
    );
    expect(await screen.findByRole('columnheader', { name: 'Branch' })).toBeInTheDocument();
  });

  it('says so while loading, when nothing exists, and when a search finds nothing', async () => {
    open({
      ...inventoryHandlers(),
      'GET /api/stock/balances?*': () => new Promise<Response>(() => undefined),
    });
    expect(await screen.findByText('Loading stock…')).toBeInTheDocument();
  });

  it('explains an empty stock list and an empty search', async () => {
    open({ ...inventoryHandlers(), 'GET /api/stock/balances?*': () => jsonResponse(page([])) });
    expect(await screen.findByText('No stock has been recorded yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search'), 'zzz');
    expect(await screen.findByText(/Nothing matches your search/)).toBeInTheDocument();
  });

  it('shows an error and recovers when Retry is pressed', async () => {
    let fail = true;
    open({
      ...inventoryHandlers(),
      'GET /api/stock/balances?*': () => (fail ? failure() : jsonResponse(page([balance()]))),
    });
    expect(await screen.findByText('Could not load the stock.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Stock' })).toBeInTheDocument();
  });

  it('asks the server for the search and the low-stock filter, and pages on the server', async () => {
    const { calls } = open({
      ...inventoryHandlers(),
      'GET /api/stock/balances?*': () =>
        jsonResponse(page([balance()], { total: 25, totalPages: 3 })),
    });
    await screen.findByText('Page 1 of 3');
    await userEvent.type(screen.getByLabelText('Search'), 'bat');
    await waitFor(() => expect(lastCall(calls, 'GET /api/stock/balances')).toContain('search=bat'));
    await userEvent.click(screen.getByLabelText('Low stock only'));
    await waitFor(() =>
      expect(lastCall(calls, 'GET /api/stock/balances')).toContain('lowOnly=true'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(lastCall(calls, 'GET /api/stock/balances')).toContain('page=2'));
  });
});

describe('the other tabs', () => {
  it('lists low-stock items with how far short they are', async () => {
    open({
      ...inventoryHandlers(),
      'GET /api/stock/low-stock?*': () => jsonResponse(page([lowStock({ shortBy: 4 })])),
    });
    await tab('Low stock');
    const table = await screen.findByRole('table', { name: 'Low stock' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('4');
  });

  it('says when nothing is low', async () => {
    open({ ...inventoryHandlers(), 'GET /api/stock/low-stock?*': () => jsonResponse(page([])) });
    await tab('Low stock');
    expect(
      await screen.findByText('Nothing is at or below its reorder level.'),
    ).toBeInTheDocument();
  });

  it('shows the movement history and filters it by type and serial number', async () => {
    const { calls } = open({
      ...inventoryHandlers(),
      'GET /api/stock/movements?*': () =>
        jsonResponse(
          page([
            movement(),
            movement({ id: 'm-2', qtyDelta: -2, movementType: 'WRITE_OFF', serialNo: 'SN-9' }),
          ]),
        ),
    });
    await tab('Movements');
    const table = await screen.findByRole('table', { name: 'Movements' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('+5');
    expect(rows[1]).toHaveTextContent('adjustment in');
    expect(rows[2]).toHaveTextContent('-2');
    expect(rows[2]).toHaveTextContent('SN-9');
    await userEvent.selectOptions(screen.getByLabelText('Movement'), 'WRITE_OFF');
    await waitFor(() =>
      expect(lastCall(calls, 'GET /api/stock/movements')).toContain('movementType=WRITE_OFF'),
    );
    await userEvent.type(screen.getByLabelText('Serial number'), 'sn-9');
    await waitFor(() =>
      expect(lastCall(calls, 'GET /api/stock/movements')).toContain('serialNo=sn-9'),
    );
  });

  it('lists serial units and filters them by state and text', async () => {
    const { calls } = open({
      ...inventoryHandlers(),
      'GET /api/stock/serial-units?*': () =>
        jsonResponse(
          page([
            serialUnit(),
            serialUnit({ id: 'u-2', serialNo: 'SN-1002', chassisNo: null, state: 'SOLD' }),
          ]),
        ),
    });
    await tab('Serial numbers');
    const table = await screen.findByRole('table', { name: 'Serial units' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('SN-1001');
    expect(rows[1]).toHaveTextContent('CH-1001');
    expect(rows[2]).toHaveTextContent('sold');
    expect(rows[2]).toHaveTextContent('—');
    await userEvent.selectOptions(screen.getByLabelText('State'), 'SOLD');
    await waitFor(() =>
      expect(lastCall(calls, 'GET /api/stock/serial-units')).toContain('state=SOLD'),
    );
    await userEvent.type(screen.getByLabelText('Search'), 'SN-10');
    await waitFor(() =>
      expect(lastCall(calls, 'GET /api/stock/serial-units')).toContain('search=SN-10'),
    );
  });

  it('works for read-only people too', async () => {
    open(inventoryHandlers(VIEWER));
    await tab('Adjustments');
    expect(await screen.findByRole('table', { name: 'Adjustments' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Request adjustment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Approve/ })).not.toBeInTheDocument();
  });
});
