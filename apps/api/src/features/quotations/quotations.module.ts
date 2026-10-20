import { Module } from '@nestjs/common';
import { BrokersModule } from '../brokers/brokers.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { QuotationsController } from './quotations.controller.js';
import { QuotationsService } from './quotations.service.js';

@Module({
  imports: [BrokersModule, PaymentsModule],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
