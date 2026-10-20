import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { getBranchDashboard, getCompanyDashboard } from './dashboard-api';
import type { DashboardParams } from './dashboard-api';

export const useCompanyDashboard = (params: DashboardParams, enabled: boolean) =>
  useQuery({
    queryKey: ['dashboards', 'company', params],
    queryFn: () => getCompanyDashboard(params),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useBranchDashboard = (branchId: string | null, params: DashboardParams) =>
  useQuery({
    queryKey: ['dashboards', 'branch', branchId, params],
    queryFn: () => getBranchDashboard(branchId as string, params),
    placeholderData: keepPreviousData,
    enabled: branchId !== null,
  });
