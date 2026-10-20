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
import type { Response } from 'express';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { CreditNoteListResponseSchema, CreditNoteSchema, toOpenApiSchema } from '@erp/contracts';
import type { CreditNote, CreditNoteListResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { Authenticated, CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { CreditNotesService } from './credit-notes.service.js';

@ApiTags('billing')
@ApiCookieAuth()
@Controller('credit-notes')
export class CreditNotesController {
  constructor(@Inject(CreditNotesService) private readonly notes: CreditNotesService) {}

  @RequirePermission('invoices.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(CreditNoteListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<CreditNoteListResponse> {
    return this.notes.list(query);
  }

  @RequirePermission('invoices.view')
  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async pdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.notes.pdf(id);
    response
      .status(200)
      .type('application/pdf')
      .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.body);
  }

  @RequirePermission('invoices.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(CreditNoteSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<CreditNote> {
    return this.notes.get(id);
  }

  @RequirePermission('credit_notes.create')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(CreditNoteSchema) })
  request(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<CreditNote> {
    return this.notes.request(auth, body);
  }

  @RequirePermission('credit_notes.approve')
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(CreditNoteSchema) })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<CreditNote> {
    return this.notes.approve(auth, id, body);
  }

  /** An approver may reject any request, and a person may withdraw their own, so the service decides. */
  @Authenticated()
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(CreditNoteSchema) })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<CreditNote> {
    return this.notes.reject(auth, id, body);
  }
}
