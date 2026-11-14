//apps/web/src/features/items/hsn-codes.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ManagedHsn } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { pageOf } from '../billing/test-data';
import { VIEWER, itemHandlers } from './test-data';

const managed = (over: Partial<ManagedHsn> = {}): ManagedHsn => ({
  code: '8703',
  description: 'Motor vehicles for the transport of persons',
  gstRate: '5.00',
  isActive: true,
  usedBy: 3,
  rowVersion: 1,
  ...over,
});
const hsnHandlers = (
  items: ManagedHsn[] = [
    managed(),
    managed({ code: '8507', description: 'Batteries', gstRate: '18.00', usedBy: 0 }),
  ],
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...itemHandlers(),
  'GET /api/hsn-codes?*': () => jsonResponse(pageOf(items)),
  ...extra,
});
const openList = async (h: Record<string, RouteHandler> = hsnHandlers()) => {
  const state = routeFetch(h);
  renderApp('/items');
  await userEvent.click(await screen.findByRole('button', { name: 'HSN codes' }));
  const dialog = await screen.findByRole('dialog', { name: 'HSN codes' });
  return { ...state, dialog };
};
const lastList = (calls: { key: string }[]): string =>
  calls.filter((call) => call.key.startsWith('GET /api/hsn-codes?')).at(-1)?.key ?? '';

describe('managing the HSN list', () => {
  it('lists the codes with their description, rate, how many items use them and whether they are on', async () => {
    const { dialog } = await openList();
    const table = await within(dialog).findByRole('table', { name: 'HSN codes' });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('8703');
    expect(rows[1]).toHaveTextContent('Motor vehicles');
    expect(rows[1]).toHaveTextContent('5.00');
    expect(rows[2]).toHaveTextContent('Batteries');
  });

  it('is only on the Items page for those who may manage items', async () => {
    routeFetch({ ...hsnHandlers(), ...itemHandlers(VIEWER) });
    renderApp('/items');
    await screen.findByRole('button', { name: /Print labels/ });
    expect(screen.queryByRole('button', { name: 'HSN codes' })).not.toBeInTheDocument();
  });

  it('asks the server for what was searched and the status chosen', async () => {
    const { dialog, calls } = await openList();
    await userEvent.type(within(dialog).getByLabelText('Search HSN codes'), 'batt');
    await waitFor(() => expect(lastList(calls)).toContain('search=batt'));
    await userEvent.selectOptions(within(dialog).getByLabelText('Show'), 'inactive');
    await waitFor(() => expect(lastList(calls)).toContain('status=inactive'));
  });

  it('adds a code, and names what is missing first', async () => {
    const { dialog, calls } = await openList(
      hsnHandlers(undefined, {
        'POST /api/hsn-codes': () => jsonResponse(managed({ code: '87116010' }), 201),
        'GET /api/reference/gst-rates': () =>
          jsonResponse([
            { rate: '5.00', label: '5%' },
            { rate: '18.00', label: '18%' },
          ]),
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add an HSN code' }));
    const form = await screen.findByRole('dialog', { name: 'Add an HSN code' });
    await userEvent.click(within(form).getByRole('button', { name: 'Save HSN code' }));
    expect(
      await within(form).findAllByText(/./, { selector: '[role="alert"], p' }),
    ).not.toHaveLength(0);
    expect(calls.some((call) => call.key === 'POST /api/hsn-codes')).toBe(false);
    await userEvent.type(within(form).getByLabelText('HSN code'), '87116010');
    await userEvent.type(
      within(form).getByLabelText('Description'),
      'Electric two and three wheelers',
    );
    await userEvent.selectOptions(await within(form).findByLabelText('GST rate'), '5.00');
    await userEvent.click(within(form).getByRole('button', { name: 'Save HSN code' }));
    expect(await screen.findByText('HSN code 87116010 added')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/hsn-codes')?.body).toEqual({
      code: '87116010',
      description: 'Electric two and three wheelers',
      gstRate: '5.00',
    });
  });

  it('changes a description with the version that was read, and cannot change the code', async () => {
    const { dialog, calls } = await openList(
      hsnHandlers(undefined, {
        'PATCH /api/hsn-codes/8703': () => jsonResponse(managed({ description: 'New words' })),
      }),
    );
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Change HSN code 8703' }),
    );
    const form = await screen.findByRole('dialog', { name: 'Change HSN code 8703' });
    expect(within(form).queryByLabelText('HSN code')).not.toBeInTheDocument();
    const description = within(form).getByLabelText('Description');
    await userEvent.clear(description);
    await userEvent.type(description, 'New words');
    await userEvent.click(within(form).getByRole('button', { name: 'Save HSN code' }));
    expect(await screen.findByText('HSN code 8703 saved')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/hsn-codes/8703')?.body).toMatchObject({
      description: 'New words',
      rowVersion: 1,
    });
  });

  it('switches a code off', async () => {
    const { dialog, calls } = await openList(
      hsnHandlers(undefined, {
        'PATCH /api/hsn-codes/8703': () => jsonResponse(managed({ isActive: false })),
      }),
    );
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Switch off HSN code 8703' }),
    );
    expect(await screen.findByText('HSN code 8703 switched off')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/hsn-codes/8703')?.body).toEqual({
      isActive: false,
      rowVersion: 1,
    });
  });

  it('shows what the server refused, such as a code that is already there', async () => {
    const { dialog } = await openList(
      hsnHandlers(undefined, {
        'POST /api/hsn-codes': () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'This HSN code is already in the list',
              details: [{ field: 'code', message: 'It is already in the list' }],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add an HSN code' }));
    const form = await screen.findByRole('dialog', { name: 'Add an HSN code' });
    await userEvent.type(within(form).getByLabelText('HSN code'), '8703');
    await userEvent.type(within(form).getByLabelText('Description'), 'Vehicles');
    await userEvent.click(within(form).getByRole('button', { name: 'Save HSN code' }));
    expect((await within(form).findAllByText('It is already in the list')).length).toBeGreaterThan(
      0,
    );
  });
});
