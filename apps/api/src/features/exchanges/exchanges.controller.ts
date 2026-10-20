import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  ExchangeListResponseSchema,
  ExchangeOptionsSchema,
  ExchangeSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { Exchange, ExchangeListResponse, ExchangeOptions } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { ExchangesService } from './exchanges.service.js';

@ApiTags('exchanges')
@ApiCookieAuth()
@Controller('exchanges')
export class ExchangesController {
  constructor(@Inject(ExchangesService) private readonly exchanges: ExchangesService) {}

  @RequirePermission('invoices.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(ExchangeListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<ExchangeListResponse> {
    return this.exchanges.list(query);
  }

  /** The vehicles an issued delivery invoice can exchange, and the ones sold to the same customer that can be taken back. */
  @RequirePermission('exchanges.request')
  @Get('options')
  @ApiOkResponse({ schema: toOpenApiSchema(ExchangeOptionsSchema) })
  options(@Query() query: Record<string, unknown>): Promise<ExchangeOptions> {
    return this.exchanges.options(query);
  }

  @RequirePermission('invoices.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(ExchangeSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Exchange> {
    return this.exchanges.get(id);
  }

  @RequirePermission('exchanges.request')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(ExchangeSchema) })
  request(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Exchange> {
    return this.exchanges.request(auth, body);
  }

  @RequirePermission('exchanges.request')
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(ExchangeSchema) })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Exchange> {
    return this.exchanges.cancel(auth, id, body);
  }

  @RequirePermission('exchanges.approve')
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(ExchangeSchema) })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Exchange> {
    return this.exchanges.approve(auth, id, body);
  }

  @RequirePermission('exchanges.approve')
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(ExchangeSchema) })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Exchange> {
    return this.exchanges.reject(auth, id, body);
  }
}
