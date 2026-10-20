import { Module } from '@nestjs/common';
import { ItemsModule } from '../items/items.module.js';
import { StockModule } from '../stock/stock.module.js';
import { TransfersController } from './transfers.controller.js';
import { TransfersService } from './transfers.service.js';

@Module({
  imports: [StockModule, ItemsModule],
  controllers: [TransfersController],
  providers: [TransfersService],
  exports: [TransfersService],
})
export class TransfersModule {}
