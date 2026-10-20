import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { KycDocumentSchema } from '@erp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, ORIGIN } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { testEnv } from '../support/test-env.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');

describe('KYC files on disk', () => {
  const owner = createOwnerPrisma();
  let folder: string;
  let w: AuthWorld;
  const apps: NestExpressApplication[] = [];

  const start = async (): Promise<NestExpressApplication> => {
    const app = await createTestApp({
      env: testEnv({ STORAGE_DRIVER: 'local', KYC_STORAGE_PATH: folder }),
    });
    apps.push(app);
    return app;
  };
  const upload = (client: TestClient, customerId: string) =>
    client.agent
      .post(`/customers/${customerId}/kyc-documents`)
      .query({ docType: 'AADHAAR', fileName: 'a.pdf' })
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', client.csrf)
      .set('Content-Type', 'application/pdf')
      .send(PDF);

  beforeAll(async () => {
    folder = await mkdtemp(join(tmpdir(), 'erp-kyc-'));
    w = await createAuthWorld(owner);
  });
  afterAll(async () => {
    for (const app of apps) await app.close().catch(() => undefined);
    await owner.$disconnect();
    await rm(folder, { recursive: true, force: true });
  });

  it('keeps an uploaded document after the API restarts', async () => {
    const first = await start();
    const staff = await loggedIn(first, 'staff_a');
    const response = await upload(staff, w.customerId);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const document = KycDocumentSchema.parse(response.body);
    const stored = await readdir(join(folder, 'kyc', w.customerId));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    await first.close();

    const second = await start();
    const again = await loggedIn(second, 'staff_a');
    const file = await again.get(`/customers/${w.customerId}/kyc-documents/${document.id}/file`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toContain('application/pdf');
    expect(Buffer.from(file.body).equals(PDF)).toBe(true);
  });

  it('answers 404, not a crash, when the file has gone from disk, and keeps the record', async () => {
    const app = await start();
    const staff = await loggedIn(app, 'staff_a');
    const customer = await owner.customer.create({
      data: { name: 'Lost file', phone: '9000099999' },
    });
    const response = await upload(staff, customer.id);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    const document = KycDocumentSchema.parse(response.body);
    await rm(join(folder, 'kyc', customer.id), { recursive: true, force: true });
    const file = await staff.get(`/customers/${customer.id}/kyc-documents/${document.id}/file`);
    expect(file.status).toBe(404);
    expect(await owner.kycDocument.count({ where: { id: document.id } })).toBe(1);
  });

  it('leaves no file behind when the upload is refused', async () => {
    const app = await start();
    const staff = await loggedIn(app, 'staff_a');
    const customer = await owner.customer.create({
      data: { name: 'Bad upload', phone: '9000088888' },
    });
    const response = await staff.agent
      .post(`/customers/${customer.id}/kyc-documents`)
      .query({ docType: 'AADHAAR', fileName: 'a.pdf' })
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', staff.csrf)
      .set('Content-Type', 'application/pdf')
      .send(Buffer.from('MZ not a pdf'));
    expect(response.status).toBe(400);
    await expect(readdir(join(folder, 'kyc', customer.id))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });
});
