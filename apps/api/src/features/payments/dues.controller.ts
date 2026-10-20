import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  CustomerDueListResponseSchema,
  CustomerLedgerSchema,
  DueListResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { CustomerDueListResponse, CustomerLedger, DueListResponse } from '@erp/contracts';
import { RequirePermission } from '../auth/decorators.js';
import { DuesService } from './dues.service.js';

@ApiTags('payments')
@ApiCookieAuth()
@Controller('dues')
export class DuesController {
  constructor(@Inject(DuesService) private readonly dues: DuesService) {}

  /** Issued invoices with what is paid and what is still owed; filter to outstanding or overdue. */
  @RequirePermission('payments.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(DueListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<DueListResponse> {
    return this.dues.list(query);
  }

  @RequirePermission('payments.view')
  @Get('customers')
  @ApiOkResponse({ schema: toOpenApiSchema(CustomerDueListResponseSchema) })
  customers(@Query() query: Record<string, unknown>): Promise<CustomerDueListResponse> {
    return this.dues.customers(query);
  }

  @RequirePermission('payments.view')
  @Get('customers/:customerId/ledger')
  @ApiOkResponse({ schema: toOpenApiSchema(CustomerLedgerSchema) })
  ledger(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<CustomerLedger> {
    return this.dues.ledger(customerId, query);
  }
}
