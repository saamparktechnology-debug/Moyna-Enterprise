import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  DocumentSeriesListResponseSchema,
  DocumentSeriesSchema,
  GstRateAdminListResponseSchema,
  GstRateAdminSchema,
  SettingListResponseSchema,
  SettingSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  DocumentSeries,
  DocumentSeriesListResponse,
  GstRateAdmin,
  Setting,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { GstRatesService } from './gst-rates.service.js';
import { SeriesService } from './series.service.js';
import { SettingsService } from './settings.service.js';

@ApiTags('settings')
@ApiCookieAuth()
@Controller('settings/document-series')
export class DocumentSeriesController {
  constructor(@Inject(SeriesService) private readonly series: SeriesService) {}

  @RequirePermission('settings.manage')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(DocumentSeriesListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<DocumentSeriesListResponse> {
    return this.series.list(query);
  }

  @RequirePermission('settings.manage')
  @Post(':id/advance')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(DocumentSeriesSchema) })
  advance(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<DocumentSeries> {
    return this.series.advance(auth, id, body);
  }
}

@ApiTags('settings')
@ApiCookieAuth()
@Controller('settings/gst-rates')
export class GstRatesController {
  constructor(@Inject(GstRatesService) private readonly rates: GstRatesService) {}

  @RequirePermission('settings.manage')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(GstRateAdminListResponseSchema) })
  list(): Promise<GstRateAdmin[]> {
    return this.rates.list();
  }

  @RequirePermission('settings.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(GstRateAdminSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<GstRateAdmin> {
    return this.rates.create(auth, body);
  }

  @RequirePermission('settings.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(GstRateAdminSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<GstRateAdmin> {
    return this.rates.update(auth, id, body);
  }
}

@ApiTags('settings')
@ApiCookieAuth()
@Controller('settings')
export class SettingsController {
  constructor(@Inject(SettingsService) private readonly settings: SettingsService) {}

  @RequirePermission('settings.manage')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(SettingListResponseSchema) })
  list(): Promise<Setting[]> {
    return this.settings.list();
  }

  @RequirePermission('settings.manage')
  @Put(':key')
  @ApiOkResponse({ schema: toOpenApiSchema(SettingSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<Setting> {
    return this.settings.update(auth, key, body);
  }

  @RequirePermission('settings.manage')
  @Post(':key/reset')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(SettingSchema) })
  reset(
    @CurrentAuth() auth: AuthContext,
    @Param('key') key: string,
    @Body() body: unknown,
  ): Promise<Setting> {
    return this.settings.reset(auth, key, body);
  }
}
