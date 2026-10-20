import { Inject, Injectable } from '@nestjs/common';
import {
  CUSTOMER_SORT_FIELDS,
  CreateCustomerRequestSchema,
  CustomerListQuerySchema,
  UpdateCustomerRequestSchema,
} from '@erp/contracts';
import type { Customer, CustomerListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import {
  buildPage,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CUSTOMER_INCLUDE, customerSnapshot, toCustomerDto } from './customers.mapper.js';
import type { CustomerRow } from './customers.mapper.js';

@Injectable()
export class CustomersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(rawQuery: unknown): Promise<CustomerListResponse> {
    const query = CustomerListQuerySchema.parse(rawQuery);
    const filters: Prisma.CustomerWhereInput[] = [];
    if (query.kycStatus) filters.push({ kycStatus: query.kycStatus });
    if (query.stateCode) filters.push({ stateCode: query.stateCode });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({ OR: [{ name: like }, { phone: like }, { gstin: like }] });
    }
    const where: Prisma.CustomerWhereInput = { AND: filters };
    const orderBy = toOrderBy(CUSTOMER_SORT_FIELDS, query, { field: 'name', order: 'asc' });
    const [rows, total] = await Promise.all([
      this.prisma.customer.findMany({
        where,
        orderBy,
        include: CUSTOMER_INCLUDE,
        ...toSkipTake(query),
      }),
      this.prisma.customer.count({ where }),
    ]);
    return buildPage(rows.map(toCustomerDto), total, query);
  }

  async get(id: string): Promise<Customer> {
    const row = await this.prisma.customer.findUnique({ where: { id }, include: CUSTOMER_INCLUDE });
    if (!row) throw new NotFoundError('Customer', id);
    return toCustomerDto(row);
  }

  async create(auth: AuthContext, body: unknown): Promise<Customer> {
    const input = CreateCustomerRequestSchema.parse(body);
    await this.assertState(input.stateCode);
    try {
      return await this.transactions.run(async (tx) => {
        const row = await tx.customer.create({
          data: { ...input, createdBy: auth.userId, updatedBy: auth.userId },
          include: CUSTOMER_INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'CUSTOMER_CREATED',
          entityType: 'Customer',
          entityId: row.id,
          newValue: customerSnapshot(row),
        });
        return toCustomerDto(row);
      });
    } catch (error) {
      throw await this.explainConflict(error, input.phone, input.gstin ?? null, null);
    }
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<Customer> {
    const input = UpdateCustomerRequestSchema.parse(body);
    await this.assertState(input.stateCode);
    try {
      return await this.transactions.run(async (tx) => {
        const current = await this.lock(tx, id);
        if (current.rowVersion !== input.rowVersion)
          throw new ConflictError(
            'This customer was changed by someone else. Reload them and try again',
          );
        const next = {
          name: input.name ?? current.name,
          phone: input.phone ?? current.phone,
          email: input.email === undefined ? current.email : input.email,
          address: input.address === undefined ? current.address : input.address,
          stateCode: input.stateCode === undefined ? current.stateCode : input.stateCode,
          gstin: input.gstin === undefined ? current.gstin : input.gstin,
        };
        if (next.gstin && next.stateCode && next.gstin.slice(0, 2) !== next.stateCode)
          throw new ValidationFailedError('The GSTIN does not match the state', [
            {
              field: 'gstin',
              message: `The GSTIN starts with ${next.gstin.slice(0, 2)}, not the state ${next.stateCode}`,
            },
          ]);
        const changed = (Object.keys(next) as (keyof typeof next)[]).some(
          (key) => next[key] !== current[key],
        );
        if (!changed) return toCustomerDto(current);
        await tx.customer.update({ where: { id }, data: { ...next, updatedBy: auth.userId } });
        const row = await tx.customer.findUniqueOrThrow({
          where: { id },
          include: CUSTOMER_INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'CUSTOMER_UPDATED',
          entityType: 'Customer',
          entityId: id,
          oldValue: customerSnapshot(current),
          newValue: customerSnapshot(row),
        });
        return toCustomerDto(row);
      });
    } catch (error) {
      throw await this.explainConflict(error, input.phone ?? null, input.gstin ?? null, id);
    }
  }

  private async lock(tx: TxClient, id: string): Promise<CustomerRow> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM customers WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Customer', id);
    return tx.customer.findUniqueOrThrow({ where: { id }, include: CUSTOMER_INCLUDE });
  }

  private async assertState(stateCode: string | null | undefined): Promise<void> {
    if (!stateCode) return;
    const state = await this.prisma.state.findFirst({ where: { code: stateCode, isActive: true } });
    if (!state)
      throw new ValidationFailedError('Unknown state', [
        { field: 'stateCode', message: 'Choose a state from the list' },
      ]);
  }

  /** A unique-index failure becomes a message that names the field and the customer who already has the value. */
  private async explainConflict(
    error: unknown,
    phone: string | null,
    gstin: string | null,
    ownId: string | null,
  ): Promise<Error> {
    const unknownError = error instanceof Error ? error : new Error(String(error));
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      return unknownError;
    const other = (field: 'phone' | 'gstin', value: string | null) =>
      value
        ? this.prisma.customer.findFirst({
            where: { [field]: value, ...(ownId ? { id: { not: ownId } } : {}) },
          })
        : null;
    const [byPhone, byGstin] = await Promise.all([other('phone', phone), other('gstin', gstin)]);
    if (byPhone)
      return new ConflictError('A customer with this phone number already exists', [
        { field: 'phone', message: `Already used by ${byPhone.name}` },
      ]);
    if (byGstin)
      return new ConflictError('A customer with this GSTIN already exists', [
        { field: 'gstin', message: `Already used by ${byGstin.name}` },
      ]);
    return unknownError;
  }
}
