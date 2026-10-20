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
import { TransferListResponseSchema, TransferSchema, toOpenApiSchema } from '@erp/contracts';
import type { Transfer, TransferListResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { TransfersService } from './transfers.service.js';

@ApiTags('transfers')
@ApiCookieAuth()
@Controller('transfers')
export class TransfersController {
  constructor(@Inject(TransfersService) private readonly transfers: TransfersService) {}

  @RequirePermission('transfers.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(TransferListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<TransferListResponse> {
    return this.transfers.list(auth, query);
  }

  @RequirePermission('transfers.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(TransferSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Transfer> {
    return this.transfers.get(id);
  }

  @RequirePermission('transfers.request')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(TransferSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Transfer> {
    return this.transfers.create(auth, body);
  }

  @RequirePermission('transfers.approve')
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(TransferSchema) })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Transfer> {
    return this.transfers.approve(auth, id, body);
  }

  @RequirePermission('transfers.approve')
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(TransferSchema) })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Transfer> {
    return this.transfers.reject(auth, id, body);
  }

  @RequirePermission('transfers.request')
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(TransferSchema) })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Transfer> {
    return this.transfers.cancel(auth, id, body);
  }

  @RequirePermission('transfers.dispatch')
  @Post(':id/dispatch')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(TransferSchema) })
  dispatch(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Transfer> {
    return this.transfers.dispatch(auth, id, body);
  }

  @RequirePermission('transfers.receive')
  @Post(':id/receive')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(TransferSchema) })
  receive(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Transfer> {
    return this.transfers.receive(auth, id, body);
  }
}
