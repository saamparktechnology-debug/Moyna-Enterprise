import { Inject, Injectable } from '@nestjs/common';
import { BranchContextService } from '../branch-context/branch-context.service.js';
import {
  DOCUMENT_PREFIXES,
  GST_DOCUMENT_NUMBER_MAX_LENGTH,
  GST_LENGTH_LIMITED,
  financialYearOf,
} from '@erp/contracts';
import type { DocumentTypeName } from '@erp/contracts';
import { BranchAccessError, BusinessRuleError, NotFoundError } from '../errors/domain-errors.js';
import type { TxClient } from '../prisma/scoped-prisma.service.js';

const NUMBER_PADDING = 5;

export interface NextNumberInput {
  branchId: string;
  docType: DocumentTypeName;
  date?: Date;
}

@Injectable()
export class DocumentNumberService {
  constructor(@Inject(BranchContextService) private readonly contexts: BranchContextService) {}

  async next(tx: TxClient, input: NextNumberInput): Promise<string> {
    const context = this.contexts.require();
    if (!context.isSuperAdmin && !context.branchIds.includes(input.branchId))
      throw new BranchAccessError();
    const year = financialYearOf(input.date ?? new Date());
    const defaultSuffix = DOCUMENT_PREFIXES[input.docType];

    await tx.$executeRaw`
      INSERT INTO document_sequences
        (id, branch_id, doc_type, financial_year, prefix, next_number, created_at, updated_at)
      SELECT gen_random_uuid(), b.id, ${input.docType}::"DocumentType", ${year.label}, b.code || ${defaultSuffix}, 1,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM branches b WHERE b.id = ${input.branchId}::uuid
      ON CONFLICT (branch_id, doc_type, financial_year) DO NOTHING`;

    const rows = await tx.$queryRaw<{ number: number; prefix: string }[]>`
      UPDATE document_sequences
      SET next_number = next_number + 1
      WHERE branch_id = ${input.branchId}::uuid
        AND doc_type = ${input.docType}::"DocumentType"
        AND financial_year = ${year.label}
      RETURNING next_number - 1 AS number, prefix`;

    const row = rows[0];
    if (!row) throw new NotFoundError('Branch', input.branchId);

    const formatted = `${row.prefix}/${year.short}/${String(row.number).padStart(NUMBER_PADDING, '0')}`;
    if (
      GST_LENGTH_LIMITED.includes(input.docType) &&
      formatted.length > GST_DOCUMENT_NUMBER_MAX_LENGTH
    ) {
      throw new BusinessRuleError(
        `Document number ${formatted} is longer than the ${GST_DOCUMENT_NUMBER_MAX_LENGTH} characters GST allows. Use a shorter branch code or series prefix.`,
      );
    }
    return formatted;
  }
}
