import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import {
  InvoiceListResponseSchema,
  InvoicePreviewSchema,
  InvoiceSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { Invoice, InvoiceListResponse, InvoicePreview } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { BillingService } from './billing.service.js';
import { CreditNotesService } from './credit-notes.service.js';

@ApiTags('billing')
@ApiCookieAuth()
@Controller('invoices')
export class BillingController {
  constructor(
    @Inject(BillingService) private readonly billing: BillingService,
    @Inject(CreditNotesService) private readonly creditNotes: CreditNotesService,
  ) {}

  @RequirePermission('invoices.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(InvoiceListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<InvoiceListResponse> {
    return this.billing.list(auth, query);
  }

  /** Works out what an invoice would come to without saving anything, so the screen can show live totals. */
  @RequirePermission('invoices.create')
  @Post('preview')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(InvoicePreviewSchema) })
  preview(@Body() body: unknown): Promise<InvoicePreview> {
    return this.billing.preview(body);
  }

  @RequirePermission('invoices.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Invoice> {
    return this.billing.get(auth, id);
  }

  /** What can still be credited on each line of the invoice. */
  @RequirePermission('invoices.view')
  @Get(':id/returnable')
  returnable(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.creditNotes.returnable(id);
  }

  @RequirePermission('invoices.view')
  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.billing.pdf(id);
    response
      .status(200)
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.body);
  }

  @RequirePermission('invoices.create')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Invoice> {
    return this.billing.createDraft(auth, body);
  }

  /** Makes a draft invoice from an accepted quotation, at the quoted prices. */
  @RequirePermission('invoices.create', 'quotations.manage')
  @Post('from-quotation')
  @ApiCreatedResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  fromQuotation(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Invoice> {
    return this.billing.convertFromQuotation(auth, body);
  }

  @RequirePermission('invoices.create')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Invoice> {
    return this.billing.updateDraft(auth, id, body);
  }

  /** The gift photo is sent as the request body (JPEG or PNG), with its file name in the query. Draft invoices only. */
  @RequirePermission('invoices.create')
  @Post(':id/gift-photo')
  @ApiCreatedResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  setGiftPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Headers('content-type') declaredType: string | undefined,
  ): Promise<Invoice> {
    return this.billing.setGiftPhoto(auth, id, { query, body, declaredType });
  }

  @RequirePermission('invoices.create')
  @Delete(':id/gift-photo')
  @ApiOkResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  removeGiftPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Invoice> {
    return this.billing.removeGiftPhoto(auth, id);
  }

  @RequirePermission('invoices.view')
  @Get(':id/gift-photo')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async giftPhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.billing.giftPhotoFile(id);
    response
      .status(200)
      .type(file.contentType)
      .setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.fileName)}"`)
      .send(file.body);
  }

  @RequirePermission('invoices.create')
  @Post(':id/discard')
  @HttpCode(204)
  async discard(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.billing.discardDraft(auth, id, body);
  }

  @RequirePermission('invoices.create')
  @Post(':id/issue')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  issue(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Invoice> {
    return this.billing.issue(auth, id, body);
  }

  @RequirePermission('invoices.cancel')
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Invoice> {
    return this.billing.cancel(auth, id, body);
  }

  @RequirePermission('invoices.cancel')
  @Post(':id/reissue')
  @ApiCreatedResponse({ schema: toOpenApiSchema(InvoiceSchema) })
  reissue(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Invoice> {
    return this.billing.reissue(auth, id, body);
  }
}
