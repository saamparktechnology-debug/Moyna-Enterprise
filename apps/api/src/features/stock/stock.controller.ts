import { Controller, Get, Inject, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  LowStockListResponseSchema,
  MovementListResponseSchema,
  SerialUnitListResponseSchema,
  StockBalanceListResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  LowStockListResponse,
  MovementListResponse,
  SerialUnitListResponse,
  StockBalanceListResponse,
} from '@erp/contracts';
import { RequirePermission } from '../auth/decorators.js';
import { StockService } from './stock.service.js';

@ApiTags('stock')
@ApiCookieAuth()
@Controller('stock')
export class StockController {
  constructor(@Inject(StockService) private readonly stock: StockService) {}

  @RequirePermission('stock.view')
  @Get('balances')
  @ApiOkResponse({ schema: toOpenApiSchema(StockBalanceListResponseSchema) })
  balances(@Query() query: Record<string, unknown>): Promise<StockBalanceListResponse> {
    return this.stock.balances(query);
  }

  @RequirePermission('stock.view')
  @Get('low-stock')
  @ApiOkResponse({ schema: toOpenApiSchema(LowStockListResponseSchema) })
  lowStock(@Query() query: Record<string, unknown>): Promise<LowStockListResponse> {
    return this.stock.lowStock(query);
  }

  @RequirePermission('stock.view')
  @Get('movements')
  @ApiOkResponse({ schema: toOpenApiSchema(MovementListResponseSchema) })
  movements(@Query() query: Record<string, unknown>): Promise<MovementListResponse> {
    return this.stock.movements(query);
  }

  @RequirePermission('stock.view')
  @Get('serial-units')
  @ApiOkResponse({ schema: toOpenApiSchema(SerialUnitListResponseSchema) })
  serialUnits(@Query() query: Record<string, unknown>): Promise<SerialUnitListResponse> {
    return this.stock.serialUnits(query);
  }
}
