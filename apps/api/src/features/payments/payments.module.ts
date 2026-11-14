//apps/api/src/features/payments/payments.module.ts
import { Module } from '@nestjs/common';
import { DueFollowupController } from './due-followup.controller.js';
import { DueFollowupService } from './due-followup.service.js';
import { DuesController } from './dues.controller.js';
import { DuesService } from './dues.service.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { RefundsController } from './refunds.controller.js';
import { RefundsService } from './refunds.service.js';

@Module({
  controllers: [PaymentsController, DuesController, DueFollowupController, RefundsController],
  providers: [PaymentsService, DuesService, DueFollowupService, RefundsService],
  exports: [PaymentsService, DuesService, RefundsService],
})
export class PaymentsModule {}
