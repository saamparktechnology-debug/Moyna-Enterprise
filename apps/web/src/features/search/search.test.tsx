import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { SearchResponse } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

const ID = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;

const response = (over: Partial<SearchResponse> = {}): SearchResponse => ({
  query: 'ravi',
  searched: ['ITEM', 'SERIAL', 'INVOICE', 'CUSTOMER'],
  results: [
    {
      type: 'SERIAL',
      id: ID(1),
      title: 'SN-A-1',
      subtitle: 'TOTO-1 · available · AA',
      link: '/inventory',
      matchedOn: 'SERIAL',
      exact: true,
      branchCode: 'AA',
    },
    {
      type: 'CUSTOMER',
      id: ID(2),
      title: 'Ravi Kumar',
      subtitle: '9000000001',
      link: '/customers',
      matchedOn: 'NAME',
      exact: false,
      branchCode: null,
    },
  ],
  ...over,
});

const PERMS = ['customers.view', 'stock.view'];

describe('global search box', () => {
  it('waits for two characters, then shows results grouped by kind with exact matches marked', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...signedIn(makeSession({ permissions: PERMS })),
      'GET /api/search?*': () => jsonResponse(response()),
    });
    renderApp('/');
    const box = await screen.findByRole('textbox', { name: 'Find anything' });

    await user.type(box, 'r');
    expect(await screen.findByText('Type at least 2 characters')).toBeInTheDocument();
    expect(calls.calls.some((c) => c.key.includes('/search'))).toBe(false);

    await user.type(box, 'avi');
    const serials = await screen.findByRole('region', { name: 'Serial numbers' });
    expect(within(serials).getByText('SN-A-1')).toBeInTheDocument();
    expect(within(serials).getByText('exact match')).toBeInTheDocument();
    expect(
      within(screen.getByRole('region', { name: 'Customers' })).getByText('Ravi Kumar'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Invoices' })).not.toBeInTheDocument();
  });

  it('sends one request for what was typed, not one for every key', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...signedIn(makeSession({ permissions: PERMS })),
      'GET /api/search?*': () => jsonResponse(response()),
    });
    renderApp('/');
    await user.type(await screen.findByRole('textbox', { name: 'Find anything' }), 'ravi');
    await screen.findByRole('region', { name: 'Customers' });
    const searches = calls.calls.filter((c) => c.key.includes('/api/search'));
    expect(searches).toHaveLength(1);
    expect(searches[0]?.key).toContain('q=ravi');
  });

  it('opens the page for a result and clears the box', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...signedIn(makeSession({ permissions: PERMS })),
      'GET /api/search?*': () => jsonResponse(response()),
    });
    renderApp('/');
    const box = await screen.findByRole('textbox', { name: 'Find anything' });
    await user.type(box, 'ravi');
    await user.click(await screen.findByRole('button', { name: /Ravi Kumar/ }));
    await waitFor(() => expect(box).toHaveValue(''));
    expect(screen.queryByRole('region', { name: 'Customers' })).not.toBeInTheDocument();
  });

  it('says so when nothing is found', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...signedIn(makeSession({ permissions: PERMS })),
      'GET /api/search?*': () => jsonResponse(response({ query: 'zzzz', results: [] })),
    });
    renderApp('/');
    await user.type(await screen.findByRole('textbox', { name: 'Find anything' }), 'zzzz');
    expect(await screen.findByText('Nothing found for “zzzz”')).toBeInTheDocument();
  });

  it('shows an error without breaking the page', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...signedIn(makeSession({ permissions: PERMS })),
      'GET /api/search?*': () =>
        jsonResponse(
          { code: 'INTERNAL_ERROR', message: 'Search is busy', details: [], requestId: 'r' },
          500,
        ),
    });
    renderApp('/');
    await user.type(await screen.findByRole('textbox', { name: 'Find anything' }), 'ravi');
    expect(await screen.findByRole('alert')).toHaveTextContent('Search is busy');
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...signedIn(makeSession({ permissions: PERMS })),
      'GET /api/search?*': () => jsonResponse(response()),
    });
    renderApp('/');
    await user.type(await screen.findByRole('textbox', { name: 'Find anything' }), 'ravi');
    await screen.findByRole('region', { name: 'Customers' });
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Customers' })).not.toBeInTheDocument();
  });
});
