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
  BrokerLedgerSchema,
  BrokerListResponseSchema,
  BrokerSchema,
  CommissionListResponseSchema,
  PayoutResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  Broker,
  BrokerLedger,
  BrokerListResponse,
  CommissionListResponse,
  PayoutResponse,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { BrokersService } from './brokers.service.js';
import type { BrokerStoredFile } from './brokers.service.js';
import { CommissionsService } from './commissions.service.js';

@ApiTags('brokers')
@ApiCookieAuth()
@Controller('brokers')
export class BrokersController {
  constructor(@Inject(BrokersService) private readonly brokers: BrokersService) {}

  @RequirePermission('brokers.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<BrokerListResponse> {
    return this.brokers.list(query);
  }

  @RequirePermission('brokers.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Broker> {
    return this.brokers.get(id);
  }

  @RequirePermission('brokers.view')
  @Get(':id/ledger')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerLedgerSchema) })
  ledger(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<BrokerLedger> {
    return this.brokers.ledger(id, query);
  }

  @RequirePermission('brokers.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(BrokerSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Broker> {
    return this.brokers.create(auth, body);
  }

  @RequirePermission('brokers.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Broker> {
    return this.brokers.update(auth, id, body);
  }

  /** Puts a new commission rule in force and retires the old one; rules are never edited. */
  @RequirePermission('brokers.manage')
  @Post(':id/rules')
  @ApiCreatedResponse({ schema: toOpenApiSchema(BrokerSchema) })
  addRule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Broker> {
    return this.brokers.addRule(auth, id, body);
  }

  /** The photo is sent as the request body (JPEG or PNG); a new one replaces the old. The file name is in the query. */
  @RequirePermission('brokers.manage')
  @Post(':id/photo')
  @ApiCreatedResponse({ schema: toOpenApiSchema(BrokerSchema) })
  setPhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Headers('content-type') declaredType: string | undefined,
  ): Promise<Broker> {
    return this.brokers.setPhoto(auth, id, { query, body, declaredType });
  }

  @RequirePermission('brokers.manage')
  @Delete(':id/photo')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerSchema) })
  removePhoto(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Broker> {
    return this.brokers.removePhoto(auth, id);
  }

  @RequirePermission('brokers.view')
  @Get(':id/photo')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async photo(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    sendFile(response, await this.brokers.photoFile(id), 'inline');
  }

  /** A document is sent as the request body (PDF, JPEG or PNG). Its file name, and what it is, are in the query. */
  @RequirePermission('brokers.manage')
  @Post(':id/documents')
  @ApiCreatedResponse({ schema: toOpenApiSchema(BrokerSchema) })
  addDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
    @Body() body: unknown,
    @Headers('content-type') declaredType: string | undefined,
  ): Promise<Broker> {
    return this.brokers.addDocument(auth, id, { query, body, declaredType });
  }

  @RequirePermission('brokers.manage')
  @Delete(':id/documents/:fileId')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerSchema) })
  removeDocument(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
  ): Promise<Broker> {
    return this.brokers.removeDocument(auth, id, fileId);
  }

  @RequirePermission('brokers.view')
  @Get(':id/documents/:fileId/file')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async document(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('fileId', new ParseUUIDPipe()) fileId: string,
    @Res() response: Response,
  ): Promise<void> {
    sendFile(response, await this.brokers.documentFile(id, fileId), 'attachment');
  }
}

/** Sends a stored file. `no-sniff` and the stored type keep the browser from treating it as anything else. */
export function sendFile(
  response: Response,
  file: BrokerStoredFile,
  disposition: 'inline' | 'attachment',
): void {
  response
    .status(200)
    .type(file.contentType)
    .setHeader(
      'Content-Disposition',
      `${disposition}; filename="${encodeURIComponent(file.fileName)}"`,
    )
    .send(file.body);
}

@ApiTags('brokers')
@ApiCookieAuth()
@Controller('commissions')
export class CommissionsController {
  constructor(@Inject(CommissionsService) private readonly commissions: CommissionsService) {}

  @RequirePermission('brokers.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(CommissionListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<CommissionListResponse> {
    return this.commissions.list(query);
  }

  /** The photo of the gift a commission was agreed as. */
  @RequirePermission('brokers.view')
  @Get(':id/gift-photo')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async giftPhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() response: Response,
  ): Promise<void> {
    sendFile(response, await this.commissions.giftPhoto(id), 'inline');
  }

  /** Pays commissions to one broker, each at what it is worth now. */
  @RequirePermission('commissions.approve_payout')
  @Post('payout')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(PayoutResponseSchema) })
  payout(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<PayoutResponse> {
    return this.commissions.payout(auth, body);
  }
}
