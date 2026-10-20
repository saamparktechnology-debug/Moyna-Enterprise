import { z } from 'zod';
import { isValidEan13 } from './barcode.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const ItemCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-Z0-9][A-Z0-9._-]{1,31}$/,
    'Use 2 to 32 capital letters, digits, dots, dashes or underscores',
  );

export const ItemNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(120, 'Use at most 120 characters');

export const BarcodeSchema = z
  .string()
  .trim()
  .regex(/^[!-~]{4,48}$/, 'Use 4 to 48 letters, digits or symbols, without spaces')
  .refine((value) => !/^\d{13}$/.test(value) || isValidEan13(value), {
    message: 'The EAN-13 check digit is wrong. Check for a typing mistake',
  });

export const UnitCodeSchema = z.string().trim().toUpperCase().min(1, 'Choose a unit').max(10);
export const GstRateValueSchema = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Choose a GST rate');
export const HsnCodeValueSchema = z
  .string()
  .trim()
  .regex(/^\d{4,8}$/, 'An HSN code has 4 to 8 digits');
export const ReorderLevelSchema = z
  .number('Enter a whole number')
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(1_000_000, 'Too large');

export const CreateItemRequestSchema = z
  .object({
    itemCode: ItemCodeSchema,
    name: ItemNameSchema,
    categoryId: z.uuid('Choose a category'),
    unitCode: UnitCodeSchema,
    hsnCode: HsnCodeValueSchema.nullable().default(null),
    taxRate: GstRateValueSchema.nullable().default(null),
    reorderLevel: ReorderLevelSchema.default(0),
    isSerialized: z.boolean().default(false),
    barcode: BarcodeSchema.optional(),
    generateBarcode: z.boolean().default(false),
  })
  .refine((value) => !(value.barcode && value.generateBarcode), {
    path: ['barcode'],
    message: 'Enter a barcode or ask for one to be generated, not both',
  });
export type CreateItemRequest = z.input<typeof CreateItemRequestSchema>;

export const UpdateItemRequestSchema = z
  .object({
    name: ItemNameSchema.optional(),
    categoryId: z.uuid('Choose a category').optional(),
    unitCode: UnitCodeSchema.optional(),
    hsnCode: HsnCodeValueSchema.nullable().optional(),
    taxRate: GstRateValueSchema.nullable().optional(),
    reorderLevel: ReorderLevelSchema.optional(),
    isSerialized: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateItemRequest = z.infer<typeof UpdateItemRequestSchema>;

export const AddBarcodeRequestSchema = z.union([
  z.object({ generate: z.literal(true) }),
  z.object({ barcode: BarcodeSchema }),
]);
export type AddBarcodeRequest = z.infer<typeof AddBarcodeRequestSchema>;

export const ItemBarcodeSchema = z.object({ id: z.string(), barcode: z.string() });
export type ItemBarcode = z.infer<typeof ItemBarcodeSchema>;

export const ItemSchema = z.object({
  id: z.string(),
  itemCode: z.string(),
  name: z.string(),
  categoryId: z.string(),
  categoryName: z.string(),
  unitCode: z.string(),
  unitName: z.string(),
  hsnCode: z.string().nullable(),
  hsnDescription: z.string().nullable(),
  taxRate: z.string().nullable(),
  reorderLevel: z.number().int(),
  isSerialized: z.boolean(),
  isActive: z.boolean(),
  barcodes: z.array(ItemBarcodeSchema),
  rowVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Item = z.infer<typeof ItemSchema>;

export const ITEM_SORT_FIELDS = ['itemCode', 'name', 'createdAt'] as const;

export const ItemListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  categoryId: z.uuid().optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  tracking: z.enum(['any', 'serialized', 'plain']).default('any'),
});
export type ItemListQuery = z.infer<typeof ItemListQuerySchema>;

export const ItemListResponseSchema = paginatedSchema(ItemSchema);
export type ItemListResponse = z.infer<typeof ItemListResponseSchema>;

export const ItemLookupQuerySchema = z.object({ barcode: z.string().trim().min(1).max(64) });

export const MAX_LABELS_PER_PRINT = 500;
export const MAX_LABEL_COPIES = 200;

export const LabelRequestSchema = z
  .object({
    items: z
      .array(
        z.object({
          itemId: z.uuid(),
          copies: z.number().int().min(1).max(MAX_LABEL_COPIES),
        }),
      )
      .min(1)
      .max(100),
  })
  .superRefine((value, context) => {
    if (new Set(value.items.map((line) => line.itemId)).size !== value.items.length)
      context.addIssue({ code: 'custom', path: ['items'], message: 'List each item once' });
    if (value.items.reduce((sum, line) => sum + line.copies, 0) > MAX_LABELS_PER_PRINT)
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: `Print at most ${MAX_LABELS_PER_PRINT} labels at a time`,
      });
  });
export type LabelRequest = z.infer<typeof LabelRequestSchema>;

export const LabelSchema = z.object({
  itemId: z.string(),
  itemCode: z.string(),
  name: z.string(),
  barcode: z.string(),
});
export const LabelResponseSchema = z.object({ labels: z.array(LabelSchema) });
export type LabelResponse = z.infer<typeof LabelResponseSchema>;

export const ItemCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  parentName: z.string().nullable(),
  isActive: z.boolean(),
  itemCount: z.number().int(),
  rowVersion: z.number().int(),
});
export type ItemCategory = z.infer<typeof ItemCategorySchema>;
export const ItemCategoryListResponseSchema = z.array(ItemCategorySchema);

const CategoryNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(80, 'Use at most 80 characters');

export const CreateItemCategoryRequestSchema = z.object({
  name: CategoryNameSchema,
  parentId: z.uuid().nullable().default(null),
});
export type CreateItemCategoryRequest = z.input<typeof CreateItemCategoryRequestSchema>;

export const UpdateItemCategoryRequestSchema = z
  .object({
    name: CategoryNameSchema.optional(),
    parentId: z.uuid().nullable().optional(),
    isActive: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateItemCategoryRequest = z.infer<typeof UpdateItemCategoryRequestSchema>;

export const UnitSchema = z.object({ code: z.string(), name: z.string() });
export type Unit = z.infer<typeof UnitSchema>;
export const UnitListResponseSchema = z.array(UnitSchema);

export const GstRateSchema = z.object({ rate: z.string(), label: z.string() });
export type GstRate = z.infer<typeof GstRateSchema>;
export const GstRateListResponseSchema = z.array(GstRateSchema);

export const HsnCodeSchema = z.object({
  code: z.string(),
  description: z.string(),
  gstRate: z.string().nullable(),
});
export type HsnCode = z.infer<typeof HsnCodeSchema>;
export const HsnListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
});
export const HsnListResponseSchema = paginatedSchema(HsnCodeSchema);
export type HsnListResponse = z.infer<typeof HsnListResponseSchema>;
