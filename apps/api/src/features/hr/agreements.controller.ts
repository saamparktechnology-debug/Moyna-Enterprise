import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
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
  AgreementListResponseSchema,
  AgreementSchema,
  AgreementTemplateListResponseSchema,
  AgreementTemplateSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  Agreement,
  AgreementListResponse,
  AgreementTemplate,
  AgreementTemplateListResponse,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { sendFile } from '../brokers/brokers.controller.js';
import { AgreementsService } from './agreements.service.js';

@ApiTags('HR')
@ApiCookieAuth()
@Controller('agreement-templates')
export class AgreementTemplatesController {
  constructor(@Inject(AgreementsService) private readonly agreements: AgreementsService) {}

  @RequirePermission('hr.manage')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(AgreementTemplateListResponseSchema) })
  list(): Promise<AgreementTemplateListResponse> {
    return this.agreements.listTemplates();
  }

  @RequirePermission('hr.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(AgreementTemplateSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<AgreementTemplate> {
    return this.agreements.createTemplate(auth, body);
  }

  @RequirePermission('hr.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(AgreementTemplateSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<AgreementTemplate> {
    return this.agreements.updateTemplate(auth, id, body);
  }
}

@ApiTags('HR')
@ApiCookieAuth()
@Controller('agreements')
export class AgreementsController {
  constructor(@Inject(AgreementsService) private readonly agreements: AgreementsService) {}

  @RequirePermission('hr.manage')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(AgreementListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<AgreementListResponse> {
    return this.agreements.list(auth, query);
  }

  /** The signed agreements of the person asking. */
  @RequirePermission('hr.view')
  @Get('mine')
  @ApiOkResponse({ schema: toOpenApiSchema(AgreementListResponseSchema) })
  mine(@CurrentAuth() auth: AuthContext): Promise<AgreementListResponse> {
    return this.agreements.mine(auth);
  }

  @RequirePermission('hr.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(AgreementSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Agreement> {
    return this.agreements.create(auth, body);
  }

  @RequirePermission('hr.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(AgreementSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Agreement> {
    return this.agreements.update(auth, id, body);
  }

  @RequirePermission('hr.manage')
  @Post(':id/discard')
  @ApiCreatedResponse({ schema: toOpenApiSchema(AgreementSchema) })
  discard(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Agreement> {
    return this.agreements.discard(auth, id, body);
  }

  /**
   * The acceptance: the signed copy is sent as the request body (PDF, JPEG or PNG). The file name, the date signed, the
   * confirmations that the employee and the Super Admin both signed, and the version read are in the query.
   */
  @RequirePermission('hr.manage')
  @Post(':id/signed-copy')
  @ApiCreatedResponse({ schema: toOpenApiSchema(AgreementSchema) })
  signedCopy(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Headers('content-type') declaredType: string | undefined,
  ): Promise<Agreement> {
    return this.agreements.recordSigned(auth, id, { query, body, declaredType });
  }

  @RequirePermission('hr.manage')
  @Post(':id/end')
  @ApiCreatedResponse({ schema: toOpenApiSchema(AgreementSchema) })
  end(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Agreement> {
    return this.agreements.end(auth, id, body);
  }

  /** The agreement as a PDF: to print and sign, or to read. A manager, or the employee a signed agreement is for. */
  @RequirePermission('hr.view')
  @Get(':id/pdf')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async pdf(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.agreements.pdf(auth, id);
    response
      .status(200)
      .type('application/pdf')
      .setHeader('Content-Disposition', `inline; filename="${file.fileName}"`)
      .send(file.body);
  }

  @RequirePermission('hr.view')
  @Get(':id/signed-copy')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async signedFile(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    sendFile(response, await this.agreements.signedFile(auth, id), 'inline');
  }
}
