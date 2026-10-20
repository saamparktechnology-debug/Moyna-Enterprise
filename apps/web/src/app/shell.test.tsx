import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { openUserMenu } from '@/test/user-menu';
import { setViewport } from '@/test/viewport';

const PERMISSIONS = [
  'stock.view',
  'invoices.view',
  'customers.view',
  'reports.view',
  'settings.manage',
];
const session = (permissions = PERMISSIONS) =>
  signedIn(makeSession({ permissions, roles: ['STAFF'] }));
const nav = () => screen.getByRole('navigation', { name: 'Main navigation' });
const user = () => userEvent.setup();
const STORAGE_KEY = 'erp.preferences.v1.user-1';

async function ready() {
  await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
}

describe('sidebar groups and breadcrumb', () => {
  it('groups the screens by business function', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    const headings = within(nav())
      .getAllByRole('heading', { level: 2 })
      .map((h) => h.textContent);
    expect(headings).toEqual([
      'Overview',
      'Stock and purchasing',
      'Sales and customers',
      'Insights',
      'Administration',
    ]);
  });

  it('shows the group and the current screen as the breadcrumb', async () => {
    routeFetch(session());
    renderApp('/inventory');
    await screen.findByRole('heading', { level: 1, name: 'Inventory' });
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByText('Stock and purchasing')).toBeInTheDocument();
    expect(within(crumbs).getByText('Inventory')).toHaveAttribute('aria-current', 'page');
  });

  it('collapses and expands a group', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    const toggle = within(nav()).getByRole('button', { name: 'Sales and customers' });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await user().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav()).queryByRole('link', { name: 'Sales' })).not.toBeInTheDocument();
  });
});

describe('sidebar search', () => {
  it('filters the menu as you type and shows each result with its module', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    await user().type(screen.getByRole('combobox', { name: 'Search menu' }), 'inv');
    const results = within(nav()).getByRole('listbox', { name: 'Matching screens' });
    const options = within(results).getAllByRole('option');
    expect(options[0]).toHaveTextContent('Inventory');
    expect(options[0]).toHaveTextContent('Stock and purchasing');
    expect(within(nav()).queryByRole('link', { name: 'Customers' })).not.toBeInTheDocument();
  });

  it('moves with the arrow keys, opens with Enter, and clears with Escape', async () => {
    routeFetch(session());
    const { router } = renderApp('/');
    await ready();
    const box = screen.getByRole('combobox', { name: 'Search menu' });
    await user().type(box, 's');
    const first = box.getAttribute('aria-activedescendant');
    await user().keyboard('{ArrowDown}');
    expect(box.getAttribute('aria-activedescendant')).not.toBe(first);
    await user().keyboard('{ArrowUp}');
    expect(box.getAttribute('aria-activedescendant')).toBe(first);

    await user().keyboard('{Escape}');
    expect(box).toHaveValue('');
    expect(within(nav()).queryByRole('listbox')).not.toBeInTheDocument();

    await user().type(box, 'cust{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/customers'));
    expect(box).toHaveValue('');
  });

  it('says so when nothing matches, and offers only permitted screens', async () => {
    routeFetch(session(['stock.view']));
    renderApp('/');
    await ready();
    const box = screen.getByRole('combobox', { name: 'Search menu' });
    await user().type(box, 'customers');
    expect(within(nav()).getByText('No screen matches your search.')).toBeInTheDocument();
    await user().clear(box);
    await user().type(box, 'stock');
    const labels = within(nav())
      .getAllByRole('option')
      .map((option) => option.textContent ?? '');
    expect(labels).toHaveLength(2);
    expect(labels[0]).toContain('Inventory');
    expect(labels.some((label) => label.includes('Customers'))).toBe(false);
  });
});

describe('favourites', () => {
  it('pins a screen into a Favorites section and unpins it again', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(within(nav()).queryByRole('heading', { name: 'Favorites' })).not.toBeInTheDocument();

    await user().click(within(nav()).getByRole('button', { name: 'Pin Inventory to favorites' }));
    const favourites = within(nav()).getByRole('region', { name: 'Favorites' });
    expect(within(favourites).getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').favourites).toEqual([
      '/inventory',
    ]);

    await user().click(
      within(favourites).getByRole('button', { name: 'Unpin Inventory from favorites' }),
    );
    expect(within(nav()).queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').favourites).toEqual([]);
  });

  it('reorders favourites', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favourites: ['/inventory', '/sales'] }),
    );
    routeFetch(session());
    renderApp('/');
    await ready();
    const favourites = within(nav()).getByRole('region', { name: 'Favorites' });
    const order = () =>
      within(favourites)
        .getAllByRole('link')
        .map((link) => link.textContent);
    expect(order()).toEqual(['Inventory', 'Sales']);
    await user().click(within(favourites).getByRole('button', { name: 'Move Sales up' }));
    expect(order()).toEqual(['Sales', 'Inventory']);
    expect(within(favourites).getByRole('button', { name: 'Move Sales up' })).toBeDisabled();
  });

  it('never shows a favourite the user is not allowed to open', async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ favourites: ['/roles', '/inventory'] }),
    );
    routeFetch(session(['stock.view']));
    renderApp('/');
    await ready();
    const favourites = within(nav()).getByRole('region', { name: 'Favorites' });
    expect(
      within(favourites)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Inventory']);
  });

  it('keeps favourites per user', async () => {
    window.localStorage.setItem(
      'erp.preferences.v1.someone-else',
      JSON.stringify({ favourites: ['/sales'] }),
    );
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(within(nav()).queryByRole('region', { name: 'Favorites' })).not.toBeInTheDocument();
  });
});

describe('command palette', () => {
  it('opens with Ctrl+K, filters, opens a screen with Enter and closes', async () => {
    routeFetch(session());
    const { router } = renderApp('/');
    await ready();
    await user().keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Go to a screen' });
    const box = within(dialog).getByRole('combobox', { name: 'Search screens' });
    expect(box).toHaveFocus();
    await user().type(box, 'report{Enter}');
    await waitFor(() => expect(router.state.location.pathname).toBe('/reports'));
    expect(screen.queryByRole('dialog', { name: 'Go to a screen' })).not.toBeInTheDocument();
  });

  it('closes with Escape and shows an empty state', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    await user().keyboard('{Meta>}k{/Meta}');
    const dialog = await screen.findByRole('dialog', { name: 'Go to a screen' });
    await user().type(within(dialog).getByRole('combobox'), 'qqqq');
    expect(within(dialog).getByText('No screen matches your search.')).toBeInTheDocument();
    await user().keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('lists recently visited screens first while nothing is typed', async () => {
    routeFetch(session());
    const { router } = renderApp('/');
    await ready();
    await router.navigate('/reports');
    await screen.findByRole('heading', { level: 1, name: 'Reports' }).catch(() => undefined);
    await user().keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Go to a screen' });
    expect(within(dialog).getAllByRole('option')[0]).toHaveTextContent('Reports');
  });
});

describe('collapsed sidebar', () => {
  it('keeps every link reachable by name when only icons show', async () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ sidebarCollapsed: true }));
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(within(nav()).getByRole('link', { name: 'Inventory' })).toBeInTheDocument();
    expect(within(nav()).queryByRole('combobox')).not.toBeInTheDocument();
    await user().click(screen.getByRole('button', { name: 'Expand sidebar' }));
    expect(await screen.findByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}').sidebarCollapsed).toBe(
      false,
    );
  });

  it('collapses by itself on a tablet until the user chooses', async () => {
    setViewport(800);
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });
});

describe('mobile navigation drawer', () => {
  it('opens from the menu button, shows the same permitted links, and closes after a choice', async () => {
    setViewport(390);
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();

    await user().click(screen.getByRole('button', { name: 'Open navigation menu' }));
    const drawer = await screen.findByRole('dialog', { name: 'Navigation menu' });
    expect(
      within(within(drawer).getByRole('navigation', { name: 'Main navigation' }))
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Dashboard', 'Inventory', 'Sales', 'Exchanges', 'Customers', 'Reports', 'Settings']);

    await user().click(within(drawer).getByRole('link', { name: 'Inventory' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument();
  });

  it('closes with Escape', async () => {
    setViewport(390);
    routeFetch(session());
    renderApp('/');
    await ready();
    await user().click(screen.getByRole('button', { name: 'Open navigation menu' }));
    await screen.findByRole('dialog', { name: 'Navigation menu' });
    await user().keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});

describe('user menu', () => {
  it('switches theme and density and remembers the choice', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    await openUserMenu();
    await user().click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    await waitFor(() => expect(document.documentElement).toHaveClass('dark'));

    await openUserMenu();
    await user().click(screen.getByRole('menuitemradio', { name: 'Compact' }));
    await waitFor(() => expect(document.documentElement.dataset['density']).toBe('compact'));
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')).toMatchObject({
      theme: 'dark',
      density: 'compact',
    });
  });

  it('follows the system theme by default', async () => {
    setViewport(1280, { dark: true });
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(document.documentElement).toHaveClass('dark');
  });

  it('shows who is signed in with their role', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    await openUserMenu();
    expect(screen.getByLabelText('Signed in user')).toHaveTextContent('Ravi Kumar');
    expect(screen.getByLabelText('Signed in user')).toHaveTextContent('STAFF');
  });
});

describe('quick actions', () => {
  it('offers only the actions the user may take', async () => {
    routeFetch(session([...PERMISSIONS, 'invoices.create']));
    renderApp('/');
    await ready();
    await user().click(screen.getByRole('button', { name: 'Quick actions' }));
    expect(screen.getByRole('menuitem', { name: 'New invoice' })).toHaveAttribute(
      'href',
      '/sales?action=new',
    );
    expect(screen.queryByRole('menuitem', { name: 'Record payment' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'New customer' })).not.toBeInTheDocument();
  });

  it('is absent when the user may take none', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(screen.queryByRole('button', { name: 'Quick actions' })).not.toBeInTheDocument();
  });
});

describe('keyboard shortcuts', () => {
  it('"/" focuses the page search, but not while typing elsewhere', async () => {
    routeFetch({
      ...session(['branches.view']),
      'GET /api/branches*': () =>
        jsonResponse({ items: [], page: 1, pageSize: 10, total: 0, totalPages: 0 }),
    });
    renderApp('/branches');
    await screen.findByRole('heading', { level: 1, name: 'Branches' });
    const pageSearch = await screen.findByRole('searchbox', { name: /search/i });
    await user().keyboard('/');
    expect(pageSearch).toHaveFocus();
    expect(pageSearch).toHaveValue('');

    const finder = screen.getByRole('textbox', { name: 'Find anything' });
    await user().click(finder);
    await user().keyboard('a/b');
    expect(finder).toHaveValue('a/b');
  });

  it('has a skip link to the main content', async () => {
    routeFetch(session());
    renderApp('/');
    await ready();
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute(
      'href',
      '#main-content',
    );
    expect(document.getElementById('main-content')).toBeInTheDocument();
  });
});
