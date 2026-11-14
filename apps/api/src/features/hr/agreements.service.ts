import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  AgreementListQuerySchema,
  CreateAgreementRequestSchema,
  CreateAgreementTemplateRequestSchema,
  DiscardAgreementRequestSchema,
  EndAgreementRequestSchema,
  SignedCopyQuerySchema,
  UpdateAgreementRequestSchema,
  UpdateAgreementTemplateRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type {
  Agreement,
  AgreementListResponse,
  AgreementTemplate,
  AgreementTemplateListResponse,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import { STORAGE_SERVICE } from '../../common/storage/storage.service.js';
import type { StorageService } from '../../common/storage/storage.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { invoiceNumberAt } from '../billing/invoice-number.js';
import { inr } from '../billing/pdf-kit.js';
import { FILE_EXTENSIONS, checkUploadedFile } from '../brokers/uploads.js';
import { loadCompanyProfile } from '../settings/company-profile.js';
import { buildAgreementPdf } from './agreement-pdf.js';
import { loadHrSettings } from './hr-settings.js';
import { isManager, isoDate, ownStaffId, parseIsoDate, userNames } from './hr.shared.js';

const INCLUDE = {
  staff: { include: { user: { select: { fullName: true } }, branch: { select: { code: true } } } },
  template: { select: { name: true } },
} satisfies Prisma.StaffAgreementInclude;
type Row = Prisma.StaffAgreementGetPayload<{ include: typeof INCLUDE }>;

export interface AgreementStoredFile {
  body: Buffer;
  contentType: string;
  fileName: string;
}

const dmy = (value: Date): string => {
  const iso = isoDate(value);
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
};

function toDto(row: Row, recordedBy: string | null): Agreement {
  return {
    id: row.id,
    agreementNo: row.agreementNo,
    staffId: row.staffId,
    staffName: row.staff.user.fullName,
    employeeCode: row.staff.employeeCode,
    branchCode: row.staff.branch.code,
    templateId: row.templateId,
    templateName: row.template?.name ?? null,
    title: row.title,
    // A signed agreement shows the words that were signed, with the details filled in as they were that day.
    body: row.renderedBody ?? row.body,
    effectiveFrom: isoDate(row.effectiveFrom),
    status: row.status as Agreement['status'],
    signedOn: row.signedOn ? isoDate(row.signedOn) : null,
    hasSignedCopy: row.signedObjectKey !== null,
    signedFileName: row.signedFileName,
    employeeSigned: row.employeeSigned,
    adminSigned: row.adminSigned,
    recordedByName: recordedBy,
    endedOn: row.endedOn ? isoDate(row.endedOn) : null,
    endReason: row.endReason,
    createdAt: row.createdAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

/**
 * Employee agreements. A template holds editable terms and rules; an agreement is made for one employee and edited while it
 * is a draft; it is printed for the employee (left) and the Super Admin (right) to sign; the signed copy is uploaded as the
 * acceptance and the agreement is then frozen. A new signed agreement ends the one before it.
 */
@Injectable()
export class AgreementsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {}

  // ---------- templates ----------

  async listTemplates(): Promise<AgreementTemplateListResponse> {
    return this.transactions.run(async (tx) => {
      const rows = await tx.agreementTemplate.findMany({
        include: { _count: { select: { agreements: true } } },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      });
      return {
        items: rows.map((row) => ({
          id: row.id,
          name: row.name,
          body: row.body,
          isActive: row.isActive,
          agreementCount: row._count.agreements,
          updatedAt: row.updatedAt.toISOString(),
          rowVersion: row.rowVersion,
        })),
      };
    });
  }

  async createTemplate(auth: AuthContext, body: unknown): Promise<AgreementTemplate> {
    const input = CreateAgreementTemplateRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      try {
        const row = await tx.agreementTemplate.create({
          data: {
            name: input.name,
            body: input.body,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'AGREEMENT_TEMPLATE_CREATED',
          entityType: 'AgreementTemplate',
          entityId: row.id,
          newValue: { name: row.name },
        });
        return this.templateDto(tx, row.id);
      } catch (error) {
        throw this.duplicateName(error);
      }
    });
  }

  async updateTemplate(auth: AuthContext, id: string, body: unknown): Promise<AgreementTemplate> {
    const input = UpdateAgreementTemplateRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await tx.agreementTemplate.findUnique({ where: { id } });
      if (!current) throw new NotFoundError('Agreement template', id);
      if (current.rowVersion !== input.rowVersion)
        throw new ConflictError(
          'This template was changed by someone else. Reload it and try again',
        );
      try {
        await tx.agreementTemplate.update({
          where: { id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.body !== undefined ? { body: input.body } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            updatedBy: auth.userId,
          },
        });
      } catch (error) {
        throw this.duplicateName(error);
      }
      await this.audit.record(tx, {
        action: 'AGREEMENT_TEMPLATE_UPDATED',
        entityType: 'AgreementTemplate',
        entityId: id,
        oldValue: { name: current.name, isActive: current.isActive },
        newValue: {
          name: input.name ?? current.name,
          isActive: input.isActive ?? current.isActive,
        },
      });
      return this.templateDto(tx, id);
    });
  }

  // ---------- agreements ----------

  async list(auth: AuthContext, rawQuery: unknown): Promise<AgreementListResponse> {
    const query = AgreementListQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const rows = await tx.staffAgreement.findMany({
        where: {
          ...(query.staffId ? { staffId: query.staffId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        include: INCLUDE,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 500,
      });
      void auth;
      const names = await userNames(
        tx,
        rows.map((row) => row.recordedBy),
      );
      return {
        items: rows.map((row) =>
          toDto(row, row.recordedBy ? (names.get(row.recordedBy) ?? null) : null),
        ),
      };
    });
  }

  /** The signed and ended agreements of the person asking. A draft is not shown to the employee until it is signed. */
  async mine(auth: AuthContext): Promise<AgreementListResponse> {
    return this.transactions.run(async (tx) => {
      const staffId = await ownStaffId(tx, auth);
      if (!staffId) return { items: [] };
      const rows = await tx.staffAgreement.findMany({
        where: { staffId, status: { in: ['SIGNED', 'ENDED'] } },
        include: INCLUDE,
        orderBy: [{ signedOn: 'desc' }, { id: 'desc' }],
      });
      const names = await userNames(
        tx,
        rows.map((row) => row.recordedBy),
      );
      return {
        items: rows.map((row) =>
          toDto(row, row.recordedBy ? (names.get(row.recordedBy) ?? null) : null),
        ),
      };
    });
  }

  async create(auth: AuthContext, body: unknown): Promise<Agreement> {
    const input = CreateAgreementRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const staff = await tx.staff.findUnique({ where: { id: input.staffId } });
      if (!staff) throw new NotFoundError('Staff profile', input.staffId);
      let text = input.body;
      let title = input.title;
      let templateId: string | null = null;
      if (input.templateId) {
        const template = await tx.agreementTemplate.findUnique({ where: { id: input.templateId } });
        if (!template || !template.isActive)
          throw new ValidationFailedError('Choose a template that is in use', [
            { field: 'templateId', message: 'Choose a template that is in use' },
          ]);
        templateId = template.id;
        text = text ?? template.body;
        title = title ?? template.name;
      }
      if (!text)
        throw new ValidationFailedError('Write the terms', [
          { field: 'body', message: 'Write the terms' },
        ]);
      const agreementNo = await this.nextNumber(tx, staff.branchId);
      const row = await tx.staffAgreement.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          templateId,
          agreementNo,
          title: title ?? 'Employment agreement',
          body: text,
          effectiveFrom: parseIsoDate(input.effectiveFrom),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'AGREEMENT_CREATED',
        entityType: 'StaffAgreement',
        entityId: row.id,
        branchId: staff.branchId,
        newValue: {
          agreementNo,
          staffId: staff.id,
          templateId,
          effectiveFrom: input.effectiveFrom,
        },
      });
      return this.present(tx, row.id);
    });
  }

  /** Changes a draft: its title, terms or start date. */
  async update(auth: AuthContext, id: string, body: unknown): Promise<Agreement> {
    const input = UpdateAgreementRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['DRAFT'], 'changed');
      await tx.staffAgreement.update({
        where: { id },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.effectiveFrom !== undefined
            ? { effectiveFrom: parseIsoDate(input.effectiveFrom) }
            : {}),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'AGREEMENT_UPDATED',
        entityType: 'StaffAgreement',
        entityId: id,
        branchId: current.branchId,
        oldValue: {
          title: current.title,
          body: current.body,
          effectiveFrom: isoDate(current.effectiveFrom),
        },
        newValue: {
          title: input.title ?? current.title,
          body: input.body ?? current.body,
          effectiveFrom: input.effectiveFrom ?? isoDate(current.effectiveFrom),
        },
      });
      return this.present(tx, id);
    });
  }

  /** Throws a draft away, with the reason. It is kept in the list, marked discarded. */
  async discard(auth: AuthContext, id: string, body: unknown): Promise<Agreement> {
    const input = DiscardAgreementRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['DRAFT'], 'discarded');
      await tx.staffAgreement.update({
        where: { id },
        data: { status: 'DISCARDED', endReason: input.reason, updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'AGREEMENT_DISCARDED',
        entityType: 'StaffAgreement',
        entityId: id,
        branchId: current.branchId,
        newValue: { agreementNo: current.agreementNo, reason: input.reason },
      });
      return this.present(tx, id);
    });
  }

  /**
   * Records the acceptance: the printed agreement, signed by the employee (left) and the Super Admin (right), uploaded as a
   * PDF or a picture. The agreement is frozen as signed, with its terms filled in as they are today, and a signed agreement
   * that was in force before it ends the day before this one starts.
   */
  async recordSigned(
    auth: AuthContext,
    id: string,
    input: { query: unknown; body: unknown; declaredType: string | undefined },
  ): Promise<Agreement> {
    const query = SignedCopyQuerySchema.parse(input.query);
    const { bytes, mimeType } = checkUploadedFile(input.body, input.declaredType, true);
    const objectKey = `agreements/${id}/${randomUUID()}.${FILE_EXTENSIONS[mimeType]}`;
    let stored = false;
    try {
      return await this.transactions.run(async (tx) => {
        const current = await this.lock(tx, id, query.rowVersion);
        this.assertStatus(current.status, ['DRAFT'], 'signed');
        if (query.signedOn > todayInIndia())
          throw new ValidationFailedError('The signing date is in the future', [
            { field: 'signedOn', message: 'It cannot be in the future' },
          ]);
        const staff = current.staff;
        const company = await loadCompanyProfile(tx, staff.branch.code);
        const { dutyMinutes } = await loadHrSettings(tx);
        const rendered = this.render(current.body, current, company, dutyMinutes);
        await this.storage.put(objectKey, bytes, mimeType);
        stored = true;
        const before = await tx.staffAgreement.findFirst({
          where: { staffId: current.staffId, status: 'SIGNED', id: { not: id } },
        });
        if (before) {
          const dayBefore = new Date(current.effectiveFrom.getTime() - 86_400_000);
          const endedOn = dayBefore > before.effectiveFrom ? dayBefore : before.effectiveFrom;
          await tx.staffAgreement.update({
            where: { id: before.id },
            data: {
              status: 'ENDED',
              endedOn,
              endReason: `Replaced by agreement ${current.agreementNo}`,
              updatedBy: auth.userId,
            },
          });
        }
        await tx.staffAgreement.update({
          where: { id },
          data: {
            status: 'SIGNED',
            renderedBody: rendered,
            signedOn: parseIsoDate(query.signedOn),
            signedObjectKey: objectKey,
            signedFileName: query.fileName,
            signedMimeType: mimeType,
            signedSizeBytes: bytes.length,
            employeeSigned: true,
            adminSigned: true,
            recordedBy: auth.userId,
            updatedBy: auth.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'AGREEMENT_SIGNED',
          entityType: 'StaffAgreement',
          entityId: id,
          branchId: current.branchId,
          newValue: {
            agreementNo: current.agreementNo,
            signedOn: query.signedOn,
            fileName: query.fileName,
            sizeBytes: bytes.length,
            replaced: before?.agreementNo ?? null,
          },
        });
        return this.present(tx, id);
      });
    } catch (error) {
      if (stored) await this.storage.delete(objectKey).catch(() => undefined);
      throw error;
    }
  }

  /** Ends a signed agreement from a day, with the reason (for example, the employee left or the terms were replaced). */
  async end(auth: AuthContext, id: string, body: unknown): Promise<Agreement> {
    const input = EndAgreementRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['SIGNED'], 'ended');
      if (input.endedOn < isoDate(current.effectiveFrom))
        throw new ValidationFailedError('It cannot end before it started', [
          { field: 'endedOn', message: `It started on ${isoDate(current.effectiveFrom)}` },
        ]);
      await tx.staffAgreement.update({
        where: { id },
        data: {
          status: 'ENDED',
          endedOn: parseIsoDate(input.endedOn),
          endReason: input.reason,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'AGREEMENT_ENDED',
        entityType: 'StaffAgreement',
        entityId: id,
        branchId: current.branchId,
        newValue: {
          agreementNo: current.agreementNo,
          endedOn: input.endedOn,
          reason: input.reason,
        },
      });
      return this.present(tx, id);
    });
  }

  /** The agreement as a PDF to print and sign (for a draft) or to read (once signed). A manager, or the employee it is for. */
  async pdf(auth: AuthContext, id: string): Promise<{ body: Buffer; fileName: string }> {
    return this.transactions.run(async (tx) => {
      const row = await this.visible(tx, auth, id);
      const company = await loadCompanyProfile(tx, row.staff.branch.code);
      const { dutyMinutes } = await loadHrSettings(tx);
      const text = row.renderedBody ?? this.render(row.body, row, company, dutyMinutes);
      const body = buildAgreementPdf({
        company,
        agreementNo: row.agreementNo,
        title: row.title,
        effectiveFrom: dmy(row.effectiveFrom),
        employeeName: row.staff.user.fullName,
        employeeCode: row.staff.employeeCode,
        text,
      });
      return { body, fileName: `${row.agreementNo.replace(/[^A-Za-z0-9._-]/g, '-')}.pdf` };
    });
  }

  /** The uploaded signed copy. A manager, or the employee it is for. Viewing it is recorded in the audit trail. */
  async signedFile(auth: AuthContext, id: string): Promise<AgreementStoredFile> {
    const row = await this.transactions.run(async (tx) => {
      const found = await this.visible(tx, auth, id);
      if (!found.signedObjectKey || !found.signedMimeType || !found.signedFileName)
        throw new NotFoundError('The signed copy');
      await this.audit.record(tx, {
        action: 'AGREEMENT_COPY_VIEWED',
        entityType: 'StaffAgreement',
        entityId: id,
        branchId: found.branchId,
        newValue: { agreementNo: found.agreementNo },
      });
      return found;
    });
    const object = await this.storage.get(row.signedObjectKey as string);
    if (!object) throw new NotFoundError('The stored file');
    return {
      body: object.body,
      contentType: row.signedMimeType as string,
      fileName: row.signedFileName as string,
    };
  }

  // ---------- helpers ----------

  /** Fills the {{placeholders}} for this employee. A name that is not known (a text from before) is left empty. */
  private render(
    text: string,
    row: Row,
    company: { name: string; address: string | null; proprietor: string | null },
    dutyMinutes: number,
  ): string {
    const staff = row.staff;
    const salary =
      staff.salaryType === 'DAILY' && staff.dailyRate
        ? `Rs. ${inr(staff.dailyRate.toFixed(2))} a day for a full duty day (paid only for the work done)`
        : `Rs. ${inr(staff.monthlySalary.toFixed(2))} a month`;
    const values: Record<string, string> = {
      employee_name: staff.user.fullName,
      employee_code: staff.employeeCode,
      designation: staff.designation ?? '',
      department: staff.department ?? '',
      join_date: dmy(staff.joinDate),
      salary,
      duty_hours: String(dutyMinutes / 60),
      effective_from: dmy(row.effectiveFrom),
      company_name: company.name,
      company_address: company.address ?? '',
      proprietor: company.proprietor ?? '',
      today: dmy(new Date()),
    };
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, name: string) => values[name] ?? '');
  }

  private async present(tx: TxClient, id: string): Promise<Agreement> {
    const row = await tx.staffAgreement.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    const names = await userNames(tx, [row.recordedBy]);
    return toDto(row, row.recordedBy ? (names.get(row.recordedBy) ?? null) : null);
  }

  private async templateDto(tx: TxClient, id: string): Promise<AgreementTemplate> {
    const row = await tx.agreementTemplate.findUniqueOrThrow({
      where: { id },
      include: { _count: { select: { agreements: true } } },
    });
    return {
      id: row.id,
      name: row.name,
      body: row.body,
      isActive: row.isActive,
      agreementCount: row._count.agreements,
      updatedAt: row.updatedAt.toISOString(),
      rowVersion: row.rowVersion,
    };
  }

  private async lock(tx: TxClient, id: string, rowVersion: number): Promise<Row> {
    const rows = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT id FROM staff_agreements WHERE id = ${id}::uuid FOR UPDATE`,
    );
    if (rows.length === 0) throw new NotFoundError('Agreement', id);
    const row = await tx.staffAgreement.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    if (row.rowVersion !== rowVersion)
      throw new ConflictError(
        'This agreement was changed by someone else. Reload it and try again',
      );
    return row;
  }

  private assertStatus(status: string, allowed: string[], verb: string): void {
    if (!allowed.includes(status))
      throw new BusinessRuleError(`An agreement that is ${status.toLowerCase()} cannot be ${verb}`);
  }

  /** A manager sees any; an employee sees only their own signed agreements. */
  private async visible(tx: TxClient, auth: AuthContext, id: string): Promise<Row> {
    const row = await tx.staffAgreement.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundError('Agreement', id);
    if (isManager(auth)) return row;
    const own = await ownStaffId(tx, auth);
    if (!own || own !== row.staffId || !['SIGNED', 'ENDED'].includes(row.status))
      throw new ForbiddenError('You cannot open this agreement');
    return row;
  }

  /** Agreement numbers are AG and the date and time, taking the next free minute if one is used. */
  private async nextNumber(tx: TxClient, branchId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agreement-number:${branchId}`}))`;
    let when = new Date();
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const agreementNo = invoiceNumberAt('AG', when);
      const taken = await tx.staffAgreement.findFirst({
        where: { branchId, agreementNo },
        select: { id: true },
      });
      if (!taken) return agreementNo;
      when = new Date(when.getTime() + 60_000);
    }
    throw new BusinessRuleError('Could not find a free agreement number. Try again in a moment');
  }

  private duplicateName(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return new ConflictError('A template with this name already exists', [
        { field: 'name', message: 'Choose another name' },
      ]);
    return error;
  }
}
