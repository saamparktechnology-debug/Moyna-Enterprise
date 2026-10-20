import { Module } from '@nestjs/common';
import { BatteriesModule } from '../batteries/batteries.module.js';
import { BrokersModule } from '../brokers/brokers.module.js';
import { QuotationsModule } from '../quotations/quotations.module.js';
import { StockModule } from '../stock/stock.module.js';
import { BillingController } from './billing.controller.js';
import { CreditNotesController } from './credit-notes.controller.js';
import { CreditNotesService } from './credit-notes.service.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [StockModule, BatteriesModule, BrokersModule, QuotationsModule],
  controllers: [BillingController, CreditNotesController],
  providers: [BillingService, CreditNotesService],
  exports: [BillingService, CreditNotesService],
})
export class BillingModule {}
