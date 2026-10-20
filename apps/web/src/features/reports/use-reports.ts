import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { ReportCode } from '@erp/contracts';
import { listBranchOptions } from '@/features/transfers/transfers-api';
import { getReport, listReports } from './reports-api';
import type { ReportParams } from './reports-api';

export const useReportCatalog = () =>
  useQuery({ queryKey: ['reports', 'catalog'], queryFn: listReports, staleTime: 60_000 });

export const useReportBranches = () =>
  useQuery({ queryKey: ['reports', 'branches'], queryFn: listBranchOptions, staleTime: 60_000 });

export const useReport = (
  code: ReportCode | null,
  params: ReportParams,
  usesPeriod: boolean,
  enabled: boolean,
) =>
  useQuery({
    queryKey: ['reports', 'run', code, params, usesPeriod],
    queryFn: () => getReport(code as ReportCode, params, usesPeriod),
    enabled: code !== null && enabled,
    placeholderData: keepPreviousData,
  });
