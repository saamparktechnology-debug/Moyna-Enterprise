import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateDuePromiseRequestSchema,
  GuarantorKycUploadQuerySchema,
  SetGuarantorRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type { DuePromise, DuePromiseListResponse, GuarantorResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import { STORAGE_SERVICE } from '../../common/storage/storage.service.js';
import type { StorageService } from '../../common/storage/storage.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { FILE_EXTENSIONS, checkUploadedFile } from '../brokers/uploads.js';
import type { BrokerStoredFile } from '../brokers/brokers.service.js';
import { isoDate, parseIsoDate, userNames } from '../hr/hr.shared.js';
import { balancesSql } from './balances.js';

export interface GuarantorFileInput {
  query: unknown;
  body: unknown;
  declaredType: string | undefined;
}

type GuarantorRow = Prisma.InvoiceGuarantorGetPayload<object>;

const toGuarantor = (row: GuarantorRow): GuarantorResponse => ({
  guarantor: {
    invoiceId: row.invoiceId,
    name: row.name,
    phone: row.phone,
    address: row.address,
    relation: row.relation,
    kyc:
      row.kycObjectKey && row.kycFileName && row.kycMimeType && row.kycSizeBytes
        ? { fileName: row.kycFileName, mimeType: row.kycMimeType, sizeBytes: row.kycSizeBytes }
        : null,
    rowVersion: row.rowVersion,
  },
});

/**
 * What a customer promises on an invoice that is not paid (the next promised date, with the earlier promises kept as a
 * history) and the guarantor of that invoice: contact details, and optionally one KYC file. Promises and guarantor
 * details can be noted only while something is still owed on the invoice.
 */
@Injectable()
export class DueFollowupService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // ---------- promised dates ----------

  async listPromises(invoiceId: string): Promise<DuePromiseListResponse> {
    return this.transactions.run(async (tx) => {
      await this.assertInvoice(tx, invoiceId);
      const rows = await tx.duePromise.findMany({
        where: { invoiceId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
      });
      const names = await userNames(
        tx,
        rows.map((row) => row.createdBy),
      );
      return {
        items: rows.map((row): DuePromise => ({
          id: row.id,
          invoiceId: row.invoiceId,
          promisedDate: isoDate(row.promisedDate),
          note: row.note,
          createdAt: row.createdAt.toISOString(),
          createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
        })),
      };
    });
  }

  /** Notes the date the customer promised to pay. The latest promise is the next promised date. */
  async addPromise(
    auth: AuthContext,
    invoiceId: string,
    body: unknown,
  ): Promise<DuePromiseListResponse> {
    const input = CreateDuePromiseRequestSchema.parse(body);
    if (input.promisedDate < todayInIndia())
      throw new ValidationFailedError('That date has passed', [
        { field: 'promisedDate', message: 'The promised date cannot be in the past' },
      ]);
    await this.transactions.run(async (tx) => {
      const invoice = await this.openInvoice(tx, invoiceId);
      const row = await tx.duePromise.create({
        data: {
          branchId: invoice.branchId,
          invoiceId,
          promisedDate: parseIsoDate(input.promisedDate),
          note: input.note ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'DUE_PROMISE_ADDED',
        entityType: 'Invoice',
        entityId: invoiceId,
        branchId: invoice.branchId,
        newValue: {
          promiseId: row.id,
          promisedDate: input.promisedDate,
          outstanding: invoice.outstanding,
        },
      });
    });
    return this.listPromises(invoiceId);
  }

  // ---------- the guarantor ----------

  async getGuarantor(invoiceId: string): Promise<GuarantorResponse> {
    return this.transactions.run(async (tx) => {
      await this.assertInvoice(tx, invoiceId);
      const row = await tx.invoiceGuarantor.findUnique({ where: { invoiceId } });
      return row ? toGuarantor(row) : { guarantor: null };
    });
  }

  /** Notes the guarantor of an invoice, or replaces their details (the KYC file stays). */
  async setGuarantor(
    auth: AuthContext,
    invoiceId: string,
    body: unknown,
  ): Promise<GuarantorResponse> {
    const input = SetGuarantorRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const invoice = await this.openInvoice(tx, invoiceId);
      const existing = await tx.invoiceGuarantor.findUnique({ where: { invoiceId } });
      if (existing && input.rowVersion !== existing.rowVersion)
        throw new ConflictError('The guarantor was changed by someone else. Reload and try again');
      const data = {
        name: input.name,
        phone: input.phone,
        address: input.address ?? null,
        relation: input.relation ?? null,
        updatedBy: auth.userId,
      };
      const row = existing
        ? await tx.invoiceGuarantor.update({ where: { invoiceId }, data })
        : await tx.invoiceGuarantor.create({
            data: { ...data, branchId: invoice.branchId, invoiceId, createdBy: auth.userId },
          });
      // The audit trail holds the name only: the phone and address are for those who may open the invoice.
      await this.audit.record(tx, {
        action: 'GUARANTOR_SET',
        entityType: 'Invoice',
        entityId: invoiceId,
        branchId: invoice.branchId,
        ...(existing ? { oldValue: { name: existing.name } } : {}),
        newValue: { name: input.name, replaced: existing !== null },
      });
      return toGuarantor(row);
    });
  }

  async removeGuarantor(auth: AuthContext, invoiceId: string): Promise<GuarantorResponse> {
    let removedKey: string | null = null;
    await this.transactions.run(async (tx) => {
      await this.assertInvoice(tx, invoiceId);
      const row = await tx.invoiceGuarantor.findUnique({ where: { invoiceId } });
      if (!row) throw new NotFoundError('Guarantor');
      removedKey = row.kycObjectKey;
      await tx.invoiceGuarantor.delete({ where: { invoiceId } });
      await this.audit.record(tx, {
        action: 'GUARANTOR_REMOVED',
        entityType: 'Invoice',
        entityId: invoiceId,
        branchId: row.branchId,
        oldValue: { name: row.name, hadKyc: row.kycObjectKey !== null },
      });
    });
    if (removedKey) await this.storage.delete(removedKey).catch(() => undefined);
    return { guarantor: null };
  }

  // ---------- the guarantor's KYC file (optional) ----------

  /** Sets the KYC file of the guarantor (a PDF, JPEG or PNG); a new one replaces the old. */
  async setKyc(
    auth: AuthContext,
    invoiceId: string,
    input: GuarantorFileInput,
  ): Promise<GuarantorResponse> {
    const query = GuarantorKycUploadQuerySchema.parse(input.query);
    const { bytes, mimeType } = checkUploadedFile(input.body, input.declaredType, true);
    const objectKey = `guarantors/${invoiceId}/${randomUUID()}.${FILE_EXTENSIONS[mimeType]}`;
    let stored = false;
    let replacedKey: string | null = null;
    try {
      const result = await this.transactions.run(async (tx) => {
        await this.assertInvoice(tx, invoiceId);
        const row = await tx.invoiceGuarantor.findUnique({ where: { invoiceId } });
        if (!row)
          throw new BusinessRuleError('Add the guarantor first', [
            {
              field: 'file',
              message: 'Note the guarantor’s details before uploading their KYC file',
            },
          ]);
        await this.storage.put(objectKey, bytes, mimeType);
        stored = true;
        replacedKey = row.kycObjectKey;
        const updated = await tx.invoiceGuarantor.update({
          where: { invoiceId },
          data: {
            kycObjectKey: objectKey,
            kycFileName: query.fileName,
            kycMimeType: mimeType,
            kycSizeBytes: bytes.length,
            updatedBy: auth.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'GUARANTOR_KYC_SET',
          entityType: 'Invoice',
          entityId: invoiceId,
          branchId: row.branchId,
          newValue: {
            fileName: query.fileName,
            sizeBytes: bytes.length,
            replaced: replacedKey !== null,
          },
        });
        return toGuarantor(updated);
      });
      if (replacedKey) await this.storage.delete(replacedKey).catch(() => undefined);
      return result;
    } catch (error) {
      if (stored) await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  async removeKyc(auth: AuthContext, invoiceId: string): Promise<GuarantorResponse> {
    let removedKey: string | null = null;
    const result = await this.transactions.run(async (tx) => {
      await this.assertInvoice(tx, invoiceId);
      const row = await tx.invoiceGuarantor.findUnique({ where: { invoiceId } });
      if (!row?.kycObjectKey) throw new NotFoundError('Guarantor KYC file');
      removedKey = row.kycObjectKey;
      const updated = await tx.invoiceGuarantor.update({
        where: { invoiceId },
        data: {
          kycObjectKey: null,
          kycFileName: null,
          kycMimeType: null,
          kycSizeBytes: null,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'GUARANTOR_KYC_REMOVED',
        entityType: 'Invoice',
        entityId: invoiceId,
        branchId: row.branchId,
        oldValue: { fileName: row.kycFileName },
      });
      return toGuarantor(updated);
    });
    if (removedKey) await this.storage.delete(removedKey).catch(() => undefined);
    return result;
  }

  /** The KYC file itself. Who opened it is recorded. */
  async kycFile(invoiceId: string): Promise<BrokerStoredFile> {
    const row = await this.transactions.run(async (tx) => {
      await this.assertInvoice(tx, invoiceId);
      const found = await tx.invoiceGuarantor.findUnique({ where: { invoiceId } });
      if (!found?.kycObjectKey || !found.kycMimeType || !found.kycFileName)
        throw new NotFoundError('Guarantor KYC file');
      await this.audit.record(tx, {
        action: 'GUARANTOR_KYC_VIEWED',
        entityType: 'Invoice',
        entityId: invoiceId,
        branchId: found.branchId,
        newValue: { fileName: found.kycFileName },
      });
      return { key: found.kycObjectKey, mime: found.kycMimeType, name: found.kycFileName };
    });
    const object = await this.storage.get(row.key);
    if (!object) throw new NotFoundError('The stored file');
    return { body: object.body, contentType: row.mime, fileName: row.name };
  }

  // ---------- helpers ----------

  /** The invoice must exist and be issued; the caller's branch scope applies. */
  private async assertInvoice(tx: TxClient, invoiceId: string): Promise<void> {
    const found = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { id: true, status: true },
    });
    if (!found || found.status !== 'ISSUED') throw new NotFoundError('Invoice', invoiceId);
  }

  /** The invoice, when something is still owed on it. */
  private async openInvoice(
    tx: TxClient,
    invoiceId: string,
  ): Promise<{ branchId: string; outstanding: string }> {
    const rows = await tx.$queryRaw<{ branch_id: string; outstanding: string }[]>(Prisma.sql`
      SELECT b.branch_id, b.outstanding FROM (${balancesSql(Prisma.sql`i.id = ${invoiceId}::uuid`)}) b`);
    const row = rows[0];
    if (!row) throw new NotFoundError('Invoice', invoiceId);
    if (Number(row.outstanding) <= 0)
      throw new BusinessRuleError('Nothing is due on this invoice', [
        { field: 'invoiceId', message: 'This invoice is fully paid' },
      ]);
    return { branchId: row.branch_id, outstanding: row.outstanding };
  }
}
