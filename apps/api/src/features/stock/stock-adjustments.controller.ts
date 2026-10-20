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
  AdjustmentListResponseSchema,
  StockAdjustmentSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { AdjustmentListResponse, StockAdjustment } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { StockAdjustmentsService } from './stock-adjustments.service.js';

@ApiTags('stock')
@ApiCookieAuth()
@Controller('stock/adjustments')
export class StockAdjustmentsController {
  constructor(
    @Inject(StockAdjustmentsService) private readonly adjustments: StockAdjustmentsService,
  ) {}

  @RequirePermission('stock.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(AdjustmentListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<AdjustmentListResponse> {
    return this.adjustments.list(query);
  }

  @RequirePermission('stock.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(StockAdjustmentSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<StockAdjustment> {
    return this.adjustments.get(id);
  }

  @RequirePermission('stock.adjust')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(StockAdjustmentSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<StockAdjustment> {
    return this.adjustments.create(auth, body);
  }

  @RequirePermission('stock.adjust_approve')
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(StockAdjustmentSchema) })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<StockAdjustment> {
    return this.adjustments.approve(auth, id, body);
  }

  @RequirePermission('stock.adjust_approve')
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(StockAdjustmentSchema) })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<StockAdjustment> {
    return this.adjustments.reject(auth, id, body);
  }

  @RequirePermission('stock.adjust')
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(StockAdjustmentSchema) })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<StockAdjustment> {
    return this.adjustments.cancel(auth, id, body);
  }
}
