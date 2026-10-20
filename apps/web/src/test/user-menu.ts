import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/** The account controls live in the top bar's user menu, so open it before looking for them. */
export async function openUserMenu(): Promise<void> {
  await userEvent.click(await screen.findByRole('button', { name: 'Account menu' }));
}
