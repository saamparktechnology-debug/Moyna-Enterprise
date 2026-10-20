import { describe, expect, it } from 'vitest';
import { assertDatabaseReachable, explainConnectionFailure } from './database-preflight.js';

const url = 'postgresql://erp:s3cret-pw@localhost:5432/erp_test';

describe('explainConnectionFailure', () => {
  it('explains an authentication failure and the port-conflict cause', () => {
    const message = explainConnectionFailure(Object.assign(new Error('x'), { code: '28P01' }), url);
    expect(message).toContain('erp@localhost:5432/erp_test');
    expect(message).toContain('Authentication failed');
    expect(message).toContain('POSTGRES_PORT');
  });

  it('explains a missing database', () => {
    const message = explainConnectionFailure(Object.assign(new Error('x'), { code: '3D000' }), url);
    expect(message).toContain('does not exist');
  });

  it('explains an unreachable server', () => {
    const message = explainConnectionFailure(
      Object.assign(new Error('x'), { code: 'ECONNREFUSED' }),
      url,
    );
    expect(message).toContain('pnpm db:up');
  });

  it('falls back to the original reason and never prints the password', () => {
    const message = explainConnectionFailure(new Error('boom'), url);
    expect(message).toContain('boom');
    expect(message).not.toContain('s3cret-pw');
  });
});

describe('assertDatabaseReachable', () => {
  it('fails fast with an actionable message when nothing is listening', async () => {
    const started = Date.now();
    await expect(
      assertDatabaseReachable('postgresql://erp:pw@127.0.0.1:1/erp_test'),
    ).rejects.toThrowError(/pnpm db:up/);
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
