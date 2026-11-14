//apps/api/src/features/items/items.module.ts

import { Module } from '@nestjs/common';
import { HsnCodesController } from './hsn-codes.controller.js';
import { HsnCodesService } from './hsn-codes.service.js';
import { ItemCategoriesController } from './item-categories.controller.js';
import { ItemCategoriesService } from './item-categories.service.js';
import { ItemsController } from './items.controller.js';
import { ItemsService } from './items.service.js';

@Module({
  controllers: [ItemsController, ItemCategoriesController, HsnCodesController],
  providers: [ItemsService, ItemCategoriesService, HsnCodesService],
  exports: [ItemsService],
})
export class ItemsModule {}
