import { Body, Controller, Get, Inject, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  CustomerCreditSchema,
  RefundListResponseSchema,
  RefundSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { CustomerCredit, Refund, RefundListResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { RefundsService } from './refunds.service.js';

@ApiTags('payments')
@ApiCookieAuth()
@Controller('refunds')
export class RefundsController {
  constructor(@Inject(RefundsService) private readonly refunds: RefundsService) {}

  @RequirePermission('payments.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(RefundListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<RefundListResponse> {
    return this.refunds.list(query);
  }

  /** What a customer holds in a branch and how much of it can be refunded. */
  @RequirePermission('payments.view')
  @Get('credit')
  @ApiOkResponse({ schema: toOpenApiSchema(CustomerCreditSchema) })
  credit(@Query() query: Record<string, unknown>): Promise<CustomerCredit> {
    return this.refunds.credit(query);
  }

  @RequirePermission('payments.refund')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(RefundSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Refund> {
    return this.refunds.create(auth, body);
  }
}
