import { describe, expect, it } from 'vitest';
import {
  AddBarcodeRequestSchema,
  BarcodeSchema,
  CreateItemCategoryRequestSchema,
  CreateItemRequestSchema,
  ItemListQuerySchema,
  LabelRequestSchema,
  UpdateItemCategoryRequestSchema,
  UpdateItemRequestSchema,
} from './items.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const third = '33333333-3333-4333-8333-333333333333';
const base = { itemCode: ' toto-x1 ', name: ' TOTO X1 ', categoryId: id, unitCode: 'pcs' };

describe('creating an item', () => {
  it('tidies the code, name and unit and fills in the defaults', () => {
    expect(CreateItemRequestSchema.parse(base)).toEqual({
      itemCode: 'TOTO-X1',
      name: 'TOTO X1',
      categoryId: id,
      unitCode: 'PCS',
      hsnCode: null,
      taxRate: null,
      reorderLevel: 0,
      isSerialized: false,
      generateBarcode: false,
    });
  });

  it('refuses bad codes, names, references and numbers', () => {
    const bad = (over: object) => CreateItemRequestSchema.safeParse({ ...base, ...over }).success;
    expect(bad({ itemCode: 'x' })).toBe(false);
    expect(bad({ itemCode: 'has space' })).toBe(false);
    expect(bad({ itemCode: 'A'.repeat(33) })).toBe(false);
    expect(bad({ name: ' ' })).toBe(false);
    expect(bad({ categoryId: 'nope' })).toBe(false);
    expect(bad({ unitCode: '' })).toBe(false);
    expect(bad({ hsnCode: '12' })).toBe(false);
    expect(bad({ hsnCode: '8703' })).toBe(true);
    expect(bad({ taxRate: 'five' })).toBe(false);
    expect(bad({ taxRate: '18.5' })).toBe(true);
    expect(bad({ reorderLevel: -1 })).toBe(false);
    expect(bad({ reorderLevel: 1.5 })).toBe(false);
  });

  it('refuses a typed and a generated barcode together', () => {
    const result = CreateItemRequestSchema.safeParse({
      ...base,
      barcode: 'MFR-123456',
      generateBarcode: true,
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['barcode']);
  });
});

describe('barcodes', () => {
  it('accepts 4 to 48 visible characters and checks 13-digit codes', () => {
    expect(BarcodeSchema.safeParse(' MFR-123456 ').data).toBe('MFR-123456');
    expect(BarcodeSchema.safeParse('abc').success).toBe(false);
    expect(BarcodeSchema.safeParse('has space').success).toBe(false);
    expect(BarcodeSchema.safeParse('A'.repeat(49)).success).toBe(false);
    expect(BarcodeSchema.safeParse('4006381333931').success).toBe(true);
    expect(BarcodeSchema.safeParse('4006381333932').success).toBe(false);
  });

  it('adds either a typed barcode or a generated one, never both or neither', () => {
    expect(AddBarcodeRequestSchema.safeParse({ generate: true }).success).toBe(true);
    expect(AddBarcodeRequestSchema.safeParse({ barcode: 'MFR-123456' }).success).toBe(true);
    expect(AddBarcodeRequestSchema.safeParse({ generate: false }).success).toBe(false);
    expect(AddBarcodeRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('updating an item', () => {
  it('needs the row version and at least one change', () => {
    expect(UpdateItemRequestSchema.safeParse({ name: 'New' }).success).toBe(false);
    expect(UpdateItemRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateItemRequestSchema.safeParse({ rowVersion: 0, name: 'New' }).success).toBe(false);
    expect(UpdateItemRequestSchema.safeParse({ rowVersion: 1, name: 'New' }).success).toBe(true);
  });

  it('lets the HSN code and GST rate be cleared with null', () => {
    const parsed = UpdateItemRequestSchema.parse({ rowVersion: 2, hsnCode: null, taxRate: null });
    expect(parsed).toMatchObject({ hsnCode: null, taxRate: null });
  });
});

describe('the item list query', () => {
  it('has safe defaults and rejects unknown choices', () => {
    expect(ItemListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      status: 'active',
      tracking: 'any',
    });
    expect(ItemListQuerySchema.safeParse({ status: 'deleted' }).success).toBe(false);
    expect(ItemListQuerySchema.safeParse({ tracking: 'x' }).success).toBe(false);
    expect(ItemListQuerySchema.safeParse({ categoryId: 'nope' }).success).toBe(false);
    expect(ItemListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});

describe('label requests', () => {
  const line = (itemId: string, copies: number) => ({ itemId, copies });
  it('accepts up to 500 labels in total', () => {
    expect(
      LabelRequestSchema.safeParse({ items: [line(id, 200), line(other, 200), line(third, 100)] })
        .success,
    ).toBe(true);
    expect(
      LabelRequestSchema.safeParse({ items: [line(id, 200), line(other, 200), line(third, 101)] })
        .success,
    ).toBe(false);
  });

  it('refuses no items, a repeated item and bad copy counts', () => {
    expect(LabelRequestSchema.safeParse({ items: [] }).success).toBe(false);
    expect(LabelRequestSchema.safeParse({ items: [line(id, 1), line(id, 2)] }).success).toBe(false);
    expect(LabelRequestSchema.safeParse({ items: [line(id, 0)] }).success).toBe(false);
    expect(LabelRequestSchema.safeParse({ items: [line(id, 201)] }).success).toBe(false);
    expect(LabelRequestSchema.safeParse({ items: [line(id, 1.5)] }).success).toBe(false);
  });
});

describe('categories', () => {
  it('needs a name and defaults to the top level', () => {
    expect(CreateItemCategoryRequestSchema.parse({ name: ' Tyres ' })).toEqual({
      name: 'Tyres',
      parentId: null,
    });
    expect(CreateItemCategoryRequestSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(
      CreateItemCategoryRequestSchema.safeParse({ name: 'Tyres', parentId: 'no' }).success,
    ).toBe(false);
  });

  it('needs the row version and a change when updating', () => {
    expect(UpdateItemCategoryRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateItemCategoryRequestSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(
      UpdateItemCategoryRequestSchema.safeParse({ rowVersion: 1, parentId: null }).success,
    ).toBe(true);
  });
});
