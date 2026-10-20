import { Module } from '@nestjs/common';
import { FollowupsService } from './followups.service.js';
import { LeadSourcesController } from './lead-sources.controller.js';
import { LeadSourcesService } from './lead-sources.service.js';
import { FollowupsController, LeadsController } from './leads.controller.js';
import { LeadsService } from './leads.service.js';

@Module({
  controllers: [LeadsController, FollowupsController, LeadSourcesController],
  providers: [LeadsService, FollowupsService, LeadSourcesService],
  exports: [LeadsService, FollowupsService, LeadSourcesService],
})
export class LeadsModule {}
