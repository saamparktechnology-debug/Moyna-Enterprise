import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PERMISSION_GROUPS, makeRoleDto } from '@/test/builders';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

const SUPER = ['roles.view', 'roles.manage'];
const roles = [
  makeRoleDto({
    id: 'r-super',
    name: 'SUPER_ADMIN',
    tier: 'SUPER_ADMIN',
    isSystem: true,
    editable: false,
    description: 'Full access',
    permissionCodes: ['roles.manage', 'roles.view', 'stock.view', 'stock.adjust'],
    userCount: 1,
  }),
  makeRoleDto({
    id: 'r-staff',
    name: 'STAFF',
    tier: 'STAFF',
    isSystem: true,
    description: null,
    permissionCodes: ['stock.view'],
    userCount: 5,
    rowVersion: 3,
  }),
  makeRoleDto(),
];

function setup(permissions = SUPER, handlers: Record<string, RouteHandler> = {}) {
  const state = routeFetch({
    ...signedIn(makeSession({ permissions })),
    'GET /api/roles': () => jsonResponse(roles),
    'GET /api/permissions': () => jsonResponse(PERMISSION_GROUPS),
    ...handlers,
  });
  renderApp('/roles');
  return state;
}

describe('roles list', () => {
  it('shows each role with its level, type, people and permissions', async () => {
    setup();
    const table = await screen.findByRole('table', { name: 'Roles' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('SUPER_ADMIN')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('Super Admin')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('System')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Custom')).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Looks after stock')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('5')).toBeInTheDocument();
  });

  it('lets a manager edit a role but only view the Super Admin role', async () => {
    setup();
    await screen.findByRole('table', { name: 'Roles' });
    expect(screen.getByRole('button', { name: 'View SUPER_ADMIN' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit STAFF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Store Keeper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New role' })).toBeInTheDocument();
  });

  it('is view-only for someone who cannot manage roles', async () => {
    setup(['roles.view']);
    await screen.findByRole('table', { name: 'Roles' });
    expect(screen.queryByRole('button', { name: 'New role' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'View STAFF' }));
    const dialog = await screen.findByRole('dialog', { name: 'Role STAFF' });
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    for (const box of within(dialog).getAllByRole('checkbox')) expect(box).toBeDisabled();
  });

  it('can fail and retry, and explains when there is nothing to show', async () => {
    let calls = 0;
    setup(SUPER, {
      'GET /api/roles': () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse([]);
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the roles');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('There are no roles you can assign.')).toBeInTheDocument();
  });
});

describe('role editor', () => {
  it('shows the Super Admin role read-only with every permission ticked', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'View SUPER_ADMIN' }));
    const dialog = await screen.findByRole('dialog', { name: 'Role SUPER_ADMIN' });
    expect(within(dialog).getByText(/cannot be changed/)).toBeInTheDocument();
    expect(within(dialog).getByText('Permissions (4 selected)')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
  });

  it('groups permissions by module and marks the ones only a Super Admin may hold', async () => {
    setup();
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    expect(within(dialog).getByRole('group', { name: 'Roles' })).toBeInTheDocument();
    expect(within(dialog).getByRole('group', { name: 'Stock' })).toBeInTheDocument();
    const reserved = within(dialog).getByRole('checkbox', { name: /Create and edit roles/ });
    expect(reserved).toBeDisabled();
    expect(within(dialog).getByText(/roles\.manage · Super Admin only/)).toBeInTheDocument();
  });

  it('checks the form before sending anything', async () => {
    const { count } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));
    expect(await within(dialog).findByText('Enter the role name')).toBeInTheDocument();
    expect(count('POST /api/roles')).toBe(0);
  });

  it('creates a role with the chosen level and permissions, with "select all" skipping reserved ones', async () => {
    const { calls } = setup(SUPER, {
      'POST /api/roles': () => jsonResponse(makeRoleDto({ name: 'Cashier' }), 201),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText('Name'), '  Cashier ');
    await user.selectOptions(within(dialog).getByLabelText('Level'), 'ADMIN');
    await user.click(within(dialog).getByRole('button', { name: 'Select all stock permissions' }));
    await user.click(within(dialog).getByRole('button', { name: 'Select all roles permissions' }));
    expect(within(dialog).getByText('Permissions (3 selected)')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: /Request a stock adjustment/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create role' }));

    expect(await screen.findByText('Role Cashier created')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/roles')?.body).toEqual({
      name: 'Cashier',
      description: null,
      tier: 'ADMIN',
      permissionCodes: ['roles.view', 'stock.view'],
    });
  });

  it('puts a taken name next to the name, and permission problems above the list', async () => {
    setup(SUPER, {
      'POST /api/roles': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'A role with this name already exists',
            requestId: 'r',
            details: [{ field: 'name', message: 'A role with this name already exists' }],
          },
          409,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Store Keeper');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));
    expect(
      await within(dialog).findByText('A role with this name already exists'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  it('shows a permission problem from the server above the permission list', async () => {
    setup(SUPER, {
      'POST /api/roles': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Reserved permission',
            requestId: 'r',
            details: [
              {
                field: 'permissionCodes',
                message: 'roles.manage can only belong to the Super Admin role',
              },
            ],
          },
          400,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New role' }));
    const dialog = await screen.findByRole('dialog', { name: 'New role' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Sneaky');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create role' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'roles.manage can only belong to the Super Admin role',
    );
  });

  it("edits a role, keeps a system role's name fixed, and sends the version being edited", async () => {
    const { calls } = setup(SUPER, {
      'PATCH /api/roles/r-staff': () =>
        jsonResponse(makeRoleDto({ id: 'r-staff', name: 'STAFF', rowVersion: 4 })),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit STAFF' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit role STAFF' });
    expect(within(dialog).getByLabelText('Name')).toBeDisabled();
    expect(within(dialog).getByLabelText('Level')).toBeDisabled();
    expect(within(dialog).getByRole('checkbox', { name: /View stock balances/ })).toBeChecked();
    expect(
      within(dialog).getByRole('checkbox', { name: /Request a stock adjustment/ }),
    ).not.toBeChecked();

    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /Request a stock adjustment/ }),
    );
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /View stock balances/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Role STAFF saved')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/roles/r-staff')?.body).toEqual({
      name: 'STAFF',
      description: null,
      permissionCodes: ['stock.adjust'],
      rowVersion: 3,
    });
  });

  it('tells the user when someone else changed the role first', async () => {
    setup(SUPER, {
      'PATCH /api/roles/r-1': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'Someone else changed this role. Reload and try again.',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Store Keeper' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Someone else changed this role',
    );
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
  });
});
