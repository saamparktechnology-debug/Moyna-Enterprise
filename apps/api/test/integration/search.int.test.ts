import type { NestExpressApplication } from '@nestjs/platform-express';
import { SearchResponseSchema } from '@erp/contracts';
import type { SearchResponse } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('global search', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminB: TestClient;
  let customersOnly: TestClient;
  const owner = createOwnerPrisma();
  let invoiceNoA = '';
  let invoiceNoB = '';

  const find = async (client: TestClient, query: string): Promise<SearchResponse> => {
    const response = await client.get(`/search?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return SearchResponseSchema.parse(response.body);
  };
  const titles = (result: SearchResponse, type: string): string[] =>
    result.results.filter((row) => row.type === type).map((row) => row.title);

  beforeAll(async () => {
    app = await createTestApp();
    w = await createAuthWorld(owner);
    superAdmin = await loggedIn(app, 'superadmin', 'super admin passphrase 42');
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');

    invoiceNoA = (await owner.invoice.findUniqueOrThrow({ where: { id: w.invoiceA } })).invoiceNo!;
    invoiceNoB = (await owner.invoice.findUniqueOrThrow({ where: { id: w.invoiceB } })).invoiceNo!;
    await owner.itemBarcode.create({ data: { itemId: w.itemId, barcode: '8901234567890' } });
    await owner.customer.createMany({
      data: [
        { name: 'Meera Patel', phone: '9810000001', stateCode: '27' },
        { name: 'Patel Traders', phone: '9810000002', stateCode: '27' },
        { name: 'Anil Kumar', phone: '9820000003', stateCode: '27' },
        { name: '100% Cotton', phone: '9830000004', stateCode: '27' },
      ],
    });
    const role = await owner.role.create({
      data: { name: 'CUSTOMERS_ONLY', tier: 'STAFF', description: 'customers only' },
    });
    await owner.rolePermission.create({
      data: {
        roleId: role.id,
        permissionId: (
          await owner.permission.findFirstOrThrow({ where: { code: 'customers.view' } })
        ).id,
      },
    });
    await owner.user.create({
      data: {
        username: 'cust_only',
        email: 'cust_only@example.com',
        fullName: 'Customers Only',
        passwordHash: (await owner.user.findFirstOrThrow({ where: { username: 'staff_a' } }))
          .passwordHash,
        userRoles: { create: { roleId: role.id } },
        userBranches: { create: { branchId: w.branchA } },
      },
    });
    customersOnly = await loggedIn(app, 'cust_only');
  });

  describe('what it finds', () => {
    it('finds an item by its exact barcode, and says so', async () => {
      const result = await find(adminA, 'q=8901234567890&types=item');
      expect(result.results).toHaveLength(1);
      expect(result.results[0]).toMatchObject({
        type: 'ITEM',
        id: w.itemId,
        matchedOn: 'BARCODE',
        exact: true,
        link: '/items',
      });
      expect(result.results[0]?.subtitle).toContain('8901234567890');
    });

    it('finds an item by part of its code or name, case-insensitively, exact code first', async () => {
      const byCode = await find(adminA, 'q=toto-1&types=item');
      expect(byCode.results[0]).toMatchObject({ matchedOn: 'ITEM_CODE', exact: true });
      const byName = await find(adminA, 'q=toto&types=item');
      expect(titles(byName, 'ITEM')[0]).toContain('TOTO-1');
    });

    it('finds a serial number exactly or in part, with its state and branch', async () => {
      const exact = await find(superAdmin, 'q=sn-a-1&types=serial');
      expect(exact.results[0]).toMatchObject({
        type: 'SERIAL',
        title: 'SN-A-1',
        exact: true,
        branchCode: 'AA',
        link: '/inventory',
      });
      expect(exact.results[0]?.subtitle).toContain('TOTO-1');
      const partial = await find(superAdmin, 'q=SN-&types=serial');
      expect(titles(partial, 'SERIAL').sort()).toEqual(['SN-A-1', 'SN-B-1']);
      expect(partial.results.every((row) => row.exact === false)).toBe(true);
    });

    it('finds an invoice by its whole number or the end of it', async () => {
      const whole = await find(adminA, `q=${encodeURIComponent(invoiceNoA)}&types=invoice`);
      expect(whole.results).toHaveLength(1);
      expect(whole.results[0]).toMatchObject({
        type: 'INVOICE',
        id: w.invoiceA,
        exact: true,
        matchedOn: 'INVOICE_NO',
        branchCode: 'AA',
        link: '/sales',
      });
      expect(whole.results[0]?.subtitle).toContain('Ravi');
      expect(whole.results[0]?.subtitle).toContain('₹105.00');
      const tail = await find(
        adminA,
        `q=${encodeURIComponent(invoiceNoA.slice(-5))}&types=invoice`,
      );
      expect(tail.results.map((row) => row.id)).toContain(w.invoiceA);
    });

    it('finds a customer by name in any case, and by phone in whole or in part', async () => {
      const byName = await find(adminA, 'q=patel&types=customer');
      expect(titles(byName, 'CUSTOMER').sort()).toEqual(['Meera Patel', 'Patel Traders']);
      expect(byName.results.every((row) => row.matchedOn === 'NAME')).toBe(true);
      const byPhone = await find(adminA, 'q=9820000003&types=customer');
      expect(byPhone.results).toHaveLength(1);
      expect(byPhone.results[0]).toMatchObject({
        title: 'Anil Kumar',
        matchedOn: 'PHONE',
        exact: true,
        subtitle: '9820000003',
      });
      const partial = await find(adminA, 'q=981000&types=customer');
      expect(titles(partial, 'CUSTOMER').sort()).toEqual(['Meera Patel', 'Patel Traders']);
    });

    it('searches every kind at once, in a fixed order', async () => {
      const result = await find(superAdmin, 'q=ra');
      expect(result.searched).toEqual(['ITEM', 'SERIAL', 'INVOICE', 'CUSTOMER']);
      const order = result.results.map((row) => row.type);
      expect(order).toEqual(
        [...order].sort(
          (x, y) =>
            ['ITEM', 'SERIAL', 'INVOICE', 'CUSTOMER'].indexOf(x) -
            ['ITEM', 'SERIAL', 'INVOICE', 'CUSTOMER'].indexOf(y),
        ),
      );
    });

    it('treats percent signs and underscores as plain characters', async () => {
      const percent = await find(adminA, 'q=100%25&types=customer');
      expect(titles(percent, 'CUSTOMER')).toEqual(['100% Cotton']);
      const wildcard = await find(adminA, 'q=%25%25&types=customer');
      expect(titles(wildcard, 'CUSTOMER')).toEqual([]);
      const underscore = await find(superAdmin, 'q=SN_A&types=serial');
      expect(underscore.results).toEqual([]);
    });

    it('returns nothing, not an error, for something that is not there', async () => {
      const result = await find(superAdmin, 'q=zzzzzzzz');
      expect(result.results).toEqual([]);
    });

    it('limits how many of each kind come back', async () => {
      const result = await find(adminA, 'q=patel&types=customer&limit=1');
      expect(result.results).toHaveLength(1);
    });
  });

  describe('who sees what', () => {
    it("keeps a branch user to their own branch's serial numbers and invoices", async () => {
      const serial = await find(adminA, 'q=SN-&types=serial');
      expect(titles(serial, 'SERIAL')).toEqual(['SN-A-1']);
      const other = await find(adminA, `q=${encodeURIComponent(invoiceNoB)}&types=invoice`);
      expect(other.results).toEqual([]);
      const own = await find(adminB, `q=${encodeURIComponent(invoiceNoB)}&types=invoice`);
      expect(own.results.map((row) => row.id)).toEqual([w.invoiceB]);
    });

    it('searches only the kinds the user may view', async () => {
      const result = await find(customersOnly, 'q=patel');
      expect(result.searched).toEqual(['CUSTOMER']);
      expect(titles(result, 'CUSTOMER')).toHaveLength(2);
      const asked = await find(customersOnly, 'q=SN-&types=serial,customer');
      expect(asked.searched).toEqual(['CUSTOMER']);
      expect(titles(asked, 'SERIAL')).toEqual([]);
    });

    it('answers 401 without a session', async () => {
      expect((await request(app.getHttpServer()).get('/search?q=abc')).status).toBe(401);
    });
  });

  describe('what it refuses', () => {
    const bad = async (query: string) => {
      const response = await adminA.get(`/search${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    };

    it('rejects a missing, one-character or oversized search', async () => {
      await bad('');
      await bad('?q=a');
      await bad('?q=%20%20');
      await bad(`?q=${'x'.repeat(101)}`);
    });

    it('rejects unknown kinds, unknown parameters and a bad limit', async () => {
      await bad('?q=abc&types=banana');
      await bad('?q=abc&extra=1');
      await bad('?q=abc&limit=0');
      await bad('?q=abc&limit=21');
    });

    it('is not fooled by a hostile search', async () => {
      const result = await find(adminA, `q=${encodeURIComponent("x'; DROP TABLE invoices;--")}`);
      expect(result.results).toEqual([]);
      expect(await owner.invoice.count()).toBeGreaterThan(0);
    });
  });

  describe('sorting a list', () => {
    it('puts transfers in opposite orders for ascending and descending', async () => {
      const asc = await superAdmin.get('/transfers?sortBy=transferNo&sortOrder=asc');
      const desc = await superAdmin.get('/transfers?sortBy=transferNo&sortOrder=desc');
      const numbers = (body: { items: { transferNo: string }[] }) =>
        body.items.map((row) => row.transferNo);
      expect(numbers(asc.body)).toEqual([...numbers(asc.body)].sort());
      expect(numbers(desc.body)).toEqual([...numbers(asc.body)].reverse());
      expect(numbers(asc.body).length).toBeGreaterThan(1);
    });
  });
});
