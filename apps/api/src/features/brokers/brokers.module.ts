import { Module } from '@nestjs/common';
import { BrokersController, CommissionsController } from './brokers.controller.js';
import { BrokersService } from './brokers.service.js';
import { CommissionsService } from './commissions.service.js';

@Module({
  controllers: [BrokersController, CommissionsController],
  providers: [BrokersService, CommissionsService],
  exports: [BrokersService, CommissionsService],
})
export class BrokersModule {}
