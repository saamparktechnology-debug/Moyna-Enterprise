import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { BRANCH_ID } from '../billing/test-data';

const source = (over: Record<string, unknown> = {}) => ({
  code: 'WALK_IN',
  name: 'Walk-in',
  isActive: true,
  leadCount: 4,
  rowVersion: 2,
  ...over,
});
const handlers = (permissions: string[], extra: Record<string, RouteHandler> = {}) => ({
  ...signedIn(
    makeSession({ permissions, branches: [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }] }),
  ),
  'GET /api/lead-sources': () =>
    jsonResponse([
      source(),
      source({ code: 'PHONE', name: 'Phone enquiry', isActive: false, leadCount: 0 }),
    ]),
  'GET /api/leads?*': () =>
    jsonResponse({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 }),
  'GET /api/reference/lead-sources': () => jsonResponse([{ code: 'WALK_IN', name: 'Walk-in' }]),
  ...extra,
});
const open = async (h: Record<string, RouteHandler>) => {
  const state = routeFetch(h);
  renderApp('/leads');
  await userEvent.click(await screen.findByRole('tab', { name: 'Lead sources' }));
  return state;
};

describe('lead sources', () => {
  it('shows the tab only to people who may manage sources', async () => {
    routeFetch(handlers(['leads.view', 'leads.manage']));
    renderApp('/leads');
    await screen.findByRole('tab', { name: 'Leads' });
    expect(screen.queryByRole('tab', { name: 'Lead sources' })).not.toBeInTheDocument();
  });

  it('lists sources with their lead count and whether they are on', async () => {
    await open(handlers(['leads.view', 'leads.manage_sources']));
    const rows = within(await screen.findByRole('table', { name: 'Lead sources' })).getAllByRole(
      'row',
    );
    expect(rows[1]).toHaveTextContent('Walk-in');
    expect(rows[1]).toHaveTextContent('4');
    expect(rows[1]).toHaveTextContent('On');
    expect(rows[2]).toHaveTextContent('Off');
  });

  it('switches a source off with the version that was read', async () => {
    const { calls } = await open(
      handlers(['leads.view', 'leads.manage_sources'], {
        'PATCH /api/lead-sources/WALK_IN': () => jsonResponse(source({ isActive: false })),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Switch off Walk-in' }));
    expect(await screen.findByText('Walk-in switched off')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'PATCH /api/lead-sources/WALK_IN')?.body).toEqual({
      isActive: false,
      rowVersion: 2,
    });
  });

  it('adds a source, names what is wrong first, and shows what the server refused', async () => {
    const { calls } = await open(
      handlers(['leads.view', 'leads.manage_sources'], {
        'POST /api/lead-sources': () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'That code is already used',
              details: [{ field: 'code', message: 'Choose a code no other source has' }],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Add source' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add source' }));
    expect(await within(dialog).findByText(/capital letters/)).toBeInTheDocument();
    expect(calls.filter((c) => c.key === 'POST /api/lead-sources')).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Code'), 'walk_in');
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Walk-in again');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add source' }));
    expect(await within(dialog).findByText('That code is already used')).toBeInTheDocument();
    expect(calls.find((c) => c.key === 'POST /api/lead-sources')?.body).toEqual({
      code: 'WALK_IN',
      name: 'Walk-in again',
    });
  });
});
