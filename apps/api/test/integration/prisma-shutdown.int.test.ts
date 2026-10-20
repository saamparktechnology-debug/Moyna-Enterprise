import { describe, expect, it, vi } from 'vitest';
import { PrismaService } from '../../src/common/prisma/prisma.service.js';
import { createTestApp } from '../support/create-test-app.js';

describe('PrismaService shutdown', () => {
  it('disconnects from the database when the application closes', async () => {
    const app = await createTestApp();
    const prisma = app.get(PrismaService);
    const disconnect = vi.spyOn(prisma, '$disconnect');

    await app.close();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('can query the database through the shared client', async () => {
    const app = await createTestApp();
    const prisma = app.get(PrismaService);

    const rows = await prisma.$queryRaw<{ one: number }[]>`SELECT 1 AS one`;

    expect(rows[0]?.one).toBe(1);
    await app.close();
  });
});
