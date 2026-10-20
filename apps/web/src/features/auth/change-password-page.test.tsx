import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

async function open(session = makeSession(), extra = {}) {
  const fetchState = routeFetch({ ...signedIn(session), ...extra });
  const view = renderApp('/change-password');
  await screen.findByRole('heading', { level: 1, name: 'Change password' });
  return { ...fetchState, ...view };
}

async function fill(current: string, next: string, repeat = next) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('Current password'), current);
  await user.type(screen.getByLabelText('New password'), next);
  await user.type(screen.getByLabelText('Repeat new password'), repeat);
  await user.click(screen.getByRole('button', { name: 'Change password' }));
}

describe('change password page', () => {
  it('checks the form before sending anything', async () => {
    const { count } = await open();
    await userEvent.click(screen.getByRole('button', { name: 'Change password' }));
    expect(await screen.findByText('Enter your current password')).toBeInTheDocument();
    expect(screen.getByText('Use at least 12 characters')).toBeInTheDocument();
    expect(screen.getByText('Repeat the new password')).toBeInTheDocument();
    expect(count('POST /api/auth/change-password')).toBe(0);
  });

  it('asks for the new password to be repeated correctly', async () => {
    const { count } = await open();
    await fill('old password here', 'a long new passphrase', 'a different passphrase');
    expect(await screen.findByText('The passwords do not match')).toBeInTheDocument();
    expect(count('POST /api/auth/change-password')).toBe(0);
  });

  it('sends the passwords with the CSRF token, confirms, and uses the new session token afterwards', async () => {
    const { calls } = await open(makeSession({}, 'csrf-old'), {
      'POST /api/auth/change-password': () => jsonResponse(makeSession({}, 'csrf-new')),
    });
    await fill('old password here', 'a long new passphrase');

    expect(await screen.findByText(/Password changed/)).toBeInTheDocument();
    const sent = calls.find((call) => call.key === 'POST /api/auth/change-password');
    expect(sent?.body).toEqual({
      currentPassword: 'old password here',
      newPassword: 'a long new passphrase',
    });
    expect(sent?.headers).toMatchObject({ 'x-csrf-token': 'csrf-old' });
    expect(screen.getByLabelText('Current password')).toHaveValue('');
  });

  it("puts the server's complaints next to the fields they are about", async () => {
    await open(makeSession(), {
      'POST /api/auth/change-password': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Choose a stronger password',
            requestId: 'r',
            details: [
              {
                field: 'newPassword',
                message: 'This password is too common. Choose something harder to guess',
              },
              { field: 'currentPassword', message: 'Current password is incorrect' },
            ],
          },
          400,
        ),
    });
    await fill('old password here', 'password1234');

    expect(await screen.findByText(/too common/)).toBeInTheDocument();
    expect(screen.getByText('Current password is incorrect')).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('New password')).toHaveAccessibleDescription(
      expect.stringContaining('too common'),
    );
    expect(screen.queryByText(/Password changed/)).not.toBeInTheDocument();
  });

  it('shows a general error when the server cannot be reached', async () => {
    await open(makeSession(), {
      'POST /api/auth/change-password': () => {
        throw new TypeError('offline');
      },
    });
    await fill('old password here', 'a long new passphrase');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('takes a user who was forced to change their password to the dashboard afterwards', async () => {
    await open(makeSession({ mustChangePassword: true }), {
      'POST /api/auth/change-password': () =>
        jsonResponse(makeSession({ mustChangePassword: false }, 'csrf-new')),
    });
    expect(screen.getByText(/must choose a new password/)).toBeInTheDocument();
    await fill('temporary-password-1', 'a long new passphrase');
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});
