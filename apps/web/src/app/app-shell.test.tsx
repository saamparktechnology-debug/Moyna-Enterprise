import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { openUserMenu } from '@/test/user-menu';

const nav = () => screen.getByRole('navigation', { name: 'Main navigation' });

describe('app shell for a signed-in user', () => {
  it('shows the layout, the user and the dashboard with live system status', async () => {
    routeFetch(signedIn());
    renderApp('/');

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    await openUserMenu();
    expect(screen.getByLabelText('Signed in user')).toHaveTextContent('Ravi Kumar');
    expect(screen.getByRole('menuitem', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Change password' })).toHaveAttribute(
      'href',
      '/change-password',
    );
    expect(await screen.findByText(/System healthy/)).toBeInTheDocument();
  });

  it('shows only the navigation links the user is allowed to use', async () => {
    routeFetch(
      signedIn(makeSession({ permissions: ['stock.view', 'customers.view'], roles: ['STAFF'] })),
    );
    renderApp('/');

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Dashboard', 'Inventory', 'Customers']);
  });

  it('shows every link to a user who holds every permission', async () => {
    routeFetch(signedIn());
    renderApp('/');

    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    expect(
      within(nav())
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Dashboard', 'Inventory', 'Sales', 'Exchanges', 'Customers', 'Reports', 'Settings']);
  });

  it('marks the current page link as active', async () => {
    routeFetch(signedIn());
    renderApp('/inventory');

    await screen.findByRole('heading', { level: 1, name: 'Inventory' });
    expect(within(nav()).getByRole('link', { name: 'Inventory' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav()).getByRole('link', { name: 'Dashboard' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('opens a permitted page and explains when a page is not permitted, even by typing the address', async () => {
    routeFetch(signedIn(makeSession({ permissions: ['settings.manage'], roles: ['STAFF'] })));
    const { router } = renderApp('/settings');

    expect(await screen.findByRole('heading', { level: 1, name: 'Settings' })).toBeInTheDocument();
    await router.navigate('/reports');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'You do not have access' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Settings' })).not.toBeInTheDocument();
    expect(nav()).toBeInTheDocument();
  });

  it('shows a not-found page for an unknown route inside the layout', async () => {
    routeFetch(signedIn());
    renderApp('/does-not-exist');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Page not found' }),
    ).toBeInTheDocument();
    expect(nav()).toBeInTheDocument();
  });
});
