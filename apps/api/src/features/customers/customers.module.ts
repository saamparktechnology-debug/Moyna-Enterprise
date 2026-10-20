import { Module } from '@nestjs/common';
import { CustomersController } from './customers.controller.js';
import { CustomersService } from './customers.service.js';
import { KycService } from './kyc.service.js';

@Module({
  controllers: [CustomersController],
  providers: [CustomersService, KycService],
  exports: [CustomersService],
})
export class CustomersModule {}
