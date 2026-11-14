import { Module } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import type { Env } from '../../common/config/env.js';
import { BillingModule } from '../billing/billing.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { MAIL_CLIENT, WHATSAPP_CLIENT, createMailClient, createWhatsAppClient } from './clients.js';
import { MessagingController } from './messaging.controller.js';
import { MessagingService } from './messaging.service.js';

@Module({
  imports: [BillingModule, PaymentsModule],
  controllers: [MessagingController],
  providers: [
    MessagingService,
    {
      provide: WHATSAPP_CLIENT,
      inject: [APP_CONFIG],
      useFactory: (env: Env) => createWhatsAppClient(env),
    },
    { provide: MAIL_CLIENT, inject: [APP_CONFIG], useFactory: (env: Env) => createMailClient(env) },
  ],
  exports: [WHATSAPP_CLIENT, MAIL_CLIENT],
})
export class MessagingModule {}
