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
} from '@erp/contracts';
import type {
  ApproveLeaveRequest,
  Attendance,
  AttendanceListResponse,
  CancelLeaveRequest,
  CorrectAttendanceRequest,
  CreateLeaveRequest,
  CreateStaffRequest,
  DeactivateStaffRequest,
  DepartmentOption,
  FinalizePayrollRequest,
  GeneratePayrollRequest,
  GeneratePayrollResponse,
  Leave,
  LeaveListResponse,
  MyAttendance,
  Payroll,
  PayrollListResponse,
  ReactivateStaffRequest,
  RejectLeaveRequest,
  Staff,
  StaffCandidate,
  StaffListResponse,
  UpdatePayrollRequest,
  UpdateStaffRequest,
} from '@erp/contracts';
import { ApiError } from '@/lib/api-client';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export interface StaffListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  department: string;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}
export interface AttendanceListParams {
  page: number;
  pageSize: number;
  month: string;
  staffId?: string;
}
export interface LeaveListParams {
  page: number;
  pageSize: number;
  status: string;
  month: string;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}
export interface PayrollListParams {
  page: number;
  pageSize: number;
  month: string;
  status: string;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

// ---------- staff ----------
export const listStaff = (params: StaffListParams): Promise<StaffListResponse> =>
  api.get(
    `/staff?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    StaffListResponseSchema,
  );

/** The signed-in person's own profile, or null when they have none (the server answers 404). */
export async function getMyStaff(): Promise<Staff | null> {
  try {
    return await api.get('/staff/me', StaffSchema);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
export const listDepartments = (): Promise<DepartmentOption[]> =>
  api.get('/staff/departments', DepartmentListResponseSchema);
export const listCandidates = (): Promise<StaffCandidate[]> =>
  api.get('/staff/candidates', StaffCandidateListResponseSchema);
export const createStaff = (values: CreateStaffRequest): Promise<Staff> =>
  api.post('/staff', values, StaffSchema);
export const updateStaff = (id: string, values: UpdateStaffRequest): Promise<Staff> =>
  api.patch(`/staff/${id}`, values, StaffSchema);
export const deactivateStaff = (id: string, values: DeactivateStaffRequest): Promise<Staff> =>
  api.post(`/staff/${id}/deactivate`, values, StaffSchema);
export const reactivateStaff = (id: string, values: ReactivateStaffRequest): Promise<Staff> =>
  api.post(`/staff/${id}/reactivate`, values, StaffSchema);

// ---------- attendance ----------
export const getMyAttendance = (): Promise<MyAttendance> =>
  api.get('/attendance/me', MyAttendanceSchema);
export const checkIn = (): Promise<Attendance> =>
  api.post('/attendance/check-in', {}, AttendanceSchema);
export const checkOut = (): Promise<Attendance> =>
  api.post('/attendance/check-out', {}, AttendanceSchema);
export const listAttendance = (params: AttendanceListParams): Promise<AttendanceListResponse> =>
  api.get(`/attendance?${query({ ...params })}`, AttendanceListResponseSchema);
export const correctAttendance = (values: CorrectAttendanceRequest): Promise<Attendance> =>
  api.put('/attendance/correct', values, AttendanceSchema);

// ---------- leave ----------
export const listLeave = (params: LeaveListParams): Promise<LeaveListResponse> =>
  api.get(
    `/leave?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    LeaveListResponseSchema,
  );
export const requestLeave = (values: CreateLeaveRequest): Promise<Leave> =>
  api.post('/leave', values, LeaveSchema);
export const approveLeave = (id: string, values: ApproveLeaveRequest): Promise<Leave> =>
  api.post(`/leave/${id}/approve`, values, LeaveSchema);
export const rejectLeave = (id: string, values: RejectLeaveRequest): Promise<Leave> =>
  api.post(`/leave/${id}/reject`, values, LeaveSchema);
export const cancelLeave = (id: string, values: CancelLeaveRequest): Promise<Leave> =>
  api.post(`/leave/${id}/cancel`, values, LeaveSchema);

// ---------- payroll ----------
export const listPayroll = (params: PayrollListParams): Promise<PayrollListResponse> =>
  api.get(
    `/payroll?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    PayrollListResponseSchema,
  );
export const generatePayroll = (values: GeneratePayrollRequest): Promise<GeneratePayrollResponse> =>
  api.post('/payroll/generate', values, GeneratePayrollResponseSchema);
export const updatePayroll = (id: string, values: UpdatePayrollRequest): Promise<Payroll> =>
  api.patch(`/payroll/${id}`, values, PayrollSchema);
export const finalizePayroll = (id: string, values: FinalizePayrollRequest): Promise<Payroll> =>
  api.post(`/payroll/${id}/finalize`, values, PayrollSchema);
