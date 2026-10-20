import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { batteryHandlers, batteryPage, makeBattery, MANAGER, VIEWER } from './test-data';

const open = (handlers: Record<string, RouteHandler> = batteryHandlers()) => {
  const state = routeFetch(handlers);
  const view = renderApp('/batteries');
  return { ...state, ...view };
};
const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith('GET /api/batteries?'));
const rows = () =>
  within(screen.getByRole('table', { name: 'Batteries' }))
    .getAllByRole('row')
    .slice(1);

describe('battery list', () => {
  it('shows a loading message while the batteries are fetched', async () => {
    open({
      ...batteryHandlers(),
      'GET /api/batteries?*': () => new Promise<Response>(() => undefined),
    });
    expect(await screen.findByText('Loading batteries…')).toBeInTheDocument();
  });

  it('shows expiry, warranty and installation in words a person can act on', async () => {
    open(
      batteryHandlers(MANAGER, [
        makeBattery(),
        makeBattery({
          serialUnitId: 'u-2',
          serialNo: 'BAT-0002',
          expiryOn: '2026-09-01',
          expiryStatus: 'EXPIRED',
          daysToExpiry: -37,
          warrantyMonths: 12,
          warrantyEnd: '2027-10-07',
          warrantyStatus: 'ACTIVE',
          state: 'RESERVED',
          installedInSerialUnitId: 's-1',
          installedInSerialNo: 'TOTO-77',
          installedOn: '2026-10-07',
        }),
        makeBattery({
          serialUnitId: 'u-3',
          serialNo: 'BAT-0003',
          expiryOn: '2026-10-08',
          daysToExpiry: 0,
          expiryStatus: 'EXPIRING',
          warrantyEnd: '2026-01-01',
          warrantyStatus: 'ENDED',
        }),
        makeBattery({
          serialUnitId: 'u-4',
          serialNo: 'BAT-0004',
          expiryOn: null,
          daysToExpiry: null,
          expiryStatus: 'NONE',
          warrantyMonths: null,
        }),
      ]),
    );
    await screen.findByRole('table', { name: 'Batteries' });
    const [fine, expired, today, bare] = rows();
    expect(fine).toHaveTextContent('2027-01-10 · in 200 days');
    expect(fine).toHaveTextContent('12 months, not started');
    expect(expired).toHaveTextContent('2026-09-01 · expired 37 days ago');
    expect(expired).toHaveTextContent('2027-10-07 · covered');
    expect(expired).toHaveTextContent('TOTO-77 (2026-10-07)');
    expect(expired).toHaveTextContent('reserved');
    expect(today).toHaveTextContent('2026-10-08 · expires today');
    expect(today).toHaveTextContent('2026-01-01 · ended');
    expect(bare).toHaveTextContent('—');
  });

  it('explains an empty list and an error, and recovers on Retry', async () => {
    open(batteryHandlers(MANAGER, []));
    expect(
      await screen.findByText('No battery details have been recorded yet.'),
    ).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search'), 'zzz');
    expect(await screen.findByText(/No batteries match your search/)).toBeInTheDocument();

    let fail = true;
    open({
      ...batteryHandlers(),
      'GET /api/batteries?*': () =>
        fail
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse(batteryPage([makeBattery()])),
    });
    expect(await screen.findByText('Could not load the batteries.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('BAT-0001')).toBeInTheDocument();
  });

  it('shows the expiry alert counts and filters when one is pressed', async () => {
    const { calls } = open();
    const alerts = await screen.findByLabelText('Expiry alerts');
    expect(within(alerts).getByRole('button', { name: '2 expired in stock' })).toBeInTheDocument();
    await userEvent.click(
      within(alerts).getByRole('button', { name: '5 expiring within 30 days' }),
    );
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('expiry=expiring'));
  });

  it('asks the server for the search, expiry, warranty and installation the user chose', async () => {
    const { calls } = open();
    await screen.findByText('BAT-0001');
    await userEvent.type(screen.getByLabelText('Search'), 'bat-00');
    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.key.includes('search=bat-00'))).toBe(true),
    );
    await userEvent.selectOptions(screen.getByLabelText('Expiry'), 'expired');
    await userEvent.selectOptions(screen.getByLabelText('Warranty'), 'active');
    await userEvent.selectOptions(screen.getByLabelText('Installed'), 'yes');
    await waitFor(() => {
      const last = listCalls(calls).at(-1)?.key ?? '';
      expect(last).toContain('expiry=expired');
      expect(last).toContain('warranty=active');
      expect(last).toContain('installed=yes');
      expect(last).toContain('page=1');
    });
  });

  it('moves between pages on the server', async () => {
    const { calls } = open({
      ...batteryHandlers(),
      'GET /api/batteries?*': () =>
        jsonResponse(batteryPage([makeBattery()], { total: 25, totalPages: 3 })),
    });
    await screen.findByText('Page 1 of 3');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('page=2'));
  });
});

describe('who sees what', () => {
  it('lets people who may adjust stock record, edit, install and take out', async () => {
    open(
      batteryHandlers(MANAGER, [
        makeBattery(),
        makeBattery({
          serialUnitId: 'u-2',
          serialNo: 'BAT-0002',
          installedInSerialUnitId: 's-1',
          installedInSerialNo: 'TOTO-77',
          installedOn: '2026-10-07',
        }),
      ]),
    );
    await screen.findByText('BAT-0001');
    expect(screen.getByRole('button', { name: 'Record battery details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit details of BAT-0001' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Install BAT-0001' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Take BAT-0002 out of its vehicle' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install BAT-0002' })).not.toBeInTheDocument();
  });

  it('shows read-only users the list and the alerts only', async () => {
    open(batteryHandlers(VIEWER));
    await screen.findByText('BAT-0001');
    expect(screen.getByLabelText('Expiry alerts')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Record battery details' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install BAT-0001' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Edit details of BAT-0001' }),
    ).not.toBeInTheDocument();
  });

  it('keeps people without batteries.view away from the page', async () => {
    open(batteryHandlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Batteries' })).not.toBeInTheDocument();
  });
});

describe('taking a battery out of its vehicle', () => {
  const installed = makeBattery({
    serialUnitId: 'u-2',
    serialNo: 'BAT-0002',
    installedInSerialUnitId: 's-1',
    installedInSerialNo: 'TOTO-77',
    installedOn: '2026-10-07',
  });

  it('does it and says where it came from', async () => {
    const { count } = open({
      ...batteryHandlers(MANAGER, [installed]),
      'POST /api/batteries/u-2/uninstall': () =>
        jsonResponse(makeBattery({ serialUnitId: 'u-2', serialNo: 'BAT-0002' })),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Take BAT-0002 out of its vehicle' }),
    );
    expect(await screen.findByText('Battery BAT-0002 taken out of TOTO-77')).toBeInTheDocument();
    expect(count('POST /api/batteries/u-2/uninstall')).toBe(1);
  });

  it('shows why it was refused', async () => {
    open({
      ...batteryHandlers(MANAGER, [installed]),
      'POST /api/batteries/u-2/uninstall': () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'This battery has already been sold',
            details: [],
            requestId: 'r',
          },
          422,
        ),
    });
    await userEvent.click(
      await screen.findByRole('button', { name: 'Take BAT-0002 out of its vehicle' }),
    );
    expect(await screen.findByText('This battery has already been sold')).toBeInTheDocument();
  });
});
