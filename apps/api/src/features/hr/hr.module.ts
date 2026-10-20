import { Module } from '@nestjs/common';
import { AttendanceService } from './attendance.service.js';
import {
  AttendanceController,
  LeaveController,
  PayrollController,
  StaffController,
} from './hr.controller.js';
import { LeaveService } from './leave.service.js';
import { PayrollService } from './payroll.service.js';
import { StaffService } from './staff.service.js';

@Module({
  controllers: [StaffController, AttendanceController, LeaveController, PayrollController],
  providers: [StaffService, AttendanceService, LeaveService, PayrollService],
  exports: [StaffService, AttendanceService, LeaveService, PayrollService],
})
export class HrModule {}
