//apps/api/test/integration/billing-tax-and-numbers.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { InvoiceSchema } from '@erp/contracts';
import type { Invoice } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const BRANCH_GSTIN = '27AAKCS7654H1ZG';
const BUYER_GSTIN = '27AAACB2230M1ZP';

describe('GST chosen on the bill, HSN rule and invoice numbers', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let staffA: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const newCode = (): string => String(60000000 + (counter += 1) * 11 + (Date.now() % 1000) * 1000);

  /** An item with no GST rate and no HSN code: the product decides nothing about the bill. */
  const bareItem = async (over: object = {}): Promise<string> => {
    const item = await owner.item.create({
      data: {
        itemCode: unique('TX'),
        name: 'Tax test item',
        categoryId,
        unitCode: 'PCS',
        isSerialized: false,
        ...over,
      },
    });
    await owner.stockBalance.create({
      data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 50 },
    });
    await owner.stockLedger.create({
      data: {
        branchId: w.branchA,
        itemId: item.id,
        state: 'AVAILABLE',
        qtyDelta: 50,
        movementType: 'OPENING_BALANCE',
      },
    });
    return item.id;
  };
  const buyer = async (gstin: string | null = null): Promise<string> =>
    (
      await owner.customer.create({
        data: {
          name: unique('Buyer '),
          phone: `7${(counter += 1).toString().padStart(9, '0')}`,
          gstin,
        },
      })
    ).id;
  const draft = async (
    customerId: string,
    type: 'GST' | 'NON_GST',
    line: Record<string, unknown>,
  ) =>
    staffA.post('/invoices', {
      customerId,
      type,
      lines: [{ qty: 1, unitPrice: '1000.00', ...line }],
    });
  const draftOk = async (
    customerId: string,
    type: 'GST' | 'NON_GST',
    line: Record<string, unknown>,
  ): Promise<Invoice> => {
    const response = await draft(customerId, type, line);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return InvoiceSchema.parse(response.body);
  };
  const issue = (invoice: Invoice) =>
    staffA.post(`/invoices/${invoice.id}/issue`, { rowVersion: invoice.rowVersion });
  const issued = async (invoice: Invoice): Promise<Invoice> => {
    const response = await issue(invoice);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return InvoiceSchema.parse(response.body);
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    await owner.branch.update({ where: { id: w.branchA }, data: { gstin: BRANCH_GSTIN } });
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('the type of the bill, not the product, decides GST', () => {
    it('bills GST on an item that has no GST rate, at the rate chosen on the line', async () => {
      const itemId = await bareItem();
      const invoice = await issued(
        await draftOk(await buyer(), 'GST', { itemId, taxRate: '18', hsnCode: '8703' }),
      );
      expect(invoice.lines[0]).toMatchObject({ taxRate: '18.00', hsnCode: '8703' });
      expect(
        Number(invoice.cgstAmount) + Number(invoice.sgstAmount) + Number(invoice.igstAmount),
      ).toBe(180);
      expect(invoice.total).toBe('1180.00');
    });

    it('lets the biller change the item’s own rate for this sale', async () => {
      const itemId = await bareItem({ taxRate: '5' });
      const invoice = await issued(await draftOk(await buyer(), 'GST', { itemId, taxRate: '12' }));
      expect(invoice.lines[0]?.taxRate).toBe('12.00');
      expect(invoice.total).toBe('1120.00');
    });

    it('starts from the item’s own rate and HSN code when the line says nothing', async () => {
      const itemId = await bareItem({ taxRate: '5', hsnCode: '8703' });
      const invoice = await draftOk(await buyer(), 'GST', { itemId });
      expect(invoice.lines[0]).toMatchObject({ taxRate: '5.00', hsnCode: '8703' });
    });

    it('asks for a rate when the line has none and the item has none', async () => {
      const itemId = await bareItem();
      const response = await draft(await buyer(), 'GST', { itemId });
      expect(response.status).toBe(400);
      expect(response.body.details[0]).toMatchObject({ field: 'lines.0.taxRate' });
      const none = await draft(await buyer(), 'GST', { itemId, taxRate: null });
      expect(none.status).toBe(400);
    });

    it('refuses a rate that is not one of the GST rates', async () => {
      const itemId = await bareItem();
      const response = await draft(await buyer(), 'GST', { itemId, taxRate: '7' });
      expect(response.status).toBe(400);
      expect(response.body.details[0]).toMatchObject({ field: 'lines.0.taxRate' });
    });

    it('charges no tax on a bill without GST, whatever the item says, and keeps no rate or HSN on it', async () => {
      const itemId = await bareItem({ taxRate: '18', hsnCode: '8703' });
      const invoice = await issued(
        await draftOk(await buyer(), 'NON_GST', { itemId, taxRate: '28', hsnCode: '8711' }),
      );
      expect(invoice.total).toBe('1000.00');
      expect(invoice.lines[0]).toMatchObject({ taxRate: null, hsnCode: null });
    });
  });

  describe('the HSN code', () => {
    it('is required to issue a GST invoice to a buyer with a GSTIN, but a draft may wait', async () => {
      const itemId = await bareItem();
      const created = await draftOk(await buyer(BUYER_GSTIN), 'GST', { itemId, taxRate: '18' });
      const refused = await issue(created);
      expect(refused.status).toBe(400);
      expect(refused.body.details[0]).toMatchObject({ field: 'lines.0.hsnCode' });
      const fixed = await staffA.patch(`/invoices/${created.id}`, {
        customerId: created.customerId,
        type: 'GST',
        lines: [{ itemId, qty: 1, unitPrice: '1000.00', taxRate: '18', hsnCode: '8703' }],
        rowVersion: created.rowVersion,
      });
      expect(fixed.status, JSON.stringify(fixed.body)).toBe(200);
      const done = await issued(InvoiceSchema.parse(fixed.body));
      expect(done.lines[0]?.hsnCode).toBe('8703');
    });

    it('is optional on a GST invoice to a buyer without a GSTIN', async () => {
      const itemId = await bareItem();
      const invoice = await issued(await draftOk(await buyer(), 'GST', { itemId, taxRate: '18' }));
      expect(invoice.lines[0]?.hsnCode).toBeNull();
    });

    it('takes a code that is not in the list yet and adds it', async () => {
      const code = newCode();
      const itemId = await bareItem();
      await issued(await draftOk(await buyer(), 'GST', { itemId, taxRate: '18', hsnCode: code }));
      const added = await owner.hsnCode.findUniqueOrThrow({ where: { code } });
      expect(added.gstRate?.toFixed(2)).toBe('18.00');
    });

    it('must be 4 to 8 digits', async () => {
      const itemId = await bareItem();
      for (const hsnCode of ['123', '123456789', '87AB']) {
        const response = await draft(await buyer(), 'GST', { itemId, taxRate: '18', hsnCode });
        expect(response.status, hsnCode).toBe(400);
      }
    });
  });

  describe('invoice numbers', () => {
    it('are the prefix and the date and time: ME-ddmmyyyyhhmm', async () => {
      const itemId = await bareItem();
      const invoice = await issued(await draftOk(await buyer(), 'NON_GST', { itemId }));
      expect(invoice.invoiceNo).toMatch(/^ME-\d{12}$/);
      const [day, month, year] = [
        invoice.invoiceNo?.slice(3, 5),
        invoice.invoiceNo?.slice(5, 7),
        invoice.invoiceNo?.slice(7, 11),
      ];
      expect(`${year}-${month}-${day}`).toBe(invoice.issuedOn);
    });

    it('stay unique when several are issued in the same minute', async () => {
      const itemId = await bareItem();
      const customer = await buyer();
      const drafts = await Promise.all(
        Array.from({ length: 5 }, () => draftOk(customer, 'NON_GST', { itemId })),
      );
      const numbers: string[] = [];
      for (const d of drafts) numbers.push((await issued(d)).invoiceNo ?? '');
      expect(new Set(numbers).size).toBe(5);
      expect(numbers.every((no) => /^ME-\d{12}$/.test(no))).toBe(true);
    });

    it('use the prefix from the company settings', async () => {
      const itemId = await bareItem();
      await owner.appSetting.upsert({
        where: { key: 'company.invoice_prefix' },
        update: { value: 'MZ' },
        create: { key: 'company.invoice_prefix', value: 'MZ' },
      });
      try {
        const invoice = await issued(await draftOk(await buyer(), 'NON_GST', { itemId }));
        expect(invoice.invoiceNo).toMatch(/^MZ-\d{12}$/);
      } finally {
        await owner.appSetting.delete({ where: { key: 'company.invoice_prefix' } });
      }
    });
  });
});
