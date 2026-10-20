import { Body, Controller, Get, Inject, Param, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  LeadSourceAdminListResponseSchema,
  LeadSourceAdminSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { LeadSourceAdmin } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { LeadSourcesService } from './lead-sources.service.js';

@ApiTags('leads')
@ApiCookieAuth()
@Controller('lead-sources')
export class LeadSourcesController {
  constructor(@Inject(LeadSourcesService) private readonly sources: LeadSourcesService) {}

  /** Every source, switched on or off, with how many leads came from it. */
  @RequirePermission('leads.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(LeadSourceAdminListResponseSchema) })
  list(): Promise<LeadSourceAdmin[]> {
    return this.sources.list();
  }

  @RequirePermission('leads.manage_sources')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(LeadSourceAdminSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<LeadSourceAdmin> {
    return this.sources.create(auth, body);
  }

  @RequirePermission('leads.manage_sources')
  @Patch(':code')
  @ApiOkResponse({ schema: toOpenApiSchema(LeadSourceAdminSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('code') code: string,
    @Body() body: unknown,
  ): Promise<LeadSourceAdmin> {
    return this.sources.update(auth, code, body);
  }
}
