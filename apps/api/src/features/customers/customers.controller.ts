import {
  Body,
  Controller,
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
  CustomerListResponseSchema,
  CustomerSchema,
  KycDocumentSchema,
  KycOverviewSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { Customer, CustomerListResponse, KycDocument, KycOverview } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { CustomersService } from './customers.service.js';
import { KycService } from './kyc.service.js';

@ApiTags('customers')
@ApiCookieAuth()
@Controller('customers')
export class CustomersController {
  constructor(
    @Inject(CustomersService) private readonly customers: CustomersService,
    @Inject(KycService) private readonly kyc: KycService,
  ) {}

  @RequirePermission('customers.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(CustomerListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<CustomerListResponse> {
    return this.customers.list(query);
  }

  @RequirePermission('customers.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(CustomerSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Customer> {
    return this.customers.get(id);
  }

  @RequirePermission('customers.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(CustomerSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Customer> {
    return this.customers.create(auth, body);
  }

  @RequirePermission('customers.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(CustomerSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Customer> {
    return this.customers.update(auth, id, body);
  }

  @RequirePermission('kyc.view')
  @Get(':id/kyc')
  @ApiOkResponse({ schema: toOpenApiSchema(KycOverviewSchema) })
  overview(@Param('id', new ParseUUIDPipe()) id: string): Promise<KycOverview> {
    return this.kyc.overview(id);
  }

  /** The file is sent as the request body. The kind of document and the file name are in the query. */
  @RequirePermission('kyc.upload')
  @Post(':id/kyc-documents')
  @ApiCreatedResponse({ schema: toOpenApiSchema(KycDocumentSchema) })
  upload(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Headers('content-type') declaredType: string | undefined,
    @Headers('x-document-number') documentNumber: string | undefined,
  ): Promise<KycDocument> {
    return this.kyc.upload(auth, id, { query, body, declaredType, documentNumber });
  }

  @RequirePermission('kyc.view')
  @Get(':id/kyc-documents/:documentId/file')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async file(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.kyc.download(auth, id, documentId);
    response
      .status(200)
      .type(file.contentType)
      .setHeader(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(file.fileName)}"`,
      )
      .send(file.body);
  }

  @RequirePermission('kyc.verify')
  @Post(':id/kyc-documents/:documentId/verify')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(KycDocumentSchema) })
  verify(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() body: unknown,
  ): Promise<KycDocument> {
    return this.kyc.verify(auth, id, documentId, body);
  }

  @RequirePermission('kyc.verify')
  @Post(':id/kyc-documents/:documentId/reject')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(KycDocumentSchema) })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Body() body: unknown,
  ): Promise<KycDocument> {
    return this.kyc.reject(auth, id, documentId, body);
  }
}
