import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createQueryClient } from '@/lib/query-client';
import { databaseDownBody, healthyBody, jsonResponse, stubFetch } from '@/test/fetch-mock';
import { HealthStatus } from './health-status';

function renderStatus() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <HealthStatus />
    </QueryClientProvider>,
  );
}

describe('HealthStatus', () => {
  it('shows a loading state while the request is in flight', () => {
    stubFetch(() => new Promise<Response>(() => undefined));

    renderStatus();

    expect(screen.getByRole('status')).toHaveTextContent('Checking system status');
  });

  it('shows the healthy state with database and uptime', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(healthyBody)));

    renderStatus();

    expect(await screen.findByText(/System healthy/)).toHaveTextContent('database up');
    expect(screen.getByRole('status')).toHaveTextContent('up 42s');
  });

  it('shows the server message when the database is down', async () => {
    stubFetch(() => Promise.resolve(jsonResponse(databaseDownBody, 503)));

    renderStatus();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'System unavailable: The database is not reachable',
    );
  });

  it('shows a generic message when the server cannot be reached', async () => {
    stubFetch(() => Promise.reject(new TypeError('Failed to fetch')));

    renderStatus();

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server');
  });

  it('recovers when Retry succeeds', async () => {
    let calls = 0;
    stubFetch(() => {
      calls += 1;
      return Promise.resolve(
        calls === 1 ? jsonResponse(databaseDownBody, 503) : jsonResponse(healthyBody),
      );
    });

    renderStatus();
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/System healthy/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
