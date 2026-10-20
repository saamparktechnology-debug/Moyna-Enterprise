import { Inject, Injectable } from '@nestjs/common';
import {
  AdvanceSeriesRequestSchema,
  DOCUMENT_SERIES_SORT_FIELDS,
  DocumentSeriesListQuerySchema,
  GST_DOCUMENT_NUMBER_MAX_LENGTH,
  MAX_SERIES_JUMP,
} from '@erp/contracts';
import type { DocumentSeries, DocumentSeriesListResponse } from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/domain-errors.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';

const NUMBER_PADDING = 5;

type Row = Prisma.DocumentSequenceGetPayload<{ include: { branch: true } }>;

const example = (row: Pick<Row, 'prefix' | 'financialYear'>, number: number): string =>
  `${row.prefix}/${row.financialYear.slice(2, 4)}${row.financialYear.slice(5, 7)}/${String(number).padStart(NUMBER_PADDING, '0')}`;

const toDto = (row: Row): DocumentSeries => ({
  id: row.id,
  branchId: row.branchId,
  branchCode: row.branch.code,
  docType: row.docType,
  financialYear: row.financialYear,
  prefix: row.prefix,
  nextNumber: row.nextNumber,
  nextExample: example(row, row.nextNumber),
  rowVersion: row.rowVersion,
});

/** The numbered series every document draws from. Numbers only ever move forward. */
@Injectable()
export class SeriesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(rawQuery: unknown): Promise<DocumentSeriesListResponse> {
    const query = DocumentSeriesListQuerySchema.parse(rawQuery);
    const where: Prisma.DocumentSequenceWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.docType ? { docType: query.docType } : {}),
      ...(query.financialYear ? { financialYear: query.financialYear } : {}),
    };
    const [ordering] = toOrderBy(DOCUMENT_SERIES_SORT_FIELDS, query, {
      field: 'branch',
      order: 'asc',
    });
    const [key, direction] = Object.entries(ordering ?? {})[0] ?? ['branch', 'asc'];
    const dir = direction === 'desc' ? 'desc' : 'asc';
    const orderBy: Prisma.DocumentSequenceOrderByWithRelationInput[] = [
      key === 'branch' ? { branch: { code: dir } } : { [key]: dir },
      { branch: { code: 'asc' } },
      { docType: 'asc' },
      { financialYear: 'desc' },
      { id: 'asc' },
    ];
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.documentSequence.findMany({
          where,
          orderBy,
          include: { branch: true },
          ...toSkipTake(query),
        }),
        tx.documentSequence.count({ where }),
      ]);
      return buildPage(rows.map(toDto), total, query);
    });
  }

  /** Moves the next number forward (never back), for example to skip numbers already used on paper. */
  async advance(auth: { userId: string }, id: string, rawBody: unknown): Promise<DocumentSeries> {
    const input = AdvanceSeriesRequestSchema.parse(rawBody);
    return this.transactions.run(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM document_sequences WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('Document series', id);
      const row = await tx.documentSequence.findUniqueOrThrow({
        where: { id },
        include: { branch: true },
      });
      if (row.rowVersion !== input.rowVersion)
        throw new ConflictError(
          'This series changed while you were looking at it. Reload and try again',
        );
      if (input.nextNumber <= row.nextNumber)
        throw new BusinessRuleError('Numbers only move forward', [
          {
            field: 'nextNumber',
            message: `The next number is already ${row.nextNumber}. Enter a higher one.`,
          },
        ]);
      if (input.nextNumber - row.nextNumber > MAX_SERIES_JUMP)
        throw new BusinessRuleError('That jump is too large', [
          {
            field: 'nextNumber',
            message: `Move forward by at most ${MAX_SERIES_JUMP} at a time.`,
          },
        ]);
      const formatted = example(row, input.nextNumber);
      if (formatted.length > GST_DOCUMENT_NUMBER_MAX_LENGTH)
        throw new BusinessRuleError('That number is too long for GST', [
          {
            field: 'nextNumber',
            message: `${formatted} is longer than the ${GST_DOCUMENT_NUMBER_MAX_LENGTH} characters GST allows.`,
          },
        ]);
      const updated = await tx.documentSequence.update({
        where: { id },
        data: { nextNumber: input.nextNumber, updatedBy: auth.userId },
        include: { branch: true },
      });
      await this.audit.record(tx, {
        action: 'DOCUMENT_SERIES_ADVANCED',
        entityType: 'DocumentSequence',
        entityId: id,
        branchId: row.branchId,
        oldValue: { nextNumber: row.nextNumber },
        newValue: {
          nextNumber: input.nextNumber,
          skipped: input.nextNumber - row.nextNumber,
          reason: input.reason,
          docType: row.docType,
          financialYear: row.financialYear,
        },
      });
      return toDto(updated);
    });
  }
}
