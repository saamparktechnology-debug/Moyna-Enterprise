import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { BRANCH_A, BRANCH_B } from '@/test/builders';
import { healthyBody, jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { openUserMenu } from '@/test/user-menu';
import { clearActiveBranch } from './active-branch';

const headerOn = (
  calls: { key: string; headers: Record<string, string> }[],
  key = 'GET /api/health',
) => calls.filter((call) => call.key === key).map((call) => call.headers['x-branch-id']);

afterEach(() => {
  window.sessionStorage.clear();
  clearActiveBranch();
});

describe('branch switcher', () => {
  it('shows a single-branch user their branch as plain text', async () => {
    routeFetch(signedIn(makeSession({ branches: [BRANCH_A] })));
    renderApp('/');
    expect(await screen.findByLabelText('Working branch')).toHaveTextContent('AA · Alpha Branch');
    expect(screen.queryByRole('combobox', { name: 'Working branch' })).not.toBeInTheDocument();
  });

  it('says so when the user has no branch', async () => {
    routeFetch(signedIn(makeSession({ branches: [] })));
    renderApp('/');
    expect(await screen.findByText('No branch assigned')).toBeInTheDocument();
  });

  it('offers a user with several branches "All branches" first, and sends no branch header by default', async () => {
    const { calls } = routeFetch(signedIn(makeSession({ branches: [BRANCH_A, BRANCH_B] })));
    renderApp('/');
    const select = await screen.findByRole('combobox', { name: 'Working branch' });
    expect(select).toHaveValue('all');
    expect([...select.querySelectorAll('option')].map((option) => option.textContent)).toEqual([
      'All branches',
      'AA · Alpha Branch',
      'BB · Beta Branch',
    ]);
    await screen.findByText(/System healthy/);
    expect(headerOn(calls).every((value) => value === undefined)).toBe(true);
  });

  it('sends the chosen branch with every request from then on, and reloads the data', async () => {
    const { calls, count } = routeFetch(signedIn(makeSession({ branches: [BRANCH_A, BRANCH_B] })));
    renderApp('/');
    await screen.findByText(/System healthy/);
    const before = count('GET /api/health');

    await userEvent.selectOptions(
      await screen.findByRole('combobox', { name: 'Working branch' }),
      BRANCH_B.id,
    );

    await waitFor(() => expect(count('GET /api/health')).toBeGreaterThan(before));
    expect(headerOn(calls).at(-1)).toBe(BRANCH_B.id);
    expect(window.sessionStorage.getItem('erp.activeBranch.user-1')).toBe(BRANCH_B.id);
  });

  it('goes back to all branches when asked', async () => {
    const { calls, count } = routeFetch(signedIn(makeSession({ branches: [BRANCH_A, BRANCH_B] })));
    renderApp('/');
    await screen.findByText(/System healthy/);
    const select = await screen.findByRole('combobox', { name: 'Working branch' });
    await userEvent.selectOptions(select, BRANCH_A.id);
    await waitFor(() => expect(headerOn(calls).at(-1)).toBe(BRANCH_A.id));
    const seen = count('GET /api/health');

    await userEvent.selectOptions(select, 'all');

    await waitFor(() => expect(count('GET /api/health')).toBeGreaterThan(seen));
    expect(headerOn(calls).at(-1)).toBeUndefined();
    expect(window.sessionStorage.getItem('erp.activeBranch.user-1')).toBeNull();
  });

  it('remembers the choice for this tab, so a reload starts in the same branch', async () => {
    window.sessionStorage.setItem('erp.activeBranch.user-1', BRANCH_B.id);
    const { calls } = routeFetch(signedIn(makeSession({ branches: [BRANCH_A, BRANCH_B] })));
    renderApp('/');
    expect(await screen.findByRole('combobox', { name: 'Working branch' })).toHaveValue(
      BRANCH_B.id,
    );
    await screen.findByText(/System healthy/);
    expect(headerOn(calls)[0]).toBe(BRANCH_B.id);
  });

  it('ignores a remembered branch the user no longer works in', async () => {
    window.sessionStorage.setItem(
      'erp.activeBranch.user-1',
      '99999999-9999-4999-8999-999999999999',
    );
    const { calls } = routeFetch(signedIn(makeSession({ branches: [BRANCH_A, BRANCH_B] })));
    renderApp('/');
    expect(await screen.findByRole('combobox', { name: 'Working branch' })).toHaveValue('all');
    await screen.findByText(/System healthy/);
    expect(headerOn(calls).every((value) => value === undefined)).toBe(true);
  });

  it('stops sending the branch after signing out', async () => {
    window.sessionStorage.setItem('erp.activeBranch.user-1', BRANCH_A.id);
    const { calls } = routeFetch({
      ...signedIn(makeSession({ branches: [BRANCH_A, BRANCH_B] })),
      'POST /api/auth/logout': () => jsonResponse({ ok: true }),
    });
    renderApp('/');
    await screen.findByText(/System healthy/);
    await openUserMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await screen.findByRole('heading', { name: 'Sign in to ERP' });
    expect(calls.find((call) => call.key === 'POST /api/auth/logout')?.headers['x-branch-id']).toBe(
      BRANCH_A.id,
    );
    await waitFor(() => expect(healthyBody).toBeTruthy());
  });
});
