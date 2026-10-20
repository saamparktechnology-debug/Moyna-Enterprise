import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { batteryHandlers, makeBattery, MANAGER, serialUnitPage, STAFF } from './test-data';

const withUnits = (extra: Record<string, RouteHandler> = {}) => ({
  'GET /api/stock/serial-units?*': () => jsonResponse(serialUnitPage(['TOTO-77', 'TOTO-78'])),
  ...extra,
});
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const setDate = (label: string, value: string) =>
  fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(label), { target: { value } });
const refusal = (
  message: string,
  details: { field: string; message: string }[] = [],
  status = 422,
) => jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);

describe('recording battery details', () => {
  const openNew = async (extra: Record<string, RouteHandler> = {}) => {
    const state = routeFetch({ ...batteryHandlers(), ...withUnits(extra) });
    renderApp('/batteries');
    await userEvent.click(await screen.findByRole('button', { name: 'Record battery details' }));
    const dialog = await screen.findByRole('dialog');
    return { ...state, dialog };
  };
  const choose = async (dialog: HTMLElement) => {
    await userEvent.type(within(dialog).getByLabelText('Find the serial number'), 'TOTO');
    await userEvent.click(
      await within(dialog).findByRole('button', { name: /TOTO-77 · TOTO X1 · HQ/ }),
    );
  };

  it('asks for a serial number before anything else and sends nothing', async () => {
    const { dialog, calls } = await openNew();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await within(dialog).findByText('Choose the serial unit')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('PATCH'))).toBe(false);
  });

  it('says when no serial number matches', async () => {
    const { dialog } = await openNew({
      'GET /api/stock/serial-units?*': () => jsonResponse(serialUnitPage([])),
    });
    await userEvent.type(within(dialog).getByLabelText('Find the serial number'), 'NOPE');
    expect(await within(dialog).findByText('No serial number matches.')).toBeInTheDocument();
  });

  it('refuses dates in the wrong order and warranty months that are too many', async () => {
    const { dialog } = await openNew();
    await choose(dialog);
    setDate('Manufactured on', '2026-05-01');
    setDate('Expires on', '2026-04-01');
    await userEvent.type(within(dialog).getByLabelText('Warranty (months)'), '121');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(
      await within(dialog).findByText('The expiry date must be after the manufacture date'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('At most 120 months')).toBeInTheDocument();
  });

  it('saves the dates for the chosen unit and confirms', async () => {
    const { dialog, calls } = await openNew({
      'PATCH /api/batteries/s-1': () =>
        jsonResponse(makeBattery({ serialUnitId: 's-1', serialNo: 'TOTO-77' })),
    });
    await choose(dialog);
    setDate('Manufactured on', '2026-01-10');
    setDate('Expires on', '2027-01-10');
    await userEvent.type(within(dialog).getByLabelText('Warranty (months)'), '12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Battery TOTO-77 saved')).toBeInTheDocument();
    expect(bodyOf(calls, 'PATCH /api/batteries/s-1')).toEqual({
      manufacturedOn: '2026-01-10',
      expiryOn: '2027-01-10',
      warrantyMonths: 12,
      warrantyEnd: null,
    });
  });
});

describe('changing recorded details', () => {
  const openEdit = async (extra: Record<string, RouteHandler> = {}) => {
    const state = routeFetch({ ...batteryHandlers(), ...extra });
    renderApp('/batteries');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit details of BAT-0001' }));
    const dialog = await screen.findByRole('dialog');
    return { ...state, dialog };
  };

  it('shows the current dates, needs no serial search and sends the row version', async () => {
    const { dialog, calls } = await openEdit({
      'PATCH /api/batteries/u-1': () => jsonResponse(makeBattery({ rowVersion: 3 })),
    });
    expect(within(dialog).getByText('Battery BAT-0001')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Find the serial number')).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText('Expires on')).toHaveValue('2027-01-10');
    setDate('Expires on', '2027-02-10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await screen.findByText('Battery BAT-0001 saved')).toBeInTheDocument();
    expect(bodyOf(calls, 'PATCH /api/batteries/u-1')).toMatchObject({
      expiryOn: '2027-02-10',
      manufacturedOn: '2026-01-10',
      warrantyMonths: 12,
      rowVersion: 2,
    });
  });

  it('shows the message when somebody else changed the details first', async () => {
    const { dialog } = await openEdit({
      'PATCH /api/batteries/u-1': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message:
              'These battery details were changed by someone else. Reload them and try again',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save details' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
  });
});

describe('installing a battery in a vehicle', () => {
  const expiredBattery = makeBattery({
    serialNo: 'BAT-0009',
    expiryOn: '2026-09-01',
    expiryStatus: 'EXPIRED',
    daysToExpiry: -37,
  });
  const openInstall = async (
    permissions: string[],
    battery = makeBattery(),
    extra: Record<string, RouteHandler> = {},
  ) => {
    const state = routeFetch({ ...batteryHandlers(permissions, [battery]), ...withUnits(extra) });
    renderApp('/batteries');
    await userEvent.click(
      await screen.findByRole('button', { name: `Install ${battery.serialNo}` }),
    );
    const dialog = await screen.findByRole('dialog');
    return { ...state, dialog };
  };
  const pickVehicle = async (dialog: HTMLElement) => {
    await userEvent.type(within(dialog).getByLabelText('Find the vehicle'), 'TOTO');
    await userEvent.click(await within(dialog).findByRole('button', { name: /TOTO-77 · TOTO X1/ }));
  };

  it('looks for vehicles in the battery’s own branch and needs one to be chosen', async () => {
    const { dialog, calls } = await openInstall(MANAGER);
    await userEvent.type(within(dialog).getByLabelText('Find the vehicle'), 'TOTO');
    await within(dialog).findByRole('button', { name: /TOTO-77/ });
    expect(
      calls.some(
        (call) =>
          call.key.startsWith('GET /api/stock/serial-units?') && call.key.includes('branchId=b-1'),
      ),
    ).toBe(true);
    await userEvent.clear(within(dialog).getByLabelText('Find the vehicle'));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install battery' }));
    expect(await within(dialog).findByText('Choose the vehicle')).toBeInTheDocument();
  });

  it('installs, using today when no date is given, and says where', async () => {
    const { dialog, calls } = await openInstall(MANAGER, makeBattery(), {
      'POST /api/batteries/u-1/install': () =>
        jsonResponse(
          makeBattery({
            installedInSerialUnitId: 's-1',
            installedInSerialNo: 'TOTO-77',
            installedOn: '2026-10-08',
          }),
        ),
    });
    await pickVehicle(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install battery' }));
    expect(await screen.findByText('Battery BAT-0001 installed in TOTO-77')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/batteries/u-1/install')).toEqual({
      vehicleSerialUnitId: 's-1',
    });
  });

  it('sends a chosen installation date', async () => {
    const { dialog, calls } = await openInstall(MANAGER, makeBattery(), {
      'POST /api/batteries/u-1/install': () => jsonResponse(makeBattery()),
    });
    await pickVehicle(dialog);
    setDate('Installed on', '2026-10-05');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install battery' }));
    await waitFor(() =>
      expect(bodyOf(calls, 'POST /api/batteries/u-1/install')).toEqual({
        vehicleSerialUnitId: 's-1',
        installedOn: '2026-10-05',
      }),
    );
  });

  it('lets a manager install an expired battery by giving a reason', async () => {
    const { dialog, calls } = await openInstall(MANAGER, expiredBattery, {
      'POST /api/batteries/u-1/install': () => jsonResponse(expiredBattery),
    });
    expect(within(dialog).getByText(/This battery expired on 2026-09-01\./)).toBeInTheDocument();
    expect(within(dialog).getByText(/Give a reason to install it anyway\./)).toBeInTheDocument();
    await pickVehicle(dialog);
    await userEvent.type(
      within(dialog).getByLabelText('Reason for the override'),
      'Customer accepted it',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install battery' }));
    await waitFor(() =>
      expect(bodyOf(calls, 'POST /api/batteries/u-1/install')).toMatchObject({
        overrideReason: 'Customer accepted it',
      }),
    );
  });

  it('tells Staff that only a manager can install an expired battery, and shows the refusal', async () => {
    const { dialog } = await openInstall(STAFF, expiredBattery, {
      'POST /api/batteries/u-1/install': () =>
        jsonResponse(
          {
            code: 'FORBIDDEN',
            message: 'You may not sell or install an expired battery',
            details: [],
            requestId: 'r',
          },
          403,
        ),
    });
    expect(
      within(dialog).getByText(/Only a manager can install it, with a reason\./),
    ).toBeInTheDocument();
    await pickVehicle(dialog);
    await userEvent.type(within(dialog).getByLabelText('Reason for the override'), 'Please');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install battery' }));
    expect(
      await within(dialog).findByText('You may not sell or install an expired battery'),
    ).toBeInTheDocument();
  });

  it('lists every reason the server gave for refusing', async () => {
    const { dialog } = await openInstall(MANAGER, makeBattery(), {
      'POST /api/batteries/u-1/install': () =>
        refusal('This battery cannot be installed', [
          { field: 'vehicleSerialUnitId', message: 'The vehicle is in another branch' },
        ]),
    });
    await pickVehicle(dialog);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Install battery' }));
    expect(await within(dialog).findByText('This battery cannot be installed')).toBeInTheDocument();
    expect(within(dialog).getByText('The vehicle is in another branch')).toBeInTheDocument();
  });
});
