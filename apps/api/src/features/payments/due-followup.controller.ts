import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  DuePromiseListResponseSchema,
  GuarantorResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { DuePromiseListResponse, GuarantorResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { sendFile } from '../brokers/brokers.controller.js';
import { DueFollowupService } from './due-followup.service.js';

/** The next promised date and the guarantor of an invoice that is not paid. */
@ApiTags('payments')
@ApiCookieAuth()
@Controller('dues/invoices/:invoiceId')
export class DueFollowupController {
  constructor(@Inject(DueFollowupService) private readonly followup: DueFollowupService) {}

  @RequirePermission('payments.view')
  @Get('promises')
  @ApiOkResponse({ schema: toOpenApiSchema(DuePromiseListResponseSchema) })
  promises(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<DuePromiseListResponse> {
    return this.followup.listPromises(invoiceId);
  }

  @RequirePermission('payments.create')
  @Post('promises')
  @ApiCreatedResponse({ schema: toOpenApiSchema(DuePromiseListResponseSchema) })
  addPromise(
    @CurrentAuth() auth: AuthContext,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() body: unknown,
  ): Promise<DuePromiseListResponse> {
    return this.followup.addPromise(auth, invoiceId, body);
  }

  @RequirePermission('payments.view')
  @Get('guarantor')
  @ApiOkResponse({ schema: toOpenApiSchema(GuarantorResponseSchema) })
  guarantor(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<GuarantorResponse> {
    return this.followup.getGuarantor(invoiceId);
  }

  @RequirePermission('payments.create')
  @Put('guarantor')
  @ApiOkResponse({ schema: toOpenApiSchema(GuarantorResponseSchema) })
  setGuarantor(
    @CurrentAuth() auth: AuthContext,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Body() body: unknown,
  ): Promise<GuarantorResponse> {
    return this.followup.setGuarantor(auth, invoiceId, body);
  }

  @RequirePermission('payments.create')
  @Delete('guarantor')
  @ApiOkResponse({ schema: toOpenApiSchema(GuarantorResponseSchema) })
  removeGuarantor(
    @CurrentAuth() auth: AuthContext,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<GuarantorResponse> {
    return this.followup.removeGuarantor(auth, invoiceId);
  }

  /** The KYC file is sent as the request body (PDF, JPEG or PNG); a new one replaces the old. Its name is in the query. */
  @RequirePermission('kyc.upload')
  @Post('guarantor/kyc')
  @ApiCreatedResponse({ schema: toOpenApiSchema(GuarantorResponseSchema) })
  setKyc(
    @CurrentAuth() auth: AuthContext,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Headers('content-type') declaredType: string | undefined,
  ): Promise<GuarantorResponse> {
    return this.followup.setKyc(auth, invoiceId, { query, body, declaredType });
  }

  @RequirePermission('kyc.upload')
  @Delete('guarantor/kyc')
  @ApiOkResponse({ schema: toOpenApiSchema(GuarantorResponseSchema) })
  removeKyc(
    @CurrentAuth() auth: AuthContext,
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
  ): Promise<GuarantorResponse> {
    return this.followup.removeKyc(auth, invoiceId);
  }

  @RequirePermission('kyc.view')
  @Get('guarantor/kyc')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async kyc(
    @Param('invoiceId', new ParseUUIDPipe()) invoiceId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendFile(response, await this.followup.kycFile(invoiceId), 'inline');
  }
}
