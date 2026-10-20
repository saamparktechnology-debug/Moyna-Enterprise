import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  AttendanceListResponseSchema,
  AttendanceSchema,
  DepartmentListResponseSchema,
  GeneratePayrollResponseSchema,
  LeaveListResponseSchema,
  LeaveSchema,
  MyAttendanceSchema,
  PayrollListResponseSchema,
  PayrollSchema,
  StaffCandidateListResponseSchema,
  StaffListResponseSchema,
  StaffSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  Attendance,
  AttendanceListResponse,
  DepartmentOption,
  GeneratePayrollResponse,
  Leave,
  LeaveListResponse,
  MyAttendance,
  Payroll,
  PayrollListResponse,
  Staff,
  StaffCandidate,
  StaffListResponse,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { AttendanceService } from './attendance.service.js';
import { LeaveService } from './leave.service.js';
import { PayrollService } from './payroll.service.js';
import { StaffService } from './staff.service.js';

@ApiTags('hr')
@ApiCookieAuth()
@Controller('staff')
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}

  @RequirePermission('hr.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(StaffListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<StaffListResponse> {
    return this.staff.list(auth, query);
  }

  @RequirePermission('hr.view')
  @Get('departments')
  @ApiOkResponse({ schema: toOpenApiSchema(DepartmentListResponseSchema) })
  departments(): Promise<DepartmentOption[]> {
    return this.staff.departments();
  }

  /** The signed-in person's own staff profile (404 when they have none). */
  @RequirePermission('hr.view')
  @Get('me')
  @ApiOkResponse({ schema: toOpenApiSchema(StaffSchema) })
  mine(@CurrentAuth() auth: AuthContext): Promise<Staff> {
    return this.staff.mine(auth);
  }

  @RequirePermission('hr.manage')
  @Get('candidates')
  @ApiOkResponse({ schema: toOpenApiSchema(StaffCandidateListResponseSchema) })
  candidates(@Query('branchId') branchId?: string): Promise<StaffCandidate[]> {
    return this.staff.candidates(branchId);
  }

  @RequirePermission('hr.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(StaffSchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Staff> {
    return this.staff.get(auth, id);
  }

  @RequirePermission('hr.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(StaffSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Staff> {
    return this.staff.create(auth, body);
  }

  @RequirePermission('hr.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(StaffSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Staff> {
    return this.staff.update(auth, id, body);
  }

  @RequirePermission('hr.manage')
  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(StaffSchema) })
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Staff> {
    return this.staff.deactivate(auth, id, body);
  }

  @RequirePermission('hr.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(StaffSchema) })
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Staff> {
    return this.staff.reactivate(auth, id, body);
  }
}

@ApiTags('hr')
@ApiCookieAuth()
@Controller('attendance')
export class AttendanceController {
  constructor(@Inject(AttendanceService) private readonly attendance: AttendanceService) {}

  @RequirePermission('attendance.mark')
  @Get('me')
  @ApiOkResponse({ schema: toOpenApiSchema(MyAttendanceSchema) })
  mine(@CurrentAuth() auth: AuthContext): Promise<MyAttendance> {
    return this.attendance.mine(auth);
  }

  @RequirePermission('attendance.mark')
  @Post('check-in')
  @ApiCreatedResponse({ schema: toOpenApiSchema(AttendanceSchema) })
  checkIn(@CurrentAuth() auth: AuthContext): Promise<Attendance> {
    return this.attendance.checkIn(auth);
  }

  @RequirePermission('attendance.mark')
  @Post('check-out')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(AttendanceSchema) })
  checkOut(@CurrentAuth() auth: AuthContext): Promise<Attendance> {
    return this.attendance.checkOut(auth);
  }

  @RequirePermission('hr.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(AttendanceListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<AttendanceListResponse> {
    return this.attendance.list(auth, query);
  }

  /** A manager sets or corrects a day's attendance. */
  @RequirePermission('hr.manage')
  @Put('correct')
  @ApiOkResponse({ schema: toOpenApiSchema(AttendanceSchema) })
  correct(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Attendance> {
    return this.attendance.correct(auth, body);
  }
}

@ApiTags('hr')
@ApiCookieAuth()
@Controller('leave')
export class LeaveController {
  constructor(@Inject(LeaveService) private readonly leave: LeaveService) {}

  @RequirePermission('hr.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(LeaveListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<LeaveListResponse> {
    return this.leave.list(auth, query);
  }

  @RequirePermission('hr.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(LeaveSchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Leave> {
    return this.leave.get(auth, id);
  }

  /** Leave for oneself needs `leave.request`; for someone else it also needs `hr.manage`. */
  @RequirePermission('leave.request')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(LeaveSchema) })
  request(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Leave> {
    return this.leave.request(auth, body);
  }

  @RequirePermission('hr.manage')
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(LeaveSchema) })
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Leave> {
    return this.leave.approve(auth, id, body);
  }

  @RequirePermission('hr.manage')
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(LeaveSchema) })
  reject(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Leave> {
    return this.leave.reject(auth, id, body);
  }

  @RequirePermission('leave.request')
  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(LeaveSchema) })
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Leave> {
    return this.leave.cancel(auth, id, body);
  }
}

@ApiTags('hr')
@ApiCookieAuth()
@Controller('payroll')
export class PayrollController {
  constructor(@Inject(PayrollService) private readonly payroll: PayrollService) {}

  @RequirePermission('hr.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(PayrollListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<PayrollListResponse> {
    return this.payroll.list(auth, query);
  }

  @RequirePermission('hr.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(PayrollSchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Payroll> {
    return this.payroll.get(auth, id);
  }

  /** Makes a draft record for everyone employed in a month that has ended. */
  @RequirePermission('hr.manage')
  @Post('generate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(GeneratePayrollResponseSchema) })
  generate(
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
  ): Promise<GeneratePayrollResponse> {
    return this.payroll.generate(auth, body);
  }

  @RequirePermission('hr.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(PayrollSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Payroll> {
    return this.payroll.update(auth, id, body);
  }

  @RequirePermission('hr.manage')
  @Post(':id/finalize')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(PayrollSchema) })
  finalize(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Payroll> {
    return this.payroll.finalize(auth, id, body);
  }
}
