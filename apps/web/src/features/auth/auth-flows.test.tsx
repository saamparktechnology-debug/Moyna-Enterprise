import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import {
  jsonResponse,
  makeSession,
  routeFetch,
  signedIn,
  signedOut,
  unauthenticatedBody,
} from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { openUserMenu } from '@/test/user-menu';

const loginRoute = (handler: RouteHandler) => ({ ...signedOut(), 'POST /api/auth/login': handler });

async function fillAndSubmit(username: string, password: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Username'), username);
  await user.type(screen.getByLabelText('Password'), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('guarded routes', () => {
  it('sends a signed-out visitor to the sign-in page', async () => {
    routeFetch(signedOut());
    renderApp('/inventory');

    expect(await screen.findByRole('heading', { name: 'Sign in to ERP' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
    expect(screen.queryByText(/session ended/)).not.toBeInTheDocument();
  });

  it('shows a loading state while the session is checked', () => {
    routeFetch({ 'GET /api/auth/session': () => new Promise<Response>(() => undefined) });
    renderApp('/');
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('offers a retry when the server cannot be reached', async () => {
    let attempts = 0;
    routeFetch({
      'GET /api/auth/session': () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Failed to fetch');
        return jsonResponse(makeSession());
      },
      'GET /api/health': () => jsonResponse({ status: 'ok', database: 'up', uptimeSeconds: 1 }),
    });
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('could not reach the server');
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('signing in', () => {
  it('shows what is missing and sends nothing when the form is empty', async () => {
    const { calls } = routeFetch(signedOut());
    renderApp('/login');

    await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));

    expect(await screen.findByText('Enter your username')).toBeInTheDocument();
    expect(screen.getByText('Enter your password')).toBeInTheDocument();
    expect(screen.getByLabelText('Username')).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.key === 'POST /api/auth/login')).toBe(false);
  });

  it('signs in, then returns the user to the page they first asked for', async () => {
    const { calls } = routeFetch(
      loginRoute(() => jsonResponse(makeSession({ fullName: 'Asha Rao' }))),
    );
    renderApp('/inventory');

    await fillAndSubmit('asha', 'a long passphrase here');

    expect(await screen.findByRole('heading', { level: 1, name: 'Inventory' })).toBeInTheDocument();
    await openUserMenu();
    expect(screen.getByLabelText('Signed in user')).toHaveTextContent('Asha Rao');
    expect(calls.find((call) => call.key === 'POST /api/auth/login')?.body).toEqual({
      username: 'asha',
      password: 'a long passphrase here',
    });
  });

  it('shows the server message for wrong credentials and lets the user try again', async () => {
    routeFetch(
      loginRoute(() =>
        jsonResponse({ ...unauthenticatedBody, message: 'Invalid username or password' }, 401),
      ),
    );
    renderApp('/login');

    await fillAndSubmit('asha', 'wrong');

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid username or password');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'Sign in to ERP' })).toBeInTheDocument();
  });

  it('shows the lockout message from the server', async () => {
    routeFetch(
      loginRoute(() =>
        jsonResponse(
          {
            code: 'RATE_LIMITED',
            message: 'Too many failed sign-in attempts. Try again in 15 minutes.',
            details: [],
            requestId: 'r',
          },
          429,
        ),
      ),
    );
    renderApp('/login');
    await fillAndSubmit('asha', 'whatever');
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 15 minutes');
  });

  it('disables the button while signing in so it cannot be submitted twice', async () => {
    let release: (response: Response) => void = () => undefined;
    const { count } = routeFetch(
      loginRoute(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    renderApp('/login');

    await fillAndSubmit('asha', 'a long passphrase here');

    const button = await screen.findByRole('button', { name: 'Signing in…' });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(count('POST /api/auth/login')).toBe(1);
    release(jsonResponse(makeSession()));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it('shows a plain message when the server cannot be reached', async () => {
    routeFetch(
      loginRoute(() => {
        throw new TypeError('Failed to fetch');
      }),
    );
    renderApp('/login');
    await fillAndSubmit('asha', 'a long passphrase here');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('never follows an off-site address in the redirect', async () => {
    routeFetch(loginRoute(() => jsonResponse(makeSession())));
    const { router } = renderApp('/login');
    await router.navigate('/login', { state: { from: '//evil.example/steal' } });
    await fillAndSubmit('asha', 'a long passphrase here');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/');
  });

  it('keeps a signed-in user out of the sign-in page', async () => {
    routeFetch(signedIn());
    renderApp('/login');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });

  it('forces a new password before anything else when the account requires it', async () => {
    routeFetch({
      ...loginRoute(() => jsonResponse(makeSession({ mustChangePassword: true }))),
      'GET /api/auth/session': (call) =>
        call.key ? jsonResponse(unauthenticatedBody, 401) : jsonResponse(unauthenticatedBody, 401),
    });
    renderApp('/inventory');

    await fillAndSubmit('asha', 'temporary-password-1');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Change password' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/must choose a new password/)).toBeInTheDocument();
  });

  it('keeps a user who must change their password on the change-password page', async () => {
    routeFetch(signedIn(makeSession({ mustChangePassword: true })));
    const { router } = renderApp('/settings');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Change password' }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/change-password');
  });
});

describe('session expiry and sign-out', () => {
  it('sends the user back to sign in, with an explanation, when the session ends mid-use', async () => {
    let healthCalls = 0;
    routeFetch({
      ...signedIn(),
      'GET /api/health': () => {
        healthCalls += 1;
        return healthCalls === 1
          ? jsonResponse({ status: 'ok', database: 'up', uptimeSeconds: 1 })
          : jsonResponse(unauthenticatedBody, 401);
      },
    });
    const { queryClient } = renderApp('/');
    await screen.findByText(/System healthy/);

    await queryClient.refetchQueries({ queryKey: ['health'] }).catch(() => undefined);

    expect(await screen.findByRole('heading', { name: 'Sign in to ERP' })).toBeInTheDocument();
    expect(screen.getByText(/session ended/)).toBeInTheDocument();
  });

  it('signs out with the CSRF token, clears the screen and returns to sign in', async () => {
    const { calls } = routeFetch({
      ...signedIn(makeSession({}, 'csrf-abc')),
      'POST /api/auth/logout': () => jsonResponse({ ok: true }),
    });
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });

    await openUserMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in to ERP' })).toBeInTheDocument(),
    );
    expect(screen.queryByText(/session ended/)).not.toBeInTheDocument();
    expect(calls.find((call) => call.key === 'POST /api/auth/logout')?.headers).toMatchObject({
      'x-csrf-token': 'csrf-abc',
    });
  });

  it('still signs out on screen if the server could not be told', async () => {
    routeFetch({
      ...signedIn(),
      'POST /api/auth/logout': () => {
        throw new TypeError('offline');
      },
    });
    renderApp('/');
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' });
    await openUserMenu();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Sign in to ERP' })).toBeInTheDocument(),
    );
    expect(screen.queryByRole('navigation', { name: 'Main navigation' })).not.toBeInTheDocument();
  });
});
