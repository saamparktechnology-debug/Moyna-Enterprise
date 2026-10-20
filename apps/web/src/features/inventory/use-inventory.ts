import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveAdjustmentRequest,
  CancelAdjustmentRequest,
  CreateStockAdjustmentRequest,
  RejectAdjustmentRequest,
} from '@erp/contracts';
import {
  approveAdjustment,
  cancelAdjustment,
  createAdjustment,
  listAdjustments,
  listBalances,
  listLowStock,
  listMovements,
  listSerialUnits,
  rejectAdjustment,
} from './inventory-api';
import type {
  AdjustmentParams,
  BalanceParams,
  MovementParams,
  PageParams,
  SerialUnitParams,
} from './inventory-api';

const STOCK_KEY = 'stock';

export const useBalances = (params: BalanceParams) =>
  useQuery({
    queryKey: [STOCK_KEY, 'balances', params],
    queryFn: () => listBalances(params),
    placeholderData: keepPreviousData,
  });

export const useLowStock = (params: PageParams) =>
  useQuery({
    queryKey: [STOCK_KEY, 'low', params],
    queryFn: () => listLowStock(params),
    placeholderData: keepPreviousData,
  });

export const useMovements = (params: MovementParams) =>
  useQuery({
    queryKey: [STOCK_KEY, 'movements', params],
    queryFn: () => listMovements(params),
    placeholderData: keepPreviousData,
  });

export const useSerialUnits = (params: SerialUnitParams, enabled = true) =>
  useQuery({
    queryKey: [STOCK_KEY, 'serial', params],
    queryFn: () => listSerialUnits(params),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useAdjustments = (params: AdjustmentParams) =>
  useQuery({
    queryKey: [STOCK_KEY, 'adjustments', params],
    queryFn: () => listAdjustments(params),
    placeholderData: keepPreviousData,
  });

export function useAdjustmentMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [STOCK_KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateStockAdjustmentRequest) => createAdjustment(values),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ApproveAdjustmentRequest }) =>
        approveAdjustment(id, values),
      onSuccess: refresh,
    }),
    reject: useMutation({
      mutationFn: ({ id, values }: { id: string; values: RejectAdjustmentRequest }) =>
        rejectAdjustment(id, values),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: ({ id, values }: { id: string; values: CancelAdjustmentRequest }) =>
        cancelAdjustment(id, values),
      onSuccess: refresh,
    }),
  };
}
