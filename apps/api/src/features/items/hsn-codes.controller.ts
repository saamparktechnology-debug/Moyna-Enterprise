import { Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ManagedHsnListResponseSchema, ManagedHsnSchema, toOpenApiSchema } from '@erp/contracts';
import type { ManagedHsn, ManagedHsnListResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { HsnCodesService } from './hsn-codes.service.js';

@ApiTags('Items')
@ApiCookieAuth()
@Controller('hsn-codes')
export class HsnCodesController {
  constructor(@Inject(HsnCodesService) private readonly hsn: HsnCodesService) {}

  @RequirePermission('items.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(ManagedHsnListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<ManagedHsnListResponse> {
    return this.hsn.list(query);
  }

  @RequirePermission('items.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(ManagedHsnSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<ManagedHsn> {
    return this.hsn.create(auth, body);
  }

  @RequirePermission('items.manage')
  @Patch(':code')
  @ApiOkResponse({ schema: toOpenApiSchema(ManagedHsnSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<ManagedHsn> {
    return this.hsn.update(auth, code, body);
  }
}
