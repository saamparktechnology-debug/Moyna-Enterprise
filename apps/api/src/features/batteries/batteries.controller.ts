import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  BatteryAlertsSchema,
  BatteryListResponseSchema,
  BatterySchema,
  SaleCheckResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  Battery,
  BatteryAlerts,
  BatteryListResponse,
  SaleCheckResponse,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { BatteriesService } from './batteries.service.js';

@ApiTags('batteries')
@ApiCookieAuth()
@Controller('batteries')
export class BatteriesController {
  constructor(@Inject(BatteriesService) private readonly batteries: BatteriesService) {}

  @RequirePermission('batteries.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(BatteryListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<BatteryListResponse> {
    return this.batteries.list(query);
  }

  @RequirePermission('batteries.view')
  @Get('alerts')
  @ApiOkResponse({ schema: toOpenApiSchema(BatteryAlertsSchema) })
  alerts(@Query() query: Record<string, unknown>): Promise<BatteryAlerts> {
    return this.batteries.alerts(query);
  }

  @RequirePermission('batteries.view')
  @Get(':serialUnitId')
  @ApiOkResponse({ schema: toOpenApiSchema(BatterySchema) })
  get(@Param('serialUnitId', new ParseUUIDPipe()) id: string): Promise<Battery> {
    return this.batteries.get(id);
  }

  @RequirePermission('stock.adjust')
  @Patch(':serialUnitId')
  @ApiOkResponse({ schema: toOpenApiSchema(BatterySchema) })
  setDetails(
    @CurrentAuth() auth: AuthContext,
    @Param('serialUnitId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Battery> {
    return this.batteries.setDetails(auth, id, body);
  }

  @RequirePermission('stock.adjust')
  @Post(':serialUnitId/install')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(BatterySchema) })
  install(
    @CurrentAuth() auth: AuthContext,
    @Param('serialUnitId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Battery> {
    return this.batteries.install(auth, id, body);
  }

  @RequirePermission('stock.adjust')
  @Post(':serialUnitId/uninstall')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(BatterySchema) })
  uninstall(
    @CurrentAuth() auth: AuthContext,
    @Param('serialUnitId', new ParseUUIDPipe()) id: string,
  ): Promise<Battery> {
    return this.batteries.uninstall(auth, id);
  }

  @RequirePermission('batteries.view')
  @Post(':serialUnitId/sale-check')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(SaleCheckResponseSchema) })
  saleCheck(
    @CurrentAuth() auth: AuthContext,
    @Param('serialUnitId', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<SaleCheckResponse> {
    return this.batteries.saleCheck(auth, id, body);
  }
}
