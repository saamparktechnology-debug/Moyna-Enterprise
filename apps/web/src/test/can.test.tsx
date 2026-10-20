import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { Can } from '@/components/can';
import { AuthProvider } from '@/features/auth/auth-provider';
import { createQueryClient } from '@/lib/query-client';
import { makeSession, routeFetch, signedIn } from './fetch-mock';

function renderCan(permissions: string[]) {
  routeFetch(signedIn(makeSession({ permissions })));
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <AuthProvider>
        <Can permission="stock.adjust" fallback={<p>No adjusting for you</p>}>
          <button type="button">Adjust stock</button>
        </Can>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('Can', () => {
  it('shows its content to a user who holds the permission', async () => {
    renderCan(['stock.adjust']);
    expect(await screen.findByRole('button', { name: 'Adjust stock' })).toBeInTheDocument();
  });

  it('shows the fallback to a user who does not', async () => {
    renderCan(['stock.view']);
    expect(await screen.findByText('No adjusting for you')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Adjust stock' })).not.toBeInTheDocument();
  });
});
