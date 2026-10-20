import { Module } from '@nestjs/common';
import { DuesController } from './dues.controller.js';
import { DuesService } from './dues.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { RefundsController } from './refunds.controller.js';
import { RefundsService } from './refunds.service.js';

@Module({
  controllers: [PaymentsController, DuesController, RefundsController],
  providers: [PaymentsService, DuesService, RefundsService],
  exports: [PaymentsService, DuesService, RefundsService],
})
export class PaymentsModule {}
