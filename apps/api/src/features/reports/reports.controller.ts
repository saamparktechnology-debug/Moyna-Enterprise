import { Controller, Get, Header, Inject, Param, Query, Res } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ReportCatalogSchema, ReportResponseSchema, toOpenApiSchema } from '@erp/contracts';
import type { ReportInfo, ReportResponse } from '@erp/contracts';
import type { Response } from 'express';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { ReportsService } from './reports.service.js';

@ApiTags('reports')
@ApiCookieAuth()
@Controller('reports')
export class ReportsController {
  constructor(@Inject(ReportsService) private readonly reports: ReportsService) {}

  /** The reports this person may open. */
  @RequirePermission('reports.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(ReportCatalogSchema) })
  catalog(@CurrentAuth() auth: AuthContext): ReportInfo[] {
    return this.reports.catalog(auth);
  }

  @RequirePermission('reports.view')
  @Get(':code')
  @ApiOkResponse({ schema: toOpenApiSchema(ReportResponseSchema) })
  run(
    @CurrentAuth() auth: AuthContext,
    @Param('code') code: string,
    @Query() query: Record<string, unknown>,
  ): Promise<ReportResponse> {
    return this.reports.run(auth, code.toUpperCase(), query);
  }

  /** Excel or PDF of the whole result. Needs the separate export permission. */
  @RequirePermission('reports.export')
  @Get(':code/export')
  @Header('Cache-Control', 'no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async export(
    @CurrentAuth() auth: AuthContext,
    @Param('code') code: string,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.reports.export(auth, code.toUpperCase(), query);
    response
      .status(200)
      .type(file.contentType)
      .setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
      .send(file.body);
  }
}
