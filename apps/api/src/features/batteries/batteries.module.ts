import { Module } from '@nestjs/common';
import { StockModule } from '../stock/stock.module.js';
import { BatteriesController } from './batteries.controller.js';
import { BatteriesService } from './batteries.service.js';

@Module({
  imports: [StockModule],
  controllers: [BatteriesController],
  providers: [BatteriesService],
  exports: [BatteriesService],
})
export class BatteriesModule {}
