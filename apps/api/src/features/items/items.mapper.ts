import { Prisma } from '@prisma/client';
import type { Item } from '@erp/contracts';

export const ITEM_INCLUDE = {
  category: true,
  unit: true,
  hsn: true,
  itemBarcodes: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ItemInclude;

export type ItemRow = Prisma.ItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

export function toItemDto(row: ItemRow): Item {
  return {
    id: row.id,
    itemCode: row.itemCode,
    name: row.name,
    categoryId: row.categoryId,
    categoryName: row.category.name,
    unitCode: row.unitCode,
    unitName: row.unit.name,
    hsnCode: row.hsnCode,
    hsnDescription: row.hsn?.description ?? null,
    taxRate: row.taxRate === null ? null : row.taxRate.toFixed(2),
    reorderLevel: row.reorderLevel,
    isSerialized: row.isSerialized,
    isActive: row.isActive,
    barcodes: row.itemBarcodes.map((barcode) => ({ id: barcode.id, barcode: barcode.barcode })),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function itemSnapshot(row: ItemRow): Record<string, unknown> {
  return {
    itemCode: row.itemCode,
    name: row.name,
    categoryId: row.categoryId,
    unitCode: row.unitCode,
    hsnCode: row.hsnCode,
    taxRate: row.taxRate === null ? null : row.taxRate.toFixed(2),
    reorderLevel: row.reorderLevel,
    isSerialized: row.isSerialized,
    isActive: row.isActive,
  };
}
