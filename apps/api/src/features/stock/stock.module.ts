import { Module } from '@nestjs/common';
import { StockAdjustmentsController } from './stock-adjustments.controller.js';
import { StockAdjustmentsService } from './stock-adjustments.service.js';
import { StockPostingService } from './stock-posting.service.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({
  controllers: [StockController, StockAdjustmentsController],
  providers: [StockService, StockAdjustmentsService, StockPostingService],
  exports: [StockPostingService],
})
export class StockModule {}
