import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddBarcodeRequest,
  CreateItemCategoryRequest,
  CreateItemRequest,
  LabelRequest,
  UpdateItemCategoryRequest,
  UpdateItemRequest,
} from '@erp/contracts';
import {
  addBarcode,
  buildLabels,
  createCategory,
  createItem,
  listCategories,
  listGstRates,
  listItems,
  listUnits,
  lookupItem,
  removeBarcode,
  searchHsn,
  setItemActive,
  updateCategory,
  updateItem,
} from './items-api';
import type { ItemListParams } from './items-api';

const ITEMS_KEY = 'items';
const CATEGORIES_KEY = 'item-categories';

export function useItems(params: ItemListParams, enabled = true) {
  return useQuery({
    queryKey: [ITEMS_KEY, params],
    queryFn: () => listItems(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCategories() {
  return useQuery({ queryKey: [CATEGORIES_KEY], queryFn: listCategories });
}
export function useUnits() {
  return useQuery({ queryKey: ['reference', 'units'], queryFn: listUnits, staleTime: Infinity });
}
export function useGstRates() {
  return useQuery({
    queryKey: ['reference', 'gst-rates'],
    queryFn: listGstRates,
    staleTime: Infinity,
  });
}
export function useHsnSuggestions(search: string) {
  return useQuery({
    queryKey: ['reference', 'hsn', search],
    queryFn: () => searchHsn(search),
    enabled: search.length >= 2,
    staleTime: 60_000,
  });
}

export function useItemLookup() {
  return useMutation({ mutationFn: (barcode: string) => lookupItem(barcode) });
}

export function useBuildLabels() {
  return useMutation({ mutationFn: (values: LabelRequest) => buildLabels(values) });
}

export function useItemMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [ITEMS_KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateItemRequest) => createItem(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateItemRequest }) =>
        updateItem(id, values),
      onSuccess: refresh,
    }),
    setActive: useMutation({
      mutationFn: ({ id, active }: { id: string; active: boolean }) => setItemActive(id, active),
      onSuccess: refresh,
    }),
    addBarcode: useMutation({
      mutationFn: ({ id, values }: { id: string; values: AddBarcodeRequest }) =>
        addBarcode(id, values),
      onSuccess: refresh,
    }),
    removeBarcode: useMutation({
      mutationFn: ({ id, barcodeId }: { id: string; barcodeId: string }) =>
        removeBarcode(id, barcodeId),
      onSuccess: refresh,
    }),
  };
}

export function useCategoryMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: [CATEGORIES_KEY] });
    return queryClient.invalidateQueries({ queryKey: [ITEMS_KEY] });
  };
  return {
    create: useMutation({
      mutationFn: (values: CreateItemCategoryRequest) => createCategory(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateItemCategoryRequest }) =>
        updateCategory(id, values),
      onSuccess: refresh,
    }),
  };
}
