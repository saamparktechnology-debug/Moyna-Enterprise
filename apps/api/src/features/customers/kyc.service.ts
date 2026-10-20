import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  KYC_MAX_BYTES,
  KycUploadQuerySchema,
  RejectKycRequestSchema,
  VerifyKycRequestSchema,
  computeKycStatus,
  documentNumberProblem,
  maskDocumentNumber,
} from '@erp/contracts';
import type { KycDocument, KycMime, KycOverview, KycStatusName } from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import { STORAGE_SERVICE } from '../../common/storage/storage.service.js';
import type { StorageService } from '../../common/storage/storage.service.js';
import type { AuthContext } from '../auth/auth.types.js';

const EXTENSIONS: Record<KycMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};
const REPLACED_REASON = 'Replaced by a newer upload';

const DOCUMENT_INCLUDE = { documentType: true, reviewer: true } satisfies Prisma.KycDocumentInclude;
type DocumentRow = Prisma.KycDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

/** What a file really is, from its first bytes. The name and the declared type are not trusted. */
export function detectKycMime(bytes: Buffer): KycMime | null {
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-')
    return 'application/pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  return null;
}

export interface UploadInput {
  query: unknown;
  body: unknown;
  declaredType: string | undefined;
  documentNumber: string | undefined;
}

export interface KycFile {
  body: Buffer;
  contentType: string;
  fileName: string;
}

@Injectable()
export class KycService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  async overview(customerId: string): Promise<KycOverview> {
    const customer = await this.prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new NotFoundError('Customer', customerId);
    const rows = await this.prisma.kycDocument.findMany({
      where: { customerId },
      include: DOCUMENT_INCLUDE,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const uploaders = await this.prisma.user.findMany({
      where: { id: { in: rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])) } },
      select: { id: true, fullName: true },
    });
    const names = new Map(uploaders.map((user) => [user.id, user.fullName]));
    const seen = new Set<string>();
    return {
      kycStatus: customer.kycStatus as KycStatusName,
      documents: rows.map((row) => {
        const isCurrent = !seen.has(row.docType);
        seen.add(row.docType);
        return this.toDto(
          row,
          isCurrent,
          row.createdBy ? (names.get(row.createdBy) ?? null) : null,
        );
      }),
    };
  }

  async upload(auth: AuthContext, customerId: string, input: UploadInput): Promise<KycDocument> {
    const query = KycUploadQuerySchema.parse(input.query);
    const bytes = this.fileBytes(input.body);
    const mimeType = this.checkFile(bytes, input.declaredType);
    const masked = this.maskNumber(query.docType, input.documentNumber);
    const type = await this.prisma.kycDocumentType.findFirst({
      where: { code: query.docType, isActive: true },
    });
    if (!type)
      throw new ValidationFailedError('Unknown document type', [
        { field: 'docType', message: 'Choose the kind of document from the list' },
      ]);

    const objectKey = `kyc/${customerId}/${randomUUID()}.${EXTENSIONS[mimeType]}`;
    let stored = false;
    try {
      const result = await this.transactions.run(async (tx) => {
        await this.lockCustomer(tx, customerId);
        const latest = await tx.kycDocument.findFirst({
          where: { customerId, docType: query.docType },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (latest?.status === 'VERIFIED')
          throw new BusinessRuleError('This kind of document is already verified', [
            { field: 'docType', message: 'A verified document of this kind is on file' },
          ]);
        if (latest?.status === 'PENDING')
          await tx.kycDocument.update({
            where: { id: latest.id },
            data: {
              status: 'REJECTED',
              rejectionReason: REPLACED_REASON,
              reviewedBy: auth.userId,
              reviewedAt: new Date(),
              updatedBy: auth.userId,
            },
          });
        const row = await tx.kycDocument.create({
          data: {
            customerId,
            docType: query.docType,
            objectKey,
            status: 'PENDING',
            fileName: query.fileName,
            mimeType,
            sizeBytes: bytes.length,
            docNumberMasked: masked,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
          include: DOCUMENT_INCLUDE,
        });
        await this.storage.put(objectKey, bytes, mimeType);
        stored = true;
        const status = await this.refreshCustomerStatus(tx, customerId, auth.userId);
        await this.audit.record(tx, {
          action: 'KYC_DOCUMENT_UPLOADED',
          entityType: 'KycDocument',
          entityId: row.id,
          newValue: {
            customerId,
            docType: row.docType,
            fileName: row.fileName,
            sizeBytes: row.sizeBytes,
            replacedPending: latest?.status === 'PENDING',
            customerKycStatus: status,
          },
        });
        return row;
      });
      return this.toDto(result, true, null);
    } catch (error) {
      if (stored) await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  /** Reads a file. Every read is written to the audit log with who looked at which document. */
  async download(auth: AuthContext, customerId: string, documentId: string): Promise<KycFile> {
    const row = await this.prisma.kycDocument.findFirst({
      where: { id: documentId, customerId },
    });
    if (!row) throw new NotFoundError('KYC document', documentId);
    const object = await this.storage.get(row.objectKey);
    if (!object) throw new NotFoundError('The stored file');
    await this.transactions.run((tx) =>
      this.audit.record(tx, {
        action: 'KYC_DOCUMENT_VIEWED',
        entityType: 'KycDocument',
        entityId: row.id,
        newValue: { customerId, docType: row.docType, fileName: row.fileName },
      }),
    );
    return { body: object.body, contentType: row.mimeType, fileName: row.fileName };
  }

  async verify(
    auth: AuthContext,
    customerId: string,
    documentId: string,
    body: unknown,
  ): Promise<KycDocument> {
    const input = VerifyKycRequestSchema.parse(body);
    return this.decide(auth, customerId, documentId, input.rowVersion, { status: 'VERIFIED' });
  }

  async reject(
    auth: AuthContext,
    customerId: string,
    documentId: string,
    body: unknown,
  ): Promise<KycDocument> {
    const input = RejectKycRequestSchema.parse(body);
    return this.decide(auth, customerId, documentId, input.rowVersion, {
      status: 'REJECTED',
      reason: input.reason,
    });
  }

  private async decide(
    auth: AuthContext,
    customerId: string,
    documentId: string,
    rowVersion: number,
    decision: { status: 'VERIFIED' } | { status: 'REJECTED'; reason: string },
  ): Promise<KycDocument> {
    return this.transactions.run(async (tx) => {
      await this.lockCustomer(tx, customerId);
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM kyc_documents WHERE id = ${documentId}::uuid AND customer_id = ${customerId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('KYC document', documentId);
      const current = await tx.kycDocument.findUniqueOrThrow({ where: { id: documentId } });
      if (current.rowVersion !== rowVersion)
        throw new ConflictError(
          'This document was changed by someone else. Reload it and try again',
        );
      if (current.status !== 'PENDING')
        throw new InvalidStateError('The document', current.status, decision.status);
      if (decision.status === 'VERIFIED' && current.createdBy === auth.userId && !auth.isSuperAdmin)
        throw new ForbiddenError(
          'You cannot verify a document you uploaded. Ask another reviewer to verify it',
        );
      await tx.kycDocument.update({
        where: { id: documentId },
        data: {
          status: decision.status,
          reviewedBy: auth.userId,
          reviewedAt: new Date(),
          rejectionReason: decision.status === 'REJECTED' ? decision.reason : null,
          updatedBy: auth.userId,
        },
      });
      const customerStatus = await this.refreshCustomerStatus(tx, customerId, auth.userId);
      const row = await tx.kycDocument.findUniqueOrThrow({
        where: { id: documentId },
        include: DOCUMENT_INCLUDE,
      });
      await this.audit.record(tx, {
        action: decision.status === 'VERIFIED' ? 'KYC_DOCUMENT_VERIFIED' : 'KYC_DOCUMENT_REJECTED',
        entityType: 'KycDocument',
        entityId: documentId,
        oldValue: { status: 'PENDING' },
        newValue: {
          status: decision.status,
          customerId,
          docType: row.docType,
          customerKycStatus: customerStatus,
          ...(decision.status === 'REJECTED' ? { reason: decision.reason } : {}),
        },
      });
      const uploader = row.createdBy
        ? await tx.user.findUnique({ where: { id: row.createdBy }, select: { fullName: true } })
        : null;
      return this.toDto(row, true, uploader?.fullName ?? null);
    });
  }

  /** Works out the customer's status from the latest document of each kind and stores it. */
  private async refreshCustomerStatus(
    tx: TxClient,
    customerId: string,
    userId: string,
  ): Promise<KycStatusName> {
    const rows = await tx.kycDocument.findMany({
      where: { customerId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { docType: true, status: true },
    });
    const seen = new Set<string>();
    const current = rows.filter((row) => {
      if (seen.has(row.docType)) return false;
      seen.add(row.docType);
      return true;
    });
    const status = computeKycStatus(
      current.map((row) => ({ docType: row.docType, status: row.status as KycStatusName })),
    );
    await tx.customer.update({
      where: { id: customerId },
      data: { kycStatus: status, updatedBy: userId },
    });
    return status;
  }

  private async lockCustomer(tx: TxClient, customerId: string): Promise<void> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Customer', customerId);
  }

  private fileBytes(body: unknown): Buffer {
    if (!Buffer.isBuffer(body) || body.length === 0)
      throw new ValidationFailedError('No file was sent', [
        { field: 'file', message: 'Choose a PDF, JPEG or PNG file' },
      ]);
    if (body.length > KYC_MAX_BYTES)
      throw new ValidationFailedError('The file is too large', [
        { field: 'file', message: 'The file is larger than 5 MB' },
      ]);
    return body;
  }

  private checkFile(bytes: Buffer, declaredType: string | undefined): KycMime {
    const detected = detectKycMime(bytes);
    if (!detected || (declaredType && declaredType.split(';')[0]?.trim() !== detected))
      throw new ValidationFailedError('The file is not a PDF, JPEG or PNG', [
        { field: 'file', message: 'Upload a PDF, JPEG or PNG file' },
      ]);
    return detected;
  }

  private maskNumber(docType: string, raw: string | undefined): string | null {
    if (raw === undefined || raw.trim() === '') return null;
    const problem = documentNumberProblem(docType, raw);
    if (problem)
      throw new ValidationFailedError('The document number is not valid', [
        { field: 'docNumber', message: problem },
      ]);
    return maskDocumentNumber(raw);
  }

  private toDto(row: DocumentRow, isCurrent: boolean, uploadedByName: string | null): KycDocument {
    return {
      id: row.id,
      customerId: row.customerId,
      docType: row.docType,
      docTypeName: row.documentType.name,
      status: row.status as KycStatusName,
      fileName: row.fileName,
      mimeType: row.mimeType as KycMime,
      sizeBytes: row.sizeBytes,
      docNumberMasked: row.docNumberMasked,
      uploadedByName,
      uploadedAt: row.createdAt.toISOString(),
      reviewedByName: row.reviewer?.fullName ?? null,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      rejectionReason: row.rejectionReason,
      isCurrent,
      rowVersion: row.rowVersion,
    };
  }
}
