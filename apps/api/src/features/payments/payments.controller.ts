//apps/api/src/features/payments/payments.controller.ts
import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { PaymentListResponseSchema, PaymentSchema, toOpenApiSchema } from '@erp/contracts';
import type { Payment, PaymentListResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { PaymentsService } from './payments.service.js';

@ApiTags('payments')
@ApiCookieAuth()
@Controller('payments')
export class PaymentsController {
  constructor(@Inject(PaymentsService) private readonly payments: PaymentsService) {}

  @RequirePermission('payments.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(PaymentListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<PaymentListResponse> {
    return this.payments.list(query);
  }

  /** The receipt for a payment, as a PDF to print and hand to the customer. */
  @RequirePermission('payments.view')
  @Get(':id/receipt')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async receipt(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.payments.receipt(id);
    response
      .status(200)
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.body);
  }

  @RequirePermission('payments.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(PaymentSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Payment> {
    return this.payments.get(id);
  }

  /** Takes money from a customer. A repeated request with the same `idempotencyKey` returns the payment already recorded. */
  @RequirePermission('payments.create')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(PaymentSchema) })
  record(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Payment> {
    return this.payments.record(auth, body);
  }

  /** Applies what is left of a payment to more invoices. */
  @RequirePermission('payments.create')
  @Post(':id/allocations')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(PaymentSchema) })
  apply(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Payment> {
    return this.payments.apply(auth, id, body);
  }

  @RequirePermission('payments.reverse')
  @Post(':id/reverse')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(PaymentSchema) })
  reverse(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Payment> {
    return this.payments.reverse(auth, id, body);
  }
}
