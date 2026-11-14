//apps/web/src/features/hr/use-hr.ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveLeaveRequest,
  CancelLeaveRequest,
  CorrectAttendanceRequest,
  CreateLeaveRequest,
  CreatePunchRequest,
  CreateStaffRequest,
  DeactivateStaffRequest,
  FinalizePayrollRequest,
  GeneratePayrollRequest,
  ReactivateStaffRequest,
  RejectLeaveRequest,
  RemovePunchRequest,
  UpdatePayrollRequest,
  UpdatePunchRequest,
  UpdateStaffRequest,
} from '@erp/contracts';
import {
  approveLeave,
  cancelLeave,
  checkIn,
  checkOut,
  correctAttendance,
  createPunch,
  createStaff,
  deactivateStaff,
  finalizePayroll,
  generatePayroll,
  getMyAttendance,
  getMyStaff,
  listAttendance,
  listCandidates,
  listDepartments,
  listLeave,
  listPayroll,
  listPunches,
  listStaff,
  reactivateStaff,
  rejectLeave,
  removePunch,
  requestLeave,
  updatePayroll,
  updatePunch,
  updateStaff,
} from './hr-api';
import type {
  AttendanceListParams,
  LeaveListParams,
  PayrollListParams,
  StaffListParams,
} from './hr-api';

const KEY = 'hr';

export const useStaffList = (params: StaffListParams, enabled = true) =>
  useQuery({
    queryKey: [KEY, 'staff', params],
    queryFn: () => listStaff(params),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useMyStaff = () =>
  useQuery({ queryKey: [KEY, 'me'], queryFn: getMyStaff, retry: false });
export const useDepartments = () =>
  useQuery({ queryKey: [KEY, 'departments'], queryFn: listDepartments, staleTime: Infinity });
export const useCandidates = (enabled: boolean) =>
  useQuery({ queryKey: [KEY, 'candidates'], queryFn: listCandidates, enabled });
export const useMyAttendance = (enabled: boolean) =>
  useQuery({ queryKey: [KEY, 'my-day'], queryFn: getMyAttendance, enabled, retry: false });
export const usePunches = (date: string, staffId: string, enabled = true) =>
  useQuery({
    queryKey: [KEY, 'punches', date, staffId],
    queryFn: () => listPunches(date, staffId || undefined),
    placeholderData: keepPreviousData,
    enabled,
  });
export const useAttendance = (params: AttendanceListParams) =>
  useQuery({
    queryKey: [KEY, 'attendance', params],
    queryFn: () => listAttendance(params),
    placeholderData: keepPreviousData,
  });
export const useLeave = (params: LeaveListParams) =>
  useQuery({
    queryKey: [KEY, 'leave', params],
    queryFn: () => listLeave(params),
    placeholderData: keepPreviousData,
  });
export const usePayroll = (params: PayrollListParams) =>
  useQuery({
    queryKey: [KEY, 'payroll', params],
    queryFn: () => listPayroll(params),
    placeholderData: keepPreviousData,
  });

export function useHrMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    createStaff: useMutation({
      mutationFn: (v: CreateStaffRequest) => createStaff(v),
      onSuccess: refresh,
    }),
    updateStaff: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateStaffRequest }) =>
        updateStaff(id, values),
      onSuccess: refresh,
    }),
    deactivate: useMutation({
      mutationFn: ({ id, values }: { id: string; values: DeactivateStaffRequest }) =>
        deactivateStaff(id, values),
      onSuccess: refresh,
    }),
    reactivate: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ReactivateStaffRequest }) =>
        reactivateStaff(id, values),
      onSuccess: refresh,
    }),
    checkIn: useMutation({ mutationFn: checkIn, onSuccess: refresh }),
    checkOut: useMutation({ mutationFn: checkOut, onSuccess: refresh }),
    correct: useMutation({
      mutationFn: (v: CorrectAttendanceRequest) => correctAttendance(v),
      onSuccess: refresh,
    }),
    addPunch: useMutation({
      mutationFn: (v: CreatePunchRequest) => createPunch(v),
      onSuccess: refresh,
    }),
    editPunch: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdatePunchRequest }) =>
        updatePunch(id, values),
      onSuccess: refresh,
    }),
    deletePunch: useMutation({
      mutationFn: ({ id, values }: { id: string; values: RemovePunchRequest }) =>
        removePunch(id, values),
      onSuccess: refresh,
    }),
    requestLeave: useMutation({
      mutationFn: (v: CreateLeaveRequest) => requestLeave(v),
      onSuccess: refresh,
    }),
    approveLeave: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ApproveLeaveRequest }) =>
        approveLeave(id, values),
      onSuccess: refresh,
    }),
    rejectLeave: useMutation({
      mutationFn: ({ id, values }: { id: string; values: RejectLeaveRequest }) =>
        rejectLeave(id, values),
      onSuccess: refresh,
    }),
    cancelLeave: useMutation({
      mutationFn: ({ id, values }: { id: string; values: CancelLeaveRequest }) =>
        cancelLeave(id, values),
      onSuccess: refresh,
    }),
    generate: useMutation({
      mutationFn: (v: GeneratePayrollRequest) => generatePayroll(v),
      onSuccess: refresh,
    }),
    updatePayroll: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdatePayrollRequest }) =>
        updatePayroll(id, values),
      onSuccess: refresh,
    }),
    finalize: useMutation({
      mutationFn: ({ id, values }: { id: string; values: FinalizePayrollRequest }) =>
        finalizePayroll(id, values),
      onSuccess: refresh,
    }),
  };
}
