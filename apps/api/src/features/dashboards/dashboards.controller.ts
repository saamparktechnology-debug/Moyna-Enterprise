import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BranchDashboardSchema, CompanyDashboardSchema, toOpenApiSchema } from '@erp/contracts';
import type { BranchDashboard, CompanyDashboard } from '@erp/contracts';
import { RequirePermission } from '../auth/decorators.js';
import { DashboardsService } from './dashboards.service.js';

@ApiTags('dashboards')
@ApiCookieAuth()
@Controller('dashboards')
export class DashboardsController {
  constructor(@Inject(DashboardsService) private readonly dashboards: DashboardsService) {}

  /** Every branch the caller can see: company figures, a line per branch and a daily trend. */
  @RequirePermission('dashboards.view_company')
  @Get('company')
  @ApiOkResponse({ schema: toOpenApiSchema(CompanyDashboardSchema) })
  company(@Query() query: Record<string, unknown>): Promise<CompanyDashboard> {
    return this.dashboards.company(query);
  }

  /** One branch the caller works in. */
  @RequirePermission('dashboards.view_branch')
  @Get('branch')
  @ApiOkResponse({ schema: toOpenApiSchema(BranchDashboardSchema) })
  branch(@Query() query: Record<string, unknown>): Promise<BranchDashboard> {
    return this.dashboards.branch(query);
  }
}
