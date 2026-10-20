import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Branch } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

const branch = (over: Partial<Branch> = {}): Branch => ({
  id: 'b-1',
  code: 'KOL',
  name: 'Kolkata',
  gstin: null,
  stateCode: '19',
  stateName: 'West Bengal',
  isActive: true,
  rowVersion: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});
const page = (items: Branch[], over: Record<string, number> = {}) => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...over,
});
const STATES = [
  { code: '19', name: 'West Bengal' },
  { code: '27', name: 'Maharashtra' },
];
const MANAGER = ['branches.view', 'branches.manage'];
const base = (
  permissions: string[] = MANAGER,
  items: Branch[] = [branch()],
): Record<string, RouteHandler> => ({
  ...signedIn(makeSession({ permissions })),
  'GET /api/branches*': () => jsonResponse(page(items)),
  'GET /api/reference/states': () => jsonResponse(STATES),
});
const open = async (handlers: Record<string, RouteHandler> = base()) => {
  const fetchState = routeFetch(handlers);
  const view = renderApp('/branches');
  return { ...fetchState, ...view };
};
const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith('GET /api/branches'));
const rows = () =>
  within(screen.getByRole('table', { name: 'Branches' }))
    .getAllByRole('row')
    .slice(1);

describe('branch list', () => {
  it('shows a loading message while the branches are being fetched', async () => {
    await open({ ...base(), 'GET /api/branches*': () => new Promise<Response>(() => undefined) });
    expect(await screen.findByText('Loading branches…')).toBeInTheDocument();
  });

  it('shows the branches with their state, GSTIN and status', async () => {
    await open(
      base(MANAGER, [
        branch(),
        branch({
          id: 'b-2',
          code: 'PUN',
          name: 'Pune',
          stateCode: '27',
          stateName: 'Maharashtra',
          gstin: '27AAPFU0939F1ZV',
          isActive: false,
        }),
      ]),
    );
    expect(await screen.findByRole('table', { name: 'Branches' })).toBeInTheDocument();
    const [first, second] = rows();
    expect(first).toHaveTextContent('KOLKolkataWest Bengal—Active');
    expect(second).toHaveTextContent('PUNPuneMaharashtra27AAPFU0939F1ZVInactive');
  });

  it('explains an empty list, differently when a search is active', async () => {
    await open(base(MANAGER, []));
    expect(await screen.findByText('There are no branches yet.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Search'), 'zzz');
    expect(await screen.findByText(/No branches match your search/)).toBeInTheDocument();
  });

  it('offers a retry when the list cannot be loaded', async () => {
    let attempts = 0;
    await open({
      ...base(),
      'GET /api/branches*': () =>
        ++attempts === 1
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse(page([branch()])),
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load the branches');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('table', { name: 'Branches' })).toBeInTheDocument();
  });

  it('asks the server to search and filter, restarting from the first page', async () => {
    const { calls } = await open();
    await screen.findByRole('table', { name: 'Branches' });
    await userEvent.type(screen.getByLabelText('Search'), 'kol');
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('search=kol'));
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'inactive');
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toMatch(/status=inactive/));
    expect(listCalls(calls).at(-1)?.key).toContain('page=1');
  });

  it('pages through a long list using the server totals', async () => {
    const { calls } = await open({
      ...base(),
      'GET /api/branches*': (call) => {
        const current = Number(/page=(\d+)/.exec(call.key)?.[1] ?? 1);
        return jsonResponse(
          page([branch({ id: `b-${current}`, code: `B${current}` })], {
            page: current,
            total: 25,
            totalPages: 3,
          }),
        );
      },
    });
    expect(await screen.findByText(/Showing 1–1 of 25/)).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 2 of 3')).toBeInTheDocument();
    expect(listCalls(calls).at(-1)?.key).toContain('page=2');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText('Page 3 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });
});

describe('who sees what', () => {
  it('shows a user without manage rights the list but no buttons to change it', async () => {
    await open(base(['branches.view']));
    await screen.findByRole('table', { name: 'Branches' });
    expect(screen.queryByRole('button', { name: 'New branch' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Edit KOL|Deactivate KOL/ }),
    ).not.toBeInTheDocument();
  });

  it('keeps a user without branch permissions out, and hides the menu entry', async () => {
    await open(base(['stock.view']));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'You do not have access' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Branches' })).not.toBeInTheDocument();
  });

  it('shows the menu entry to someone who may view branches', async () => {
    await open(base(['branches.view']));
    expect(await screen.findByRole('link', { name: 'Branches' })).toBeInTheDocument();
  });
});

describe('creating a branch', () => {
  const openForm = async (extra: Record<string, RouteHandler> = {}) => {
    const state = await open({ ...base(), ...extra });
    await screen.findByRole('table', { name: 'Branches' });
    await userEvent.click(screen.getByRole('button', { name: 'New branch' }));
    await screen.findByRole('dialog');
    await screen.findByRole('option', { name: '19 · West Bengal' });
    return state;
  };
  const fill = async (values: { code?: string; name?: string; state?: string; gstin?: string }) => {
    const user = userEvent.setup();
    if (values.code) await user.type(screen.getByLabelText('Code'), values.code);
    if (values.name) await user.type(screen.getByLabelText('Name'), values.name);
    if (values.state) await user.selectOptions(screen.getByLabelText('State'), values.state);
    if (values.gstin) await user.type(screen.getByLabelText('GSTIN'), values.gstin);
    await user.click(screen.getByRole('button', { name: 'Create branch' }));
  };

  it('checks the form first and sends nothing while it is wrong', async () => {
    const { calls } = await openForm();
    await userEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    expect(await screen.findByText('Use 2 to 4 capital letters or digits')).toBeInTheDocument();
    expect(screen.getByText('Enter at least 2 characters')).toBeInTheDocument();
    expect(screen.getByText('Choose a state', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.key === 'POST /api/branches')).toBe(false);
  });

  it('catches a mistyped GSTIN and one from the wrong state before sending', async () => {
    await openForm();
    await fill({ code: 'kol', name: 'Kolkata', state: '19', gstin: '27AAPFU0939F1ZV' });
    expect(
      await screen.findByText('The GSTIN must start with the state code 19'),
    ).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('GSTIN'));
    await userEvent.type(screen.getByLabelText('GSTIN'), '19AAPFU0939F1Z1');
    await userEvent.click(screen.getByRole('button', { name: 'Create branch' }));
    expect(await screen.findByText(/check character is wrong/)).toBeInTheDocument();
  });

  it('creates the branch, closes the form, confirms, and refreshes the list', async () => {
    const { calls } = await openForm({
      'POST /api/branches': () =>
        jsonResponse(branch({ id: 'new', code: 'NEW', name: 'New Branch' }), 201),
    });
    const listsBefore = listCalls(calls).length;
    await fill({ code: 'new', name: ' New Branch ', state: '19' });

    expect(await screen.findByText('Branch NEW created')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/branches')?.body).toEqual({
      code: 'NEW',
      name: 'New Branch',
      stateCode: '19',
      gstin: null,
    });
    await waitFor(() => expect(listCalls(calls).length).toBeGreaterThan(listsBefore));
  });

  it('sends a valid GSTIN in capitals', async () => {
    const { calls } = await openForm({ 'POST /api/branches': () => jsonResponse(branch(), 201) });
    await fill({ code: 'mum', name: 'Mumbai', state: '27', gstin: '27aapfu0939f1zv' });
    await screen.findByText('Branch MUM created');
    expect(calls.find((call) => call.key === 'POST /api/branches')?.body).toMatchObject({
      gstin: '27AAPFU0939F1ZV',
      stateCode: '27',
    });
  });

  it('puts a duplicate-code complaint next to the code field and keeps the form open', async () => {
    await openForm({
      'POST /api/branches': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'A branch with this code already exists',
            details: [{ field: 'code', message: 'This code is already used by another branch' }],
            requestId: 'r',
          },
          409,
        ),
    });
    await fill({ code: 'kol', name: 'Kolkata', state: '19' });
    expect(
      await screen.findByText('This code is already used by another branch'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Code')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create branch' })).toBeEnabled();
  });

  it('shows a general error when the server cannot be reached', async () => {
    await openForm({
      'POST /api/branches': () => {
        throw new TypeError('offline');
      },
    });
    await fill({ code: 'kol', name: 'Kolkata', state: '19' });
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'Could not reach the server',
    );
  });

  it('disables saving while the request is in flight so it cannot be sent twice', async () => {
    let release: (response: Response) => void = () => undefined;
    const { count } = await openForm({
      'POST /api/branches': () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    });
    await fill({ code: 'kol', name: 'Kolkata', state: '19' });
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release(jsonResponse(branch(), 201));
    await screen.findByText('Branch KOL created');
    expect(count('POST /api/branches')).toBe(1);
  });

  it('closes without saving when cancelled', async () => {
    const { calls } = await openForm();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.key === 'POST /api/branches')).toBe(false);
  });
});

describe('editing a branch', () => {
  const openEdit = async (
    extra: Record<string, RouteHandler> = {},
    item = branch({ gstin: null }),
  ) => {
    const state = await open({ ...base(MANAGER, [item]), ...extra });
    await screen.findByRole('table', { name: 'Branches' });
    await userEvent.click(screen.getByRole('button', { name: `Edit ${item.code}` }));
    await screen.findByRole('dialog');
    await screen.findByRole('option', { name: '27 · Maharashtra' });
    return state;
  };

  it('starts from the current values and does not let the code change', async () => {
    await openEdit();
    expect(screen.getByLabelText('Code')).toHaveValue('KOL');
    expect(screen.getByLabelText('Code')).toBeDisabled();
    expect(screen.getByLabelText('Name')).toHaveValue('Kolkata');
    expect(screen.getByLabelText('State')).toHaveValue('19');
    expect(screen.getByRole('heading', { name: 'Edit branch KOL' })).toBeInTheDocument();
  });

  it('saves with the version it was loaded at, so a stale edit is caught by the server', async () => {
    const { calls } = await openEdit({
      'PATCH /api/branches/b-1': () =>
        jsonResponse(branch({ name: 'Kolkata East', rowVersion: 4 })),
    });
    const name = screen.getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Kolkata East');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('Branch KOL saved')).toBeInTheDocument();
    expect(calls.find((call) => call.key === 'PATCH /api/branches/b-1')?.body).toEqual({
      name: 'Kolkata East',
      stateCode: '19',
      gstin: null,
      rowVersion: 3,
    });
    expect(calls.find((call) => call.key === 'PATCH /api/branches/b-1')?.headers).toMatchObject({
      'x-csrf-token': 'csrf-1',
    });
  });

  it('tells the user when someone else changed the branch first', async () => {
    await openEdit({
      'PATCH /api/branches/b-1': () =>
        jsonResponse(
          {
            code: 'CONFLICT',
            message: 'This branch was changed by someone else. Reload it and try again',
            details: [],
            requestId: 'r',
          },
          409,
        ),
    });
    await userEvent.type(screen.getByLabelText('Name'), ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'changed by someone else',
    );
  });

  it("shows the server's reason when the state and GSTIN are frozen", async () => {
    await openEdit({
      'PATCH /api/branches/b-1': () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'The state and GSTIN cannot change once the branch has issued invoices',
            details: [],
            requestId: 'r',
          },
          422,
        ),
    });
    await userEvent.selectOptions(screen.getByLabelText('State'), '27');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
      'issued invoices',
    );
  });
});

describe('deactivating and reactivating', () => {
  it('asks first, then deactivates and confirms', async () => {
    const { calls } = await open({
      ...base(),
      'POST /api/branches/b-1/deactivate': () => jsonResponse(branch({ isActive: false })),
    });
    await screen.findByRole('table', { name: 'Branches' });
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate KOL' }));
    expect(
      await screen.findByRole('heading', { name: 'Deactivate branch KOL?' }),
    ).toBeInTheDocument();
    expect(calls.some((call) => call.key.endsWith('/deactivate'))).toBe(false);

    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    );

    expect(await screen.findByText('Branch KOL deactivated')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists the reasons when the branch cannot be deactivated yet, and keeps the dialog open', async () => {
    await open({
      ...base(),
      'POST /api/branches/b-1/deactivate': () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'This branch cannot be deactivated yet',
            requestId: 'r',
            details: [
              {
                field: 'isActive',
                message: '5 units of stock are still here. Transfer or write them off first',
              },
              { field: 'isActive', message: '1 stock transfer is still open' },
            ],
          },
          422,
        ),
    });
    await screen.findByRole('table', { name: 'Branches' });
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate KOL' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Deactivate' }),
    );

    const alert = await within(screen.getByRole('dialog')).findByRole('alert');
    expect(alert).toHaveTextContent('This branch cannot be deactivated yet');
    expect(
      within(alert)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual([
      '5 units of stock are still here. Transfer or write them off first',
      '1 stock transfer is still open',
    ]);
    expect(screen.getByRole('button', { name: 'Deactivate' })).toBeEnabled();
  });

  it('does nothing when cancelled', async () => {
    const { calls } = await open();
    await screen.findByRole('table', { name: 'Branches' });
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate KOL' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Cancel' }),
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.some((call) => call.key.endsWith('/deactivate'))).toBe(false);
  });

  it('reactivates an inactive branch', async () => {
    const { calls } = await open({
      ...base(MANAGER, [branch({ isActive: false })]),
      'POST /api/branches/b-1/reactivate': () => jsonResponse(branch()),
    });
    await screen.findByRole('table', { name: 'Branches' });
    await userEvent.click(screen.getByRole('button', { name: 'Reactivate KOL' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Reactivate' }),
    );
    expect(await screen.findByText('Branch KOL reactivated')).toBeInTheDocument();
    expect(calls.some((call) => call.key === 'POST /api/branches/b-1/reactivate')).toBe(true);
  });
});
