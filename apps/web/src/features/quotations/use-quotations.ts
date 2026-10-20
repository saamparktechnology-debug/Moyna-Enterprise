import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AssignUnitRequest,
  BuildUpdateRequest,
  CancelQuotationRequest,
  ConvertQuotationRequest,
  CreateQuotationRequest,
  QuotationVersionRequest,
  TakeAdvanceRequest,
  UpdateQuotationRequest,
} from '@erp/contracts';
import {
  acceptQuotation,
  assignUnit,
  cancelQuotation,
  convertQuotation,
  createQuotation,
  getQuotation,
  listQuotations,
  sendQuotation,
  takeAdvance,
  updateBuild,
  updateQuotation,
} from './quotations-api';
import type { QuotationListParams } from './quotations-api';

const KEY = 'quotations';

export const useQuotations = (params: QuotationListParams) =>
  useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listQuotations(params),
    placeholderData: keepPreviousData,
  });

export const useQuotation = (id: string) =>
  useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getQuotation(id) });

export function useQuotationMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  const refreshMoney = () =>
    Promise.all([
      refresh(),
      queryClient.invalidateQueries({ queryKey: ['payments'] }),
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    ]);
  const withId =
    <T>(call: (id: string, values: T) => Promise<unknown>) =>
    ({ id, values }: { id: string; values: T }) =>
      call(id, values);
  return {
    create: useMutation({
      mutationFn: (values: CreateQuotationRequest) => createQuotation(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: withId<UpdateQuotationRequest>(updateQuotation),
      onSuccess: refresh,
    }),
    send: useMutation({
      mutationFn: withId<QuotationVersionRequest>(sendQuotation),
      onSuccess: refresh,
    }),
    accept: useMutation({
      mutationFn: withId<QuotationVersionRequest>(acceptQuotation),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: withId<CancelQuotationRequest>(cancelQuotation),
      onSuccess: refresh,
    }),
    advance: useMutation({
      mutationFn: withId<TakeAdvanceRequest>(takeAdvance),
      onSuccess: refreshMoney,
    }),
    build: useMutation({
      mutationFn: withId<BuildUpdateRequest>(updateBuild),
      onSuccess: refresh,
    }),
    unit: useMutation({
      mutationFn: ({
        id,
        lineId,
        values,
      }: {
        id: string;
        lineId: string;
        values: AssignUnitRequest;
      }) => assignUnit(id, lineId, values),
      onSuccess: refresh,
    }),
    convert: useMutation({
      mutationFn: (values: ConvertQuotationRequest) => convertQuotation(values),
      onSuccess: refreshMoney,
    }),
  };
}
