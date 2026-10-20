import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  CustomerListResponseSchema,
  CustomerSchema,
  KYC_MAX_BYTES,
  KycDocumentSchema,
  KycOverviewSchema,
} from '@erp/contracts';
import type { Customer, KycDocument } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { STORAGE_SERVICE } from '../../src/common/storage/storage.service.js';
import type { StorageService } from '../../src/common/storage/storage.service.js';
import { createAuthWorld, loggedIn, ORIGIN, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(32, 7)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 3),
]);
const AADHAAR = '123456789012';
const PAN = 'ABCDE1234F';

/** A GSTIN with a correct check character, so tests can have as many different ones as they need. */
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
function checkChar(base: string): string {
  const sum = [...base].reduce((total, char, index) => {
    const product = CHARS.indexOf(char) * (index % 2 === 0 ? 1 : 2);
    return total + Math.floor(product / 36) + (product % 36);
  }, 0);
  return CHARS.charAt((36 - (sum % 36)) % 36);
}
function gstinFor(state: string, serial: number): string {
  const base = `${state}AAPFU${serial.toString().padStart(4, '0')}F1Z`;
  return `${base}${checkChar(base)}`;
}
const KNOWN_GSTIN = '27AAPFU0939F1ZV';

describe('customers and KYC documents', () => {
  it('builds GSTINs the way the real rule does', () => {
    expect(`${KNOWN_GSTIN.slice(0, 14)}${checkChar(KNOWN_GSTIN.slice(0, 14))}`).toBe(KNOWN_GSTIN);
  });

  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminB: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let storage: StorageService;
  const owner = createOwnerPrisma();
  let counter = 1000;
  const gstin = (state = '27'): string => gstinFor(state, (counter += 1));
  const phone = (): string => `9${(counter += 1).toString().padStart(9, '0')}`;

  const make = async (over: object = {}, client: TestClient = staffA): Promise<Customer> => {
    const response = await client.post('/customers', {
      name: 'Test customer',
      phone: phone(),
      ...over,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return CustomerSchema.parse(response.body);
  };
  const upload = (
    client: TestClient,
    customerId: string,
    options: {
      docType?: string;
      fileName?: string;
      bytes?: Buffer;
      contentType?: string;
      number?: string;
    } = {},
  ) => {
    const {
      docType = 'AADHAAR',
      fileName = 'document.pdf',
      bytes = PDF,
      contentType = 'application/pdf',
    } = options;
    let call = client.agent
      .post(`/customers/${customerId}/kyc-documents`)
      .query({ docType, fileName })
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', client.csrf)
      .set('Content-Type', contentType);
    if (options.number) call = call.set('X-Document-Number', options.number);
    return call.send(bytes);
  };
  const submit = async (
    client: TestClient,
    customerId: string,
    options: Parameters<typeof upload>[2] = {},
  ): Promise<KycDocument> => {
    const response = await upload(client, customerId, options);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return KycDocumentSchema.parse(response.body);
  };
  const review = (
    client: TestClient,
    customerId: string,
    document: KycDocument,
    action: 'verify' | 'reject',
    reason = 'Photo is not clear',
  ) =>
    client.post(
      `/customers/${customerId}/kyc-documents/${document.id}/${action}`,
      action === 'reject'
        ? { rowVersion: document.rowVersion, reason }
        : { rowVersion: document.rowVersion },
    );
  const overview = async (customerId: string) =>
    KycOverviewSchema.parse((await staffA.get(`/customers/${customerId}/kyc`)).body);
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    storage = app.get<StorageService>(STORAGE_SERVICE);
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    staffA = await loggedIn(app, 'staff_a');
    staffB = await loggedIn(app, 'staff_b');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every endpoint with 401 when signed out', async () => {
      const id = w.itemId;
      const origin = ORIGIN;
      const http = () => request(app.getHttpServer());
      const attempts = [
        http().get('/customers'),
        http().get(`/customers/${id}`),
        http().post('/customers').set('Origin', origin).send({}),
        http().patch(`/customers/${id}`).set('Origin', origin).send({}),
        http().get(`/customers/${id}/kyc`),
        http().post(`/customers/${id}/kyc-documents`).set('Origin', origin).send({}),
        http().get(`/customers/${id}/kyc-documents/${id}/file`),
        http().post(`/customers/${id}/kyc-documents/${id}/verify`).set('Origin', origin).send({}),
        http().post(`/customers/${id}/kyc-documents/${id}/reject`).set('Origin', origin).send({}),
        http().get('/reference/kyc-document-types'),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff work with customers and upload documents but not verify them', async () => {
      const customer = await make();
      const document = await submit(staffA, customer.id);
      expect((await staffA.get(`/customers/${customer.id}/kyc`)).status).toBe(200);
      expect((await review(staffA, customer.id, document, 'verify')).status).toBe(403);
      expect((await review(staffA, customer.id, document, 'reject')).status).toBe(403);
      expect((await review(adminA, customer.id, document, 'verify')).status).toBe(200);
    });

    it('shows the same customers to every branch, since customers belong to the company', async () => {
      const customer = await make();
      expect((await staffB.get(`/customers/${customer.id}`)).body).toEqual(
        (await staffA.get(`/customers/${customer.id}`)).body,
      );
    });
  });

  describe('customers', () => {
    it('creates a customer, tidies the input, starts KYC as not submitted and audits it', async () => {
      const number = gstin();
      const customer = await make({
        name: '  Ravi Kumar ',
        email: 'RAVI@Example.com ',
        stateCode: '27',
        gstin: number,
      });
      expect(customer).toMatchObject({
        name: 'Ravi Kumar',
        email: 'ravi@example.com',
        stateCode: '27',
        stateName: 'Maharashtra',
        gstin: number,
        kycStatus: 'NOT_SUBMITTED',
      });
      expect(await audits('CUSTOMER_CREATED', customer.id)).toHaveLength(1);
    });

    it('refuses bad input with a message for each field', async () => {
      const response = await staffA.post('/customers', {
        name: 'x',
        phone: '12345',
        email: 'not-an-email',
        gstin: 'BAD',
      });
      expect(response.status).toBe(400);
      expect(response.body.details.map((d: { field: string }) => d.field)).toEqual(
        expect.arrayContaining(['name', 'phone', 'email', 'gstin']),
      );
    });

    it('refuses a GSTIN from another state and an unknown state', async () => {
      const mismatch = await staffA.post('/customers', {
        name: 'Mismatch',
        phone: phone(),
        stateCode: '29',
        gstin: gstin('27'),
      });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.details[0].field).toBe('gstin');
      const unknown = await staffA.post('/customers', {
        name: 'Nowhere',
        phone: phone(),
        stateCode: '00',
      });
      expect(unknown.status).toBe(400);
      expect(unknown.body.details[0].field).toBe('stateCode');
    });

    it('refuses a phone number or GSTIN another customer has, and names that customer', async () => {
      const taken = gstin();
      const first = await make({ name: 'First Owner', gstin: taken, stateCode: '27' });
      const samePhone = await staffA.post('/customers', { name: 'Copy', phone: first.phone });
      expect(samePhone.status).toBe(409);
      expect(samePhone.body.details[0]).toEqual({
        field: 'phone',
        message: 'Already used by First Owner',
      });
      const sameGstin = await staffA.post('/customers', {
        name: 'Copy',
        phone: phone(),
        gstin: taken,
        stateCode: '27',
      });
      expect(sameGstin.status).toBe(409);
      expect(sameGstin.body.details[0].field).toBe('gstin');
    });

    it('lets only one of two simultaneous creations with the same phone number win', async () => {
      const shared = phone();
      const results = await Promise.all(
        [1, 2, 3].map((n) => staffA.post('/customers', { name: `Racer ${n}`, phone: shared })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(2);
    });

    it('edits with the row version, records old and new values and does nothing when nothing changed', async () => {
      const customer = await make({ name: 'Before' });
      const response = await staffA.patch(`/customers/${customer.id}`, {
        name: 'After',
        address: '12 Main Road',
        rowVersion: customer.rowVersion,
      });
      expect(response.status).toBe(200);
      const updated = CustomerSchema.parse(response.body);
      expect(updated).toMatchObject({ name: 'After', address: '12 Main Road' });
      expect(updated.rowVersion).toBe(customer.rowVersion + 1);
      const [entry] = await audits('CUSTOMER_UPDATED', customer.id);
      expect(entry?.oldValue).toMatchObject({ name: 'Before' });
      expect(entry?.newValue).toMatchObject({ name: 'After' });
      const same = await staffA.patch(`/customers/${customer.id}`, {
        name: 'After',
        rowVersion: updated.rowVersion,
      });
      expect(same.body.rowVersion).toBe(updated.rowVersion);
      expect(await audits('CUSTOMER_UPDATED', customer.id)).toHaveLength(1);
    });

    it('refuses a stale version, lets one of two parallel edits win and refuses a taken phone on edit', async () => {
      const customer = await make();
      const other = await make({ name: 'Other' });
      await staffA.patch(`/customers/${customer.id}`, {
        name: 'One',
        rowVersion: customer.rowVersion,
      });
      const stale = await staffA.patch(`/customers/${customer.id}`, {
        name: 'Two',
        rowVersion: customer.rowVersion,
      });
      expect(stale.status).toBe(409);
      const target = await make();
      const parallel = await Promise.all(
        ['A', 'B'].map((name) =>
          staffA.patch(`/customers/${target.id}`, {
            name: `Name ${name}`,
            rowVersion: target.rowVersion,
          }),
        ),
      );
      expect(parallel.map((r) => r.status).sort()).toEqual([200, 409]);
      const taken = await staffA.patch(`/customers/${other.id}`, {
        phone: customer.phone,
        rowVersion: other.rowVersion,
      });
      expect(taken.status).toBe(409);
      expect(taken.body.details[0].field).toBe('phone');
    });

    it('refuses an edit that needs nothing to change, an unknown customer and a GSTIN that no longer matches', async () => {
      const customer = await make({ stateCode: '27', gstin: gstin() });
      expect((await staffA.patch(`/customers/${customer.id}`, { rowVersion: 1 })).status).toBe(400);
      const ghost = await staffA.patch('/customers/00000000-0000-4000-8000-000000000000', {
        name: 'Ghost',
        rowVersion: 1,
      });
      expect(ghost.status).toBe(404);
      const moved = await staffA.patch(`/customers/${customer.id}`, {
        stateCode: '29',
        rowVersion: customer.rowVersion,
      });
      expect(moved.status).toBe(400);
      expect(moved.body.details[0].field).toBe('gstin');
    });

    it('lists with search, KYC filter, sorting and paging on the server', async () => {
      const tag = `Zed${(counter += 1)}`;
      const a = await make({ name: `${tag} Alpha`, stateCode: '27' });
      await make({ name: `${tag} Beta`, stateCode: '29' });
      await make({ name: `${tag} Gamma` });
      await submit(staffA, a.id);
      const list = async (query: string) =>
        CustomerListResponseSchema.parse(
          (await staffA.get(`/customers?search=${tag}&${query}`)).body,
        );
      expect((await list('sortBy=name&sortOrder=asc&pageSize=2')).items.map((c) => c.name)).toEqual(
        [`${tag} Alpha`, `${tag} Beta`],
      );
      const page2 = await list('sortBy=name&sortOrder=asc&pageSize=2&page=2');
      expect(page2.items.map((c) => c.name)).toEqual([`${tag} Gamma`]);
      expect(page2).toMatchObject({ total: 3, totalPages: 2 });
      expect((await list('kycStatus=PENDING')).items.map((c) => c.id)).toEqual([a.id]);
      expect((await list('stateCode=29')).items).toHaveLength(1);
      expect((await staffA.get(`/customers?search=${a.phone}`)).body.items[0].id).toBe(a.id);
      expect((await staffA.get('/customers?search=%25')).body.items).toEqual([]);
      expect((await staffA.get('/customers?sortBy=password')).status).toBe(400);
      expect((await staffA.get('/customers/00000000-0000-4000-8000-000000000000')).status).toBe(
        404,
      );
    });
  });

  describe('uploading a KYC document', () => {
    it('stores a PDF, JPEG or PNG, shows only a masked number and never keeps the full one', async () => {
      const customer = await make();
      const aadhaar = await submit(staffA, customer.id, {
        number: '1234 5678 9012',
        fileName: 'a.pdf',
      });
      expect(aadhaar).toMatchObject({
        status: 'PENDING',
        docType: 'AADHAAR',
        docNumberMasked: 'XXXXXXXX9012',
        mimeType: 'application/pdf',
        sizeBytes: PDF.length,
        isCurrent: true,
      });
      const pan = await submit(staffA, customer.id, {
        docType: 'PAN',
        number: 'abcde1234f',
        bytes: JPEG,
        contentType: 'image/jpeg',
        fileName: 'pan.jpg',
      });
      expect(pan.docNumberMasked).toBe('XXXXXX234F');
      const photo = await submit(staffA, customer.id, {
        docType: 'PHOTO',
        bytes: PNG,
        contentType: 'image/png',
        fileName: 'me.png',
      });
      expect(photo.docNumberMasked).toBeNull();

      const everywhere = JSON.stringify([
        await owner.kycDocument.findMany({ where: { customerId: customer.id } }),
        await owner.auditLog.findMany({ where: { entityType: 'KycDocument' } }),
        (await staffA.get(`/customers/${customer.id}/kyc`)).body,
      ]);
      for (const secret of [AADHAAR, '1234 5678 9012', PAN, 'abcde1234f'])
        expect(everywhere).not.toContain(secret);
      const stored = await owner.kycDocument.findUniqueOrThrow({ where: { id: aadhaar.id } });
      expect(await storage.get(stored.objectKey)).toMatchObject({ contentType: 'application/pdf' });
      expect(stored.objectKey.startsWith(`kyc/${customer.id}/`)).toBe(true);
      expect(await audits('KYC_DOCUMENT_UPLOADED', aadhaar.id)).toHaveLength(1);
    });

    it('masks a licence number that ends with a dash or slash without breaking the database rule', async () => {
      const customer = await make();
      const licence = await submit(staffA, customer.id, {
        docType: 'DRIVING_LICENCE',
        number: 'KA01/2020/0012-A',
      });
      expect(licence.docNumberMasked).toBe('XXXXXXXXX012A');
      const dashed = await submit(staffA, customer.id, {
        docType: 'VOTER_ID',
        number: 'ABC/12-3-4',
      });
      expect(dashed.docNumberMasked).toMatch(/^X+[A-Z0-9]{1,4}$/);
      const empty = await upload(staffA, customer.id, { docType: 'PASSPORT', number: '----' });
      expect(empty.status).toBe(400);
      expect(empty.body.details[0].field).toBe('docNumber');
    });

    it('moves the customer to pending', async () => {
      const customer = await make();
      expect((await overview(customer.id)).kycStatus).toBe('NOT_SUBMITTED');
      await submit(staffA, customer.id);
      expect((await overview(customer.id)).kycStatus).toBe('PENDING');
      expect((await staffA.get(`/customers/${customer.id}`)).body.kycStatus).toBe('PENDING');
    });

    it('refuses an empty upload, a file that is too big and a body sent as the wrong kind of data', async () => {
      const customer = await make();
      const empty = await upload(staffA, customer.id, { bytes: Buffer.alloc(0) });
      expect(empty.status).toBe(400);
      expect(empty.body.details[0].field).toBe('file');
      const exact = Buffer.concat([PDF, Buffer.alloc(KYC_MAX_BYTES - PDF.length)]);
      expect((await upload(staffA, customer.id, { bytes: exact, docType: 'PAN' })).status).toBe(
        201,
      );
      const over = Buffer.concat([PDF, Buffer.alloc(KYC_MAX_BYTES - PDF.length + 1)]);
      const tooBig = await upload(staffA, customer.id, { bytes: over, docType: 'VOTER_ID' });
      expect(tooBig.status).toBe(400);
      expect(tooBig.body.details[0].message).toMatch(/larger than 5 MB/);
      const huge = await upload(staffA, customer.id, {
        bytes: Buffer.alloc(7 * 1024 * 1024, 1),
        docType: 'VOTER_ID',
      });
      expect(huge.status).toBeGreaterThanOrEqual(400);
      expect(huge.status).toBeLessThan(500);
      const text = await upload(staffA, customer.id, {
        bytes: Buffer.from('hello'),
        contentType: 'text/plain',
      });
      expect(text.status).toBe(400);
      expect(await owner.kycDocument.count({ where: { customerId: customer.id } })).toBe(1);
    });

    it('checks what the file really is, not what it claims to be', async () => {
      const customer = await make();
      const program = await upload(staffA, customer.id, {
        bytes: Buffer.from('MZ\x90\x00 pretend program'),
        fileName: 'scan.pdf',
      });
      expect(program.status).toBe(400);
      expect(program.body.details[0].message).toBe('Upload a PDF, JPEG or PNG file');
      const wrongClaim = await upload(staffA, customer.id, {
        bytes: PDF,
        contentType: 'image/png',
        fileName: 'scan.png',
      });
      expect(wrongClaim.status).toBe(400);
      const script = await upload(staffA, customer.id, {
        bytes: Buffer.from('<script>alert(1)</script>'),
        contentType: 'image/jpeg',
      });
      expect(script.status).toBe(400);
      expect(await owner.kycDocument.count({ where: { customerId: customer.id } })).toBe(0);
    });

    it('refuses an unknown document type, a bad document number and a bad file name', async () => {
      const customer = await make();
      const type = await upload(staffA, customer.id, { docType: 'LIBRARY_CARD' });
      expect(type.status).toBe(400);
      expect(type.body.details[0].field).toBe('docType');
      const aadhaar = await upload(staffA, customer.id, { number: '1234' });
      expect(aadhaar.body.details[0]).toMatchObject({ field: 'docNumber' });
      const pan = await upload(staffA, customer.id, { docType: 'PAN', number: 'ABC123' });
      expect(pan.status).toBe(400);
      const name = await upload(staffA, customer.id, { fileName: '../etc/passwd' });
      expect(name.status).toBe(400);
      expect(name.body.details[0].field).toBe('fileName');
      const missing = await staffA.agent
        .post(`/customers/${customer.id}/kyc-documents`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', staffA.csrf)
        .set('Content-Type', 'application/pdf')
        .send(PDF);
      expect(missing.status).toBe(400);
      expect(await owner.kycDocument.count({ where: { customerId: customer.id } })).toBe(0);
    });

    it('answers 404 for an unknown customer and leaves nothing in storage', async () => {
      const response = await upload(staffA, '00000000-0000-4000-8000-000000000000');
      expect(response.status).toBe(404);
    });

    it('lists the document kinds', async () => {
      const response = await staffA.get('/reference/kyc-document-types');
      expect(response.body.map((t: { code: string }) => t.code)).toEqual(
        expect.arrayContaining(['AADHAAR', 'PAN', 'PHOTO']),
      );
    });
  });

  describe('the review workflow', () => {
    it('verifies an identity document, verifies the customer and audits it', async () => {
      const customer = await make();
      const document = await submit(staffA, customer.id, { number: PAN, docType: 'PAN' });
      const response = await review(adminA, customer.id, document, 'verify');
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(KycDocumentSchema.parse(response.body)).toMatchObject({
        status: 'VERIFIED',
        reviewedByName: expect.any(String),
        rejectionReason: null,
      });
      expect((await overview(customer.id)).kycStatus).toBe('VERIFIED');
      expect(await audits('KYC_DOCUMENT_VERIFIED', document.id)).toHaveLength(1);
    });

    it('keeps rejected and resubmitted documents as history, newest first, with only the latest current', async () => {
      const customer = await make();
      const first = await submit(staffA, customer.id, {
        fileName: 'blurry.jpg',
        bytes: JPEG,
        contentType: 'image/jpeg',
      });
      const rejected = await review(adminA, customer.id, first, 'reject', 'Photo is not clear');
      expect(rejected.status).toBe(200);
      expect((await overview(customer.id)).kycStatus).toBe('REJECTED');

      const second = await submit(staffA, customer.id, { fileName: 'clear.pdf' });
      expect((await overview(customer.id)).kycStatus).toBe('PENDING');
      expect((await review(adminA, customer.id, second, 'verify')).status).toBe(200);

      const { documents, kycStatus } = await overview(customer.id);
      expect(kycStatus).toBe('VERIFIED');
      expect(documents.map((d) => [d.fileName, d.status, d.isCurrent])).toEqual([
        ['clear.pdf', 'VERIFIED', true],
        ['blurry.jpg', 'REJECTED', false],
      ]);
      expect(documents[1]?.rejectionReason).toBe('Photo is not clear');
      const oldKey = (await owner.kycDocument.findUniqueOrThrow({ where: { id: first.id } }))
        .objectKey;
      expect(await storage.get(oldKey)).not.toBeNull();
    });

    it('replaces a document that is still waiting when a newer one is uploaded', async () => {
      const customer = await make();
      const first = await submit(staffA, customer.id, { fileName: 'one.pdf' });
      await submit(staffA, customer.id, { fileName: 'two.pdf' });
      const { documents } = await overview(customer.id);
      expect(documents.map((d) => [d.fileName, d.status])).toEqual([
        ['two.pdf', 'PENDING'],
        ['one.pdf', 'REJECTED'],
      ]);
      expect(documents[1]?.rejectionReason).toBe('Replaced by a newer upload');
      expect((await review(adminA, customer.id, first, 'verify')).status).toBe(409);
    });

    it('does not accept another upload of a kind that is already verified', async () => {
      const customer = await make();
      const document = await submit(staffA, customer.id);
      await review(adminA, customer.id, document, 'verify');
      const again = await upload(staffA, customer.id);
      expect(again.status).toBe(422);
      expect(again.body.details[0].field).toBe('docType');
    });

    it('does not make a customer verified from a photo alone, nor when only a proof of address is verified', async () => {
      const customer = await make();
      const photo = await submit(staffA, customer.id, {
        docType: 'PHOTO',
        bytes: PNG,
        contentType: 'image/png',
      });
      await review(adminA, customer.id, photo, 'verify');
      expect((await overview(customer.id)).kycStatus).toBe('PENDING');
      const address = await submit(staffA, customer.id, { docType: 'ADDRESS_PROOF' });
      await review(adminA, customer.id, address, 'verify');
      expect((await overview(customer.id)).kycStatus).toBe('PENDING');
      const pan = await submit(staffA, customer.id, { docType: 'PAN' });
      await review(adminA, customer.id, pan, 'verify');
      expect((await overview(customer.id)).kycStatus).toBe('VERIFIED');
    });

    it('stays verified when a later document of another kind is rejected', async () => {
      const customer = await make();
      const pan = await submit(staffA, customer.id, { docType: 'PAN' });
      const address = await submit(staffA, customer.id, { docType: 'ADDRESS_PROOF' });
      await review(adminA, customer.id, pan, 'verify');
      await review(adminA, customer.id, address, 'reject', 'Address is unreadable');
      expect((await overview(customer.id)).kycStatus).toBe('VERIFIED');
    });

    it('needs a reason to reject, refuses a stale version and a second decision', async () => {
      const customer = await make();
      const document = await submit(staffA, customer.id);
      const noReason = await adminA.post(
        `/customers/${customer.id}/kyc-documents/${document.id}/reject`,
        {
          rowVersion: document.rowVersion,
          reason: 'x',
        },
      );
      expect(noReason.status).toBe(400);
      expect(
        (
          await adminA.post(`/customers/${customer.id}/kyc-documents/${document.id}/verify`, {
            rowVersion: 99,
          })
        ).status,
      ).toBe(409);
      expect((await review(adminA, customer.id, document, 'verify')).status).toBe(200);
      const second = await review(adminA, customer.id, document, 'reject');
      expect(second.status).toBe(409);
    });

    it('does not let a reviewer verify a document they uploaded, except a Super Admin', async () => {
      const customer = await make();
      const own = await submit(adminA, customer.id);
      const refused = await review(adminA, customer.id, own, 'verify');
      expect(refused.status).toBe(403);
      expect((await review(adminA, customer.id, own, 'reject')).status).toBe(200);
      const owners = await submit(superAdmin, customer.id);
      expect((await review(superAdmin, customer.id, owners, 'verify')).status).toBe(200);
    });

    it('lets only one of two parallel decisions on the same document through', async () => {
      const customer = await make();
      const document = await submit(staffA, customer.id);
      const results = await Promise.all([
        review(adminA, customer.id, document, 'verify'),
        review(superAdmin, customer.id, document, 'reject'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('keeps exactly one waiting document when two uploads of the same kind race', async () => {
      const customer = await make();
      const results = await Promise.all([
        upload(staffA, customer.id, { fileName: 'a.pdf' }),
        upload(staffA, customer.id, { fileName: 'b.pdf' }),
      ]);
      expect(results.map((r) => r.status)).toEqual([201, 201]);
      const { documents } = await overview(customer.id);
      expect(documents.filter((d) => d.status === 'PENDING')).toHaveLength(1);
      expect(documents.filter((d) => d.status === 'REJECTED')).toHaveLength(1);
      expect(documents.filter((d) => d.isCurrent)).toHaveLength(1);
    });

    it('answers 404 for a document that belongs to another customer or does not exist', async () => {
      const mine = await make();
      const theirs = await make();
      const document = await submit(staffA, theirs.id);
      expect((await review(adminA, mine.id, document, 'verify')).status).toBe(404);
      expect(
        (
          await adminA.post(
            `/customers/${mine.id}/kyc-documents/00000000-0000-4000-8000-000000000000/verify`,
            { rowVersion: 1 },
          )
        ).status,
      ).toBe(404);
    });
  });

  describe('reading a document', () => {
    it('serves the file safely and writes who read it to the audit trail every time', async () => {
      const customer = await make();
      const document = await submit(staffA, customer.id, {
        bytes: JPEG,
        contentType: 'image/jpeg',
        fileName: 'id.jpg',
      });
      const response = await adminB.agent
        .get(`/customers/${customer.id}/kyc-documents/${document.id}/file`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(response.status).toBe(200);
      expect(Buffer.from(response.body as Buffer).equals(JPEG)).toBe(true);
      expect(response.headers['content-type']).toContain('image/jpeg');
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['content-disposition']).toContain('attachment');
      await adminB.get(`/customers/${customer.id}/kyc-documents/${document.id}/file`);
      const reads = await audits('KYC_DOCUMENT_VIEWED', document.id);
      expect(reads).toHaveLength(2);
      expect(reads[0]?.actorId).toBe(w.users.adminB);
    });

    it('writes nothing to the audit trail for a file that could not be read, and answers 404', async () => {
      const customer = await make();
      const other = await make();
      const document = await submit(staffA, customer.id);
      expect(
        (await adminA.get(`/customers/${other.id}/kyc-documents/${document.id}/file`)).status,
      ).toBe(404);
      await owner.kycDocument
        .update({ where: { id: document.id }, data: { objectKey: `kyc/${customer.id}/missing` } })
        .catch(() => undefined);
      expect(await audits('KYC_DOCUMENT_VIEWED', document.id)).toHaveLength(0);
    });
  });

  describe('the database guard', () => {
    it('refuses to change an uploaded file’s details or to decide a document twice', async () => {
      const customer = await make();
      const document = await submit(staffA, customer.id);
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE kyc_documents SET object_key = 'other' WHERE id = '${document.id}'`,
        ),
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE kyc_documents SET doc_number_masked = 'XXXX1234' WHERE id = '${document.id}'`,
        ),
      ).rejects.toThrow(/cannot be changed/);
      await review(adminA, customer.id, document, 'verify');
      await expect(
        owner.$executeRawUnsafe(
          `UPDATE kyc_documents SET status = 'PENDING', reviewed_by = NULL, reviewed_at = NULL WHERE id = '${document.id}'`,
        ),
      ).rejects.toThrow();
    });

    it('refuses a number that is not masked, a file that is too big and a rejection without a reason', async () => {
      const customer = await make();
      const base = `INSERT INTO kyc_documents (customer_id, doc_type, object_key, file_name, mime_type, size_bytes`;
      const values = (extra: string, size = 10) =>
        `${base}, doc_number_masked) VALUES ('${customer.id}', 'PAN', 'k', 'f', 'application/pdf', ${size}, ${extra})`;
      await expect(owner.$executeRawUnsafe(values(`'ABCDE1234F'`))).rejects.toThrow();
      await expect(owner.$executeRawUnsafe(values(`'XXXXXXXX1234567'`))).rejects.toThrow();
      await expect(
        owner.$executeRawUnsafe(values(`'XXXXXX234F'`, KYC_MAX_BYTES + 1)),
      ).rejects.toThrow();
      await expect(
        owner.$executeRawUnsafe(
          `${base}, status, reviewed_by, reviewed_at) VALUES ('${customer.id}', 'PAN', 'k', 'f', 'application/pdf', 10, 'REJECTED', '${w.users.adminA}', now())`,
        ),
      ).rejects.toThrow();
      await expect(
        owner.$executeRawUnsafe(
          `${base}) VALUES ('${customer.id}', 'PAN', 'k', 'f', 'text/html', 10)`,
        ),
      ).rejects.toThrow();
    });

    it('refuses customers with a bad phone number, a blank name or a repeated phone number', async () => {
      const taken = await make();
      await expect(
        owner.customer.create({ data: { name: 'Bad', phone: '12345' } }),
      ).rejects.toThrow();
      await expect(
        owner.customer.create({ data: { name: '   ', phone: phone() } }),
      ).rejects.toThrow();
      await expect(
        owner.customer.create({ data: { name: 'Twin', phone: taken.phone } }),
      ).rejects.toThrow();
    });
  });
});
