import { Module } from '@nestjs/common';
import { ItemCategoriesController } from './item-categories.controller.js';
import { ItemCategoriesService } from './item-categories.service.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';

@Module({
  controllers: [ItemsController, ItemCategoriesController],
  providers: [ItemsService, ItemCategoriesService],
  exports: [ItemsService],
})
export class ItemsModule {}
