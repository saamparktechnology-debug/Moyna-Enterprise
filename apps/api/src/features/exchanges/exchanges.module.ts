import { Module } from '@nestjs/common';
import { BrokersModule } from '../brokers/brokers.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { StockModule } from '../stock/stock.module.js';
import { ExchangesController } from './exchanges.controller.js';
import { ExchangesService } from './exchanges.service.js';

@Module({
  imports: [StockModule, PaymentsModule, BrokersModule],
  controllers: [ExchangesController],
  providers: [ExchangesService],
  exports: [ExchangesService],
})
export class ExchangesModule {}
