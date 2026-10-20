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
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  ItemListResponseSchema,
  ItemSchema,
  LabelResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { Item, ItemListResponse, LabelResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { ItemsService } from './items.service.js';

@ApiTags('items')
@ApiCookieAuth()
@Controller('items')
export class ItemsController {
  constructor(@Inject(ItemsService) private readonly items: ItemsService) {}

  @RequirePermission('items.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(ItemListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<ItemListResponse> {
    return this.items.list(query);
  }

  @RequirePermission('items.view')
  @Get('lookup')
  @ApiOkResponse({ schema: toOpenApiSchema(ItemSchema) })
  lookup(@Query() query: Record<string, unknown>): Promise<Item> {
    return this.items.lookup(query);
  }

  @RequirePermission('items.view')
  @Post('labels')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(LabelResponseSchema) })
  labels(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<LabelResponse> {
    return this.items.labels(auth, body);
  }

  @RequirePermission('items.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(ItemSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Item> {
    return this.items.get(id);
  }

  @RequirePermission('items.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(ItemSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Item> {
    return this.items.create(auth, body);
  }

  @RequirePermission('items.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(ItemSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Item> {
    return this.items.update(auth, id, body);
  }

  @RequirePermission('items.manage')
  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(ItemSchema) })
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Item> {
    return this.items.setActive(auth, id, false);
  }

  @RequirePermission('items.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(ItemSchema) })
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Item> {
    return this.items.setActive(auth, id, true);
  }

  @RequirePermission('items.manage')
  @Post(':id/barcodes')
  @ApiCreatedResponse({ schema: toOpenApiSchema(ItemSchema) })
  addBarcode(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Item> {
    return this.items.addBarcode(auth, id, body);
  }

  @RequirePermission('items.manage')
  @Post(':id/barcodes/:barcodeId/remove')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(ItemSchema) })
  removeBarcode(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('barcodeId', new ParseUUIDPipe()) barcodeId: string,
  ): Promise<Item> {
    return this.items.removeBarcode(auth, id, barcodeId);
  }
}
