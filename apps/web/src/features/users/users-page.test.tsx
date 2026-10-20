import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BRANCH_A,
  BRANCH_B,
  BRANCH_C,
  ROLE_ADMIN,
  ROLE_STAFF,
  ROLE_SUPER,
  branchPage,
  makeRoleDto,
  makeUserDto,
  userPage,
} from '@/test/builders';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

const MANAGER = ['users.view', 'users.manage', 'roles.view', 'branches.view'];
const roles = [
  makeRoleDto({ id: ROLE_STAFF.id, name: 'STAFF', tier: 'STAFF', isSystem: true }),
  makeRoleDto({ id: ROLE_ADMIN.id, name: 'ADMIN', tier: 'ADMIN', isSystem: true }),
  makeRoleDto({
    id: ROLE_SUPER.id,
    name: 'SUPER_ADMIN',
    tier: 'SUPER_ADMIN',
    isSystem: true,
    editable: false,
  }),
];

function setup(
  handlers: Record<string, RouteHandler> = {},
  permissions = MANAGER,
  branchesForPicker = [BRANCH_A, BRANCH_B],
) {
  const state = routeFetch({
    ...signedIn(makeSession({ permissions })),
    'GET /api/users*': () => jsonResponse(userPage([makeUserDto()])),
    'GET /api/roles': () => jsonResponse(roles),
    'GET /api/branches*': () => jsonResponse(branchPage(branchesForPicker)),
    ...handlers,
  });
  const view = renderApp('/users');
  return { ...state, ...view };
}
const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith('GET /api/users?')).map((call) => call.key);

afterEach(() => vi.restoreAllMocks());

describe('users list', () => {
  it('shows who each person is, their role, branches, status and last sign-in', async () => {
    setup({
      'GET /api/users*': () =>
        jsonResponse(
          userPage([
            makeUserDto({ lastLoginAt: '2026-10-05T10:30:00.000Z' }),
            makeUserDto({
              id: 'u-2',
              username: 'bina',
              fullName: 'Bina Das',
              email: 'bina@example.com',
              mustChangePassword: true,
              branches: [BRANCH_A, BRANCH_B],
              role: ROLE_ADMIN,
            }),
          ]),
        ),
    });
    const table = await screen.findByRole('table', { name: 'Users' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(within(rows[0]!).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('asha · asha@example.com')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('STAFF')).toBeInTheDocument();
    expect(within(rows[0]!).getByText('AA')).toBeInTheDocument();
    expect(within(rows[0]!).getByText(/Oct 2026/)).toBeInTheDocument();
    expect(within(rows[1]!).getByText('AA, BB')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Must change password')).toBeInTheDocument();
    expect(within(rows[1]!).getByText('Never')).toBeInTheDocument();
  });

  it('offers actions only for people the viewer may manage, and only to those who may manage users', async () => {
    setup({
      'GET /api/users*': () =>
        jsonResponse(
          userPage([
            makeUserDto(),
            makeUserDto({ id: 'u-2', username: 'bina', fullName: 'Bina Das', manageable: false }),
          ]),
        ),
    });
    await screen.findByRole('table', { name: 'Users' });
    expect(screen.getByRole('button', { name: 'Edit asha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset password of asha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deactivate asha' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit bina' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New user' })).toBeInTheDocument();
  });

  it('is read-only for someone without users.manage', async () => {
    setup({}, ['users.view']);
    await screen.findByRole('table', { name: 'Users' });
    expect(screen.queryByRole('button', { name: 'New user' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit asha' })).not.toBeInTheDocument();
  });

  it('loads, can fail and retry, and explains an empty list', async () => {
    let calls = 0;
    setup({
      'GET /api/users*': () => {
        calls += 1;
        return calls === 1
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse(userPage([]));
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the users');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('There are no users yet.')).toBeInTheDocument();
  });

  it('asks the server for the search, filters and page the user chose', async () => {
    const { calls } = setup();
    await screen.findByRole('table', { name: 'Users' });
    expect(listCalls(calls)[0]).toBe('GET /api/users?page=1&pageSize=10&status=active');

    await userEvent.type(screen.getByRole('searchbox'), 'asha');
    await waitFor(() => expect(listCalls(calls).at(-1)).toContain('search=asha'));
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'all');
    await waitFor(() => expect(listCalls(calls).at(-1)).toContain('status=all'));
    await userEvent.selectOptions(screen.getByLabelText('Role'), ROLE_ADMIN.id);
    await waitFor(() => expect(listCalls(calls).at(-1)).toContain(`roleId=${ROLE_ADMIN.id}`));
    await userEvent.selectOptions(screen.getByLabelText('Branch'), BRANCH_B.id);
    await waitFor(() => expect(listCalls(calls).at(-1)).toContain(`branchId=${BRANCH_B.id}`));
    expect(listCalls(calls).at(-1)).toContain('page=1');
    expect(await screen.findByText(/No users match your search/).catch(() => null)).toBeNull();
  });

  it('moves between pages', async () => {
    const { calls } = setup({
      'GET /api/users*': () =>
        jsonResponse(userPage([makeUserDto()], { total: 25, totalPages: 3 })),
    });
    await screen.findByText(/Page 1 of 3/);
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listCalls(calls).at(-1)).toContain('page=2'));
  });
});

describe('creating a user', () => {
  it('checks the form before sending anything, and never offers the Super Admin role', async () => {
    const { count } = setup();
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    const options = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['Choose a role', 'STAFF', 'ADMIN']);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText(/Use 3 to 32 lowercase letters/)).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the full name')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid email address')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Role')).toHaveAttribute('aria-invalid', 'true');
    expect(within(dialog).getByText('Choose at least one branch')).toBeInTheDocument();
    expect(count('POST /api/users')).toBe(0);
  });

  it('creates the user and shows the temporary password once', async () => {
    const created = makeUserDto({
      id: 'u-9',
      username: 'new.person',
      fullName: 'New Person',
      email: 'new.person@example.com',
      mustChangePassword: true,
    });
    const { calls } = setup({
      'POST /api/users': () =>
        jsonResponse({ user: created, temporaryPassword: 'Abcd2345Efgh6789' }, 201),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText('Username'), 'New.Person');
    await user.type(within(dialog).getByLabelText('Full name'), '  New Person ');
    await user.type(within(dialog).getByLabelText('Email'), 'New.Person@Example.com');
    await user.selectOptions(within(dialog).getByLabelText('Role'), ROLE_STAFF.id);
    await user.click(within(dialog).getByRole('checkbox', { name: /AA · Alpha Branch/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    const shown = await screen.findByRole('dialog', { name: 'Account created' });
    expect(within(shown).getByLabelText('Temporary password')).toHaveTextContent(
      'Abcd2345Efgh6789',
    );
    expect(calls.find((call) => call.key === 'POST /api/users')?.body).toEqual({
      username: 'new.person',
      fullName: 'New Person',
      email: 'new.person@example.com',
      roleId: ROLE_STAFF.id,
      branchIds: [BRANCH_A.id],
    });

    await user.click(within(shown).getByRole('button', { name: 'Copy' }));
    expect(await within(shown).findByText('Copied to the clipboard.')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe('Abcd2345Efgh6789');

    await user.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Abcd2345Efgh6789')).not.toBeInTheDocument());
    expect(screen.getByText('New Person was added')).toBeInTheDocument();
  });

  it('puts a taken username or email next to the field it belongs to', async () => {
    setup({
      'POST /api/users': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'That username or email is already in use',
            requestId: 'r',
            details: [
              { field: 'username', message: 'This username is already taken' },
              { field: 'email', message: 'This email is already used by another account' },
            ],
          },
          409,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText('Username'), 'asha');
    await user.type(within(dialog).getByLabelText('Full name'), 'Asha Rao');
    await user.type(within(dialog).getByLabelText('Email'), 'asha@example.com');
    await user.selectOptions(within(dialog).getByLabelText('Role'), ROLE_STAFF.id);
    await user.click(within(dialog).getByRole('checkbox', { name: /AA/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));

    expect(await within(dialog).findByText('This username is already taken')).toBeInTheDocument();
    expect(
      within(dialog).getByText('This email is already used by another account'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('dialog', { name: 'Account created' })).not.toBeInTheDocument();
  });

  it('shows a general error when the server cannot be reached', async () => {
    setup({
      'POST /api/users': () => {
        throw new TypeError('offline');
      },
    });
    await userEvent.click(await screen.findByRole('button', { name: 'New user' }));
    const dialog = await screen.findByRole('dialog', { name: 'New user' });
    const user = userEvent.setup();
    await user.type(within(dialog).getByLabelText('Username'), 'new.person');
    await user.type(within(dialog).getByLabelText('Full name'), 'New Person');
    await user.type(within(dialog).getByLabelText('Email'), 'new.person@example.com');
    await user.selectOptions(within(dialog).getByLabelText('Role'), ROLE_STAFF.id);
    await user.click(within(dialog).getByRole('checkbox', { name: /AA/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Create user' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Could not reach the server',
    );
  });
});

describe('editing a user', () => {
  const edit = async (
    handlers: Record<string, RouteHandler> = {},
    target = makeUserDto({ rowVersion: 4 }),
    picker = [BRANCH_A, BRANCH_B],
  ) => {
    const state = setup(
      { 'GET /api/users*': () => jsonResponse(userPage([target])), ...handlers },
      MANAGER,
      picker,
    );
    await userEvent.click(await screen.findByRole('button', { name: `Edit ${target.username}` }));
    const dialog = await screen.findByRole('dialog', { name: `Edit ${target.fullName}` });
    return { ...state, dialog };
  };

  it('fills the form in, keeps the username fixed, and sends the version being edited', async () => {
    const { dialog, calls } = await edit({
      'PATCH /api/users/u-1': () =>
        jsonResponse(makeUserDto({ fullName: 'Asha R. Rao', rowVersion: 5 })),
    });
    expect(within(dialog).getByLabelText('Username')).toBeDisabled();
    expect(within(dialog).getByLabelText('Username')).toHaveValue('asha');
    expect(within(dialog).getByLabelText('Role')).toHaveValue(ROLE_STAFF.id);
    expect(within(dialog).getByRole('checkbox', { name: /AA/ })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: /BB/ })).not.toBeChecked();

    await userEvent.clear(within(dialog).getByLabelText('Full name'));
    await userEvent.type(within(dialog).getByLabelText('Full name'), 'Asha R. Rao');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /BB/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Asha R. Rao saved')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/users/u-1')?.body).toEqual({
      fullName: 'Asha R. Rao',
      email: 'asha@example.com',
      roleId: ROLE_STAFF.id,
      branchIds: [BRANCH_A.id, BRANCH_B.id],
      rowVersion: 4,
    });
  });

  it('tells the user when someone else changed the record first', async () => {
    const { dialog } = await edit({
      'PATCH /api/users/u-1': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'Someone else changed this user. Reload and try again.',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Someone else changed this user',
    );
  });

  it('explains the branches an Admin cannot change, and keeps them out of the request', async () => {
    const shared = makeUserDto({ branches: [BRANCH_A, BRANCH_C] });
    const { dialog, calls } = await edit(
      { 'PATCH /api/users/u-1': () => jsonResponse(shared) },
      shared,
      [BRANCH_A, BRANCH_B],
    );
    expect(
      within(dialog).getByText(/Also works in CC, which you do not manage/),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.some((call) => call.key === 'PATCH /api/users/u-1')).toBe(true),
    );
    expect(
      (calls.find((call) => call.key === 'PATCH /api/users/u-1')?.body as { branchIds: string[] })
        .branchIds,
    ).toEqual([BRANCH_A.id]);
  });

  it('does not let people change their own role or branches', async () => {
    const me = makeUserDto({
      id: 'user-1',
      username: 'ravi',
      fullName: 'Ravi Kumar',
      role: ROLE_ADMIN,
      branches: [BRANCH_A, BRANCH_B],
    });
    const { dialog } = await edit({}, me);
    expect(within(dialog).getByLabelText('Role')).toBeDisabled();
    for (const box of within(dialog).getAllByRole('checkbox')) expect(box).toBeDisabled();
    expect(within(dialog).getByText('You cannot change your own role')).toBeInTheDocument();
  });
});

describe('deactivating, reactivating and resetting', () => {
  it('asks for confirmation, then deactivates', async () => {
    const { calls } = setup({
      'POST /api/users/u-1/deactivate': () => jsonResponse(makeUserDto({ status: 'INACTIVE' })),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate asha' }));
    const dialog = await screen.findByRole('dialog', { name: /Deactivate Asha Rao\?/ });
    expect(within(dialog).getByText(/signed out everywhere straight away/)).toBeInTheDocument();
    expect(calls.some((call) => call.key === 'POST /api/users/u-1/deactivate')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await screen.findByText('Asha Rao deactivated')).toBeInTheDocument();
    expect(
      calls.find((call) => call.key === 'POST /api/users/u-1/deactivate')?.headers,
    ).toMatchObject({ 'x-csrf-token': 'csrf-1' });
  });

  it('keeps the dialog open and says why when the server refuses', async () => {
    setup({
      'POST /api/users/u-1/deactivate': () =>
        jsonResponse(
          {
            code: 'FORBIDDEN',
            message:
              'This person also works in branches you do not manage. Ask a Super Admin to deactivate them.',
            details: [],
            requestId: 'r',
          },
          403,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Deactivate asha' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Ask a Super Admin');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('reactivates an inactive user', async () => {
    setup({
      'GET /api/users*': () => jsonResponse(userPage([makeUserDto({ status: 'INACTIVE' })])),
      'POST /api/users/u-1/reactivate': () => jsonResponse(makeUserDto()),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Reactivate asha' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }),
    );
    expect(await screen.findByText('Asha Rao reactivated')).toBeInTheDocument();
  });

  it('resets a password and shows the temporary one once', async () => {
    setup({
      'POST /api/auth/users/u-1/reset-password': () =>
        jsonResponse({ temporaryPassword: 'Zyxw9876Vuts5432' }),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Reset password of asha' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reset password' }),
    );
    const shown = await screen.findByRole('dialog', { name: 'Password reset' });
    expect(within(shown).getByLabelText('Temporary password')).toHaveTextContent(
      'Zyxw9876Vuts5432',
    );
    await userEvent.click(within(shown).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByText('Zyxw9876Vuts5432')).not.toBeInTheDocument());
  });
});
