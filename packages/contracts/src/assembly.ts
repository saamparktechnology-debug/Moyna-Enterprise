import { z } from 'zod';
import { MoneyAmountSchema } from './billing.js';
import { GstRateValueSchema, HsnCodeValueSchema, ItemCodeSchema, ItemNameSchema } from './items.js';
import { PaginationQuerySchema, paginatedSchema } from './pagination.js';

const SerialTextSchema = z
  .string()
  .trim()
  .min(1, 'Enter the number')
  .max(60, 'Use at most 60 characters');

/** One part taken from stock. A part tracked by serial number is chosen unit by unit; any other by its quantity. */
export const AssemblyPartInputSchema = z
  .object({
    itemId: z.uuid('Choose the part'),
    qty: z
      .number('Enter a whole number')
      .int('Enter a whole number')
      .min(1, 'At least 1')
      .max(100_000, 'Too many'),
    /** For a part tracked by serial number: the units used, as many as `qty`. */
    serialUnitIds: z.array(z.uuid()).max(1000).optional(),
  })
  .superRefine((part, context) => {
    if (part.serialUnitIds && part.serialUnitIds.length !== part.qty)
      context.addIssue({
        code: 'custom',
        path: ['serialUnitIds'],
        message: 'Choose one serial number for each unit',
      });
    if (part.serialUnitIds && new Set(part.serialUnitIds).size !== part.serialUnitIds.length)
      context.addIssue({
        code: 'custom',
        path: ['serialUnitIds'],
        message: 'A serial number can be used only once',
      });
  });
export type AssemblyPartInput = z.input<typeof AssemblyPartInputSchema>;

/** The numbers of a finished unit that is tracked by serial number, such as a vehicle's chassis and motor. */
export const FinishedUnitInputSchema = z.object({
  serialNo: SerialTextSchema,
  chassisNo: SerialTextSchema.optional(),
  motorNo: SerialTextSchema.optional(),
});
export type FinishedUnitInput = z.input<typeof FinishedUnitInputSchema>;

/** A product that does not exist yet, made on the spot while assembling it. */
export const NewFinishedItemSchema = z.object({
  itemCode: ItemCodeSchema,
  name: ItemNameSchema,
  categoryId: z.uuid('Choose a category'),
  unitCode: z.string().trim().min(1, 'Choose the unit').max(10, 'Use at most 10 characters'),
  /** A numbered product, such as a vehicle, is made one at a time with its serial number. */
  isSerialized: z.boolean().default(false),
  hsnCode: HsnCodeValueSchema.nullable().default(null),
  taxRate: GstRateValueSchema.nullable().default(null),
});
export type NewFinishedItem = z.input<typeof NewFinishedItemSchema>;

/**
 * Assembles a product from parts in stock. Nothing is costed: the parts go out of stock, the finished product comes in,
 * and the selling price is set. A finished product tracked by serial number is made one at a time, with its numbers.
 */
export const CreateAssemblyRequestSchema = z
  .object({
    branchId: z.uuid().optional(),
    /** The product being made, when it is already an item. Otherwise describe a new one in `newItem`. */
    finishedItemId: z.uuid('Choose the product being made').optional(),
    newItem: NewFinishedItemSchema.optional(),
    qty: z
      .number('Enter a whole number')
      .int('Enter a whole number')
      .min(1, 'At least 1')
      .max(1000, 'Too many')
      .default(1),
    /** The price this product is sold at from now on. Billing starts from it. */
    sellingPrice: z
      .string()
      .trim()
      .min(1, 'Enter the selling price')
      .pipe(MoneyAmountSchema.refine((value) => Number(value) > 0, 'Enter the selling price')),
    units: z.array(FinishedUnitInputSchema).max(1).optional(),
    parts: z
      .array(AssemblyPartInputSchema)
      .min(1, 'Add at least one part')
      .max(100, 'Too many parts'),
    note: z.string().trim().min(1).max(300, 'Use at most 300 characters').optional(),
  })
  .superRefine((value, context) => {
    if ((value.finishedItemId === undefined) === (value.newItem === undefined))
      context.addIssue({
        code: 'custom',
        path: ['finishedItemId'],
        message: 'Choose the product being made, or describe a new one',
      });
    const items = value.parts.map((part) => part.itemId);
    if (new Set(items).size !== items.length)
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'List each part once, with the whole quantity',
      });
    if (value.finishedItemId !== undefined && items.includes(value.finishedItemId))
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'A product cannot be made from itself',
      });
    const units = value.parts.flatMap((part) => part.serialUnitIds ?? []);
    if (new Set(units).size !== units.length)
      context.addIssue({
        code: 'custom',
        path: ['parts'],
        message: 'A serial number can be used only once',
      });
  });
export type CreateAssemblyRequest = z.input<typeof CreateAssemblyRequestSchema>;

export const AssemblySchema = z.object({
  id: z.string(),
  assemblyNo: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  finishedItemId: z.string(),
  finishedItemCode: z.string(),
  finishedItemName: z.string(),
  qty: z.number().int(),
  sellingPrice: z.string(),
  note: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  /** What the parts cost, from the items' purchase prices as they were. The real prices for a Super Admin, the shown prices for everyone else. `null` when a part has no purchase price. */
  costTotal: z.string().nullable().optional(),
  /** What the product is sold at (price times how many) less the cost of the parts, for this viewer. */
  profit: z.string().nullable().optional(),
  /** Set when the assembly was taken apart again. */
  reversed: z
    .object({ on: z.string(), reason: z.string(), byName: z.string().nullable() })
    .nullable()
    .optional(),
  parts: z.array(
    z.object({
      itemId: z.string(),
      itemCode: z.string(),
      itemName: z.string(),
      unitCode: z.string(),
      qty: z.number().int(),
      /** The serial numbers used, for a part tracked by serial number. */
      serialNos: z.array(z.string()),
    }),
  ),
  /** The serial-numbered units the assembly made. */
  units: z.array(
    z.object({
      serialUnitId: z.string(),
      serialNo: z.string(),
      chassisNo: z.string().nullable(),
      motorNo: z.string().nullable(),
    }),
  ),
});
export type Assembly = z.infer<typeof AssemblySchema>;

export const AssemblyListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  branchId: z.uuid().optional(),
});
export type AssemblyListQuery = z.input<typeof AssemblyListQuerySchema>;
export const AssemblyListResponseSchema = paginatedSchema(AssemblySchema);
export type AssemblyListResponse = z.infer<typeof AssemblyListResponseSchema>;

/** Takes an assembly apart again: the product leaves stock and the parts come back. A reason is needed. */
export const ReverseAssemblyRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Enter the reason').max(300, 'Use at most 300 characters'),
});
export type ReverseAssemblyRequest = z.input<typeof ReverseAssemblyRequestSchema>;
