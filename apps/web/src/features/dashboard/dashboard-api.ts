import { BranchDashboardSchema, CompanyDashboardSchema } from '@erp/contracts';
import type { BranchDashboard, CompanyDashboard } from '@erp/contracts';
import { api } from '@/lib/api';

export interface DashboardParams {
  from: string;
  to: string;
  withinDays?: number;
}

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export const getCompanyDashboard = (params: DashboardParams): Promise<CompanyDashboard> =>
  api.get(`/dashboards/company?${query({ ...params })}`, CompanyDashboardSchema);

export const getBranchDashboard = (
  branchId: string,
  params: DashboardParams,
): Promise<BranchDashboard> =>
  api.get(`/dashboards/branch?${query({ branchId, ...params })}`, BranchDashboardSchema);
