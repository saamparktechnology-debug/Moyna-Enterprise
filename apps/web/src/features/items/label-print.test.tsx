//apps/web/src/features/items/label-print.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { VIEWER, itemHandlers, makeItem } from './test-data';

const labelsFor = (copies: number) => ({
  labels: Array.from({ length: copies }, () => ({
    itemId: 'i-1',
    itemCode: 'TOTO-X1',
    name: 'TOTO X1 e-rickshaw',
    barcode: '2000000000015',
  })),
});
const labelRoute = (copies = 1): Record<string, RouteHandler> => ({
  'POST /api/items/labels': () => jsonResponse(labelsFor(copies)),
});
const labelCalls = (calls: { key: string; body: unknown }[]) =>
  calls.filter((call) => call.key === 'POST /api/items/labels');

describe('printing a barcode label', () => {
  let print: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    print = vi.fn();
    vi.spyOn(window, 'print').mockImplementation(print as () => void);
  });
  afterEach(() => vi.restoreAllMocks());

  it('prints one item’s label straight from its row: prepared on opening, printed with one click', async () => {
    const { calls } = routeFetch({ ...itemHandlers(), ...labelRoute() });
    renderApp('/items');
    await userEvent.click(await screen.findByRole('button', { name: 'Print label for TOTO-X1' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByLabelText('Label preview')).toBeInTheDocument();
    expect(labelCalls(calls)).toHaveLength(1);
    expect(labelCalls(calls)[0]?.body).toEqual({ items: [{ itemId: 'i-1', copies: 1 }] });
    expect(print).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print' }));
    expect(print).toHaveBeenCalledTimes(1);
    expect(labelCalls(calls)).toHaveLength(1);
  });

  it('prepares and prints in one click when the labels were not prepared yet', async () => {
    const { calls } = routeFetch({ ...itemHandlers(), ...labelRoute(3) });
    renderApp('/items');
    await screen.findByText('TOTO-X1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select TOTO-X1 for labels' }));
    await userEvent.click(screen.getByRole('button', { name: 'Print labels (1)' }));
    const dialog = await screen.findByRole('dialog');
    const copies = within(dialog).getByLabelText('Copies of TOTO-X1');
    await userEvent.clear(copies);
    await userEvent.type(copies, '3');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(labelCalls(calls)).toHaveLength(1);
    expect(labelCalls(calls)[0]?.body).toEqual({ items: [{ itemId: 'i-1', copies: 3 }] });
  });

  it('forgets labels that were prepared for another number of copies, so the wrong run is never printed', async () => {
    const { calls } = routeFetch({ ...itemHandlers(), ...labelRoute(2) });
    renderApp('/items');
    await userEvent.click(await screen.findByRole('button', { name: 'Print label for TOTO-X1' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByLabelText('Label preview');
    const copies = within(dialog).getByLabelText('Copies of TOTO-X1');
    await userEvent.clear(copies);
    await userEvent.type(copies, '5');
    await waitFor(() =>
      expect(within(dialog).queryByLabelText('Label preview')).not.toBeInTheDocument(),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(print).toHaveBeenCalledTimes(1));
    expect(labelCalls(calls).at(-1)?.body).toEqual({ items: [{ itemId: 'i-1', copies: 5 }] });
  });

  it('does not print, and says why, when the labels cannot be prepared', async () => {
    routeFetch({
      ...itemHandlers(),
      'POST /api/items/labels': () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'Some items have no barcode yet',
            details: [],
            requestId: 'r',
          },
          422,
        ),
    });
    renderApp('/items');
    await screen.findByText('TOTO-X1');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select TOTO-X1 for labels' }));
    await userEvent.click(screen.getByRole('button', { name: 'Print labels (1)' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Print' }));
    expect(await within(dialog).findByText('Some items have no barcode yet')).toBeInTheDocument();
    expect(print).not.toHaveBeenCalled();
  });

  it('offers the row action to read-only staff too, and not for an item with no barcode', async () => {
    routeFetch(
      itemHandlers(VIEWER, [makeItem(), makeItem({ id: 'i-2', itemCode: 'BARE-1', barcodes: [] })]),
    );
    renderApp('/items');
    expect(
      await screen.findByRole('button', { name: 'Print label for TOTO-X1' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Print label for BARE-1' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit TOTO-X1' })).not.toBeInTheDocument();
  });
});
