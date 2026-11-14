//apps\api\src\features\hr\hr.module.ts
import { Module } from '@nestjs/common';
import { AgreementsController, AgreementTemplatesController } from './agreements.controller.js';
import { AgreementsService } from './agreements.service.js';
import { AttendanceService } from './attendance.service.js';
import {
  AttendanceController,
  LeaveController,
  PayrollController,
  StaffController,
} from './hr.controller.js';
import { LeaveService } from './leave.service.js';
import { PayrollService } from './payroll.service.js';
import { HolidaysController, RosterController } from './roster.controller.js';
import { RosterService } from './roster.service.js';
import { StaffService } from './staff.service.js';

@Module({
  controllers: [
    StaffController,
    AttendanceController,
    LeaveController,
    PayrollController,
    AgreementsController,
    AgreementTemplatesController,
    HolidaysController,
    RosterController,
  ],
  providers: [
    StaffService,
    AttendanceService,
    LeaveService,
    PayrollService,
    AgreementsService,
    RosterService,
  ],
  exports: [StaffService, AttendanceService, LeaveService, PayrollService],
})
export class HrModule {}
