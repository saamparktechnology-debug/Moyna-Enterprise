import {
  GstRateListResponseSchema,
  HsnListResponseSchema,
  ItemCategoryListResponseSchema,
  ItemCategorySchema,
  ItemListResponseSchema,
  ItemSchema,
  LabelResponseSchema,
  UnitListResponseSchema,
} from '@erp/contracts';
import type {
  AddBarcodeRequest,
  CreateItemCategoryRequest,
  CreateItemRequest,
  GstRate,
  HsnListResponse,
  Item,
  ItemCategory,
  ItemListQuery,
  ItemListResponse,
  LabelRequest,
  LabelResponse,
  Unit,
  UpdateItemCategoryRequest,
  UpdateItemRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface ItemListParams {
  page: number;
  pageSize: number;
  search: string;
  categoryId: string;
  status: ItemListQuery['status'];
  tracking: ItemListQuery['tracking'];
  /** One of `ITEM_SORT_FIELDS`. Left out until the person picks a column, so the server's order applies. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export function listItems(params: ItemListParams): Promise<ItemListResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    status: params.status,
    tracking: params.tracking,
  });
  if (params.search) query.set('search', params.search);
  if (params.categoryId) query.set('categoryId', params.categoryId);
  if (params.sortBy) {
    query.set('sortBy', params.sortBy);
    query.set('sortOrder', params.sortOrder ?? 'asc');
  }
  return api.get(`/items?${query.toString()}`, ItemListResponseSchema);
}

export function lookupItem(barcode: string): Promise<Item> {
  return api.get(`/items/lookup?barcode=${encodeURIComponent(barcode)}`, ItemSchema);
}

export function createItem(values: CreateItemRequest): Promise<Item> {
  return api.post('/items', values, ItemSchema);
}

export function updateItem(id: string, values: UpdateItemRequest): Promise<Item> {
  return api.patch(`/items/${id}`, values, ItemSchema);
}

export function setItemActive(id: string, active: boolean): Promise<Item> {
  return api.post(`/items/${id}/${active ? 'reactivate' : 'deactivate'}`, {}, ItemSchema);
}

export function addBarcode(id: string, values: AddBarcodeRequest): Promise<Item> {
  return api.post(`/items/${id}/barcodes`, values, ItemSchema);
}

export function removeBarcode(id: string, barcodeId: string): Promise<Item> {
  return api.post(`/items/${id}/barcodes/${barcodeId}/remove`, {}, ItemSchema);
}

export function buildLabels(values: LabelRequest): Promise<LabelResponse> {
  return api.post('/items/labels', values, LabelResponseSchema);
}

export function listCategories(): Promise<ItemCategory[]> {
  return api.get('/item-categories', ItemCategoryListResponseSchema);
}

export function createCategory(values: CreateItemCategoryRequest): Promise<ItemCategory> {
  return api.post('/item-categories', values, ItemCategorySchema);
}

export function updateCategory(
  id: string,
  values: UpdateItemCategoryRequest,
): Promise<ItemCategory> {
  return api.patch(`/item-categories/${id}`, values, ItemCategorySchema);
}

export function listUnits(): Promise<Unit[]> {
  return api.get('/reference/units', UnitListResponseSchema);
}

export function listGstRates(): Promise<GstRate[]> {
  return api.get('/reference/gst-rates', GstRateListResponseSchema);
}

export function searchHsn(search: string): Promise<HsnListResponse> {
  const query = new URLSearchParams({ page: '1', pageSize: '20' });
  if (search) query.set('search', search);
  return api.get(`/reference/hsn-codes?${query.toString()}`, HsnListResponseSchema);
}
