import { Module } from '@nestjs/common';
import { DashboardsController } from './dashboards.controller.js';
import { DashboardsService } from './dashboards.service.js';

@Module({
  controllers: [DashboardsController],
  providers: [DashboardsService],
})
export class DashboardsModule {}
