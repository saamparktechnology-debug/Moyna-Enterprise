import { Body, Controller, Get, Inject, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  ItemCategoryListResponseSchema,
  ItemCategorySchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { ItemCategory } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { ItemCategoriesService } from './item-categories.service.js';

@ApiTags('items')
@ApiCookieAuth()
@Controller('item-categories')
export class ItemCategoriesController {
  constructor(@Inject(ItemCategoriesService) private readonly categories: ItemCategoriesService) {}

  @RequirePermission('items.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(ItemCategoryListResponseSchema) })
  list(): Promise<ItemCategory[]> {
    return this.categories.list();
  }

  @RequirePermission('items.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(ItemCategorySchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<ItemCategory> {
    return this.categories.create(auth, body);
  }

  @RequirePermission('items.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(ItemCategorySchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<ItemCategory> {
    return this.categories.update(auth, id, body);
  }
}
