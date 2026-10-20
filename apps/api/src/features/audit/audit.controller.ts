import { Controller, Get, Inject, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  AuditFacetsSchema,
  AuditLogResponseSchema,
  UserActivitySchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { AuditFacets, AuditLogResponse, UserActivity } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { AuditViewerService } from './audit-viewer.service.js';

@ApiTags('audit')
@ApiCookieAuth()
@Controller('audit-log')
export class AuditController {
  constructor(@Inject(AuditViewerService) private readonly viewer: AuditViewerService) {}

  @RequirePermission('audit.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(AuditLogResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<AuditLogResponse> {
    return this.viewer.list(auth, query);
  }

  @RequirePermission('audit.view')
  @Get('facets')
  @ApiOkResponse({ schema: toOpenApiSchema(AuditFacetsSchema) })
  facets(): Promise<AuditFacets> {
    return this.viewer.facets();
  }

  @RequirePermission('audit.view')
  @Get('users/:id')
  @ApiOkResponse({ schema: toOpenApiSchema(UserActivitySchema) })
  userActivity(@Param('id', new ParseUUIDPipe()) id: string): Promise<UserActivity> {
    return this.viewer.userActivity(id);
  }
}
