import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { QuotationListResponseSchema, QuotationSchema, toOpenApiSchema } from '@erp/contracts';
import type { Quotation, QuotationListResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { QuotationsService } from './quotations.service.js';

@ApiTags('quotations')
@ApiCookieAuth()
@Controller('quotations')
export class QuotationsController {
  constructor(@Inject(QuotationsService) private readonly quotations: QuotationsService) {}

  @RequirePermission('quotations.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<QuotationListResponse> {
    return this.quotations.list(query);
  }

  @RequirePermission('quotations.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Quotation> {
    return this.quotations.get(id);
  }

  @RequirePermission('quotations.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(QuotationSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Quotation> {
    return this.quotations.create(auth, body);
  }

  @RequirePermission('quotations.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Quotation> {
    return this.quotations.update(auth, id, body);
  }

  @RequirePermission('quotations.manage')
  @Post(':id/send')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationSchema) })
  send(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Quotation> {
    return this.quotations.send(auth, id, body);
  }

  @RequirePermission('quotations.manage')
  @Post(':id/accept')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationSchema) })
  accept(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Quotation> {
    return this.quotations.accept(auth, id, body);
  }

  @RequirePermission('quotations.manage')
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationSchema) })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Quotation> {
    return this.quotations.cancel(auth, id, body);
  }

  /** Takes money for an accepted quotation before the invoice. Needs the right to take payments as well. */
  @RequirePermission('quotations.manage', 'payments.create')
  @Post(':id/advance')
  @ApiCreatedResponse({ schema: toOpenApiSchema(QuotationSchema) })
  advance(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Quotation> {
    return this.quotations.takeAdvance(auth, id, body);
  }

  @RequirePermission('quotations.manage')
  @Post(':id/build')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationSchema) })
  build(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Quotation> {
    return this.quotations.updateBuild(auth, id, body);
  }

  @RequirePermission('quotations.manage')
  @Post(':id/lines/:lineId/unit')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(QuotationSchema) })
  assignUnit(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() body: unknown,
  ): Promise<Quotation> {
    return this.quotations.assignUnit(auth, id, lineId, body);
  }
}
