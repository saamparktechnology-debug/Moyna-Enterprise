import { z } from 'zod';
import { GstRateValueSchema, HsnCodeValueSchema } from './items.js';
import { DateOnlySchema } from './battery-dates.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const INVOICE_TYPES = ['GST', 'NON_GST'] as const;
export const InvoiceTypeSchema = z.enum(INVOICE_TYPES);
export type InvoiceTypeName = z.infer<typeof InvoiceTypeSchema>;

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'CANCELLED'] as const;
export const InvoiceStatusSchema = z.enum(INVOICE_STATUSES);
export type InvoiceStatusName = z.infer<typeof InvoiceStatusSchema>;

/**
 * Staff may give a discount of up to this share of a line's price. A larger discount needs someone who holds
 * `discounts.approve` to issue the invoice. Items carry no list price, so the limit is a share of the line.
 */
export const DISCOUNT_STAFF_LIMIT_PERCENT = 5;
export const MAX_INVOICE_LINES = 100;
export const MAX_LINE_QTY = 10_000;

/** An amount of money in rupees, with at most two decimals, as text so no precision is lost. */
export const MoneyAmountSchema = z
  .string('Enter an amount')
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount in rupees, with at most 2 decimals');

export const InvoiceLineInputSchema = z
  .object({
    itemId: z.uuid('Choose an item'),
    qty: z
      .number('Enter a whole number')
      .int('Enter a whole number')
      .min(1, 'At least 1')
      .max(MAX_LINE_QTY, 'Too many'),
    unitPrice: MoneyAmountSchema,
    discountAmount: MoneyAmountSchema.default('0.00'),
    /** Required for an item that is tracked by serial number, and only for such an item. */
    serialUnitId: z.uuid().optional(),
    /**
     * The GST rate for this line on a GST invoice, chosen by the biller. Left out, the item's own rate is the starting
     * point; `null` means none. The type of the invoice, not the product, decides whether GST is charged at all.
     */
    taxRate: GstRateValueSchema.nullable().optional(),
    /** The HSN code for this line on a GST invoice. Left out, the item's own code is used; `null` means none. */
    hsnCode: HsnCodeValueSchema.nullable().optional(),
  })
  .superRefine((line, context) => {
    if (line.serialUnitId && line.qty !== 1)
      context.addIssue({
        code: 'custom',
        path: ['qty'],
        message: 'A unit tracked by serial number is sold one at a time',
      });
  });
export type InvoiceLineInput = z.input<typeof InvoiceLineInputSchema>;

/** The business's details as printed at the top of every invoice, credit note and receipt. */
export const DocumentCompanySchema = z.object({
  name: z.string(),
  /** For example "Prop - Balaram Das Gajendra Mahapatra" is printed from this name. */
  proprietor: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  gstin: z.string().nullable(),
  tagline: z.string().nullable(),
  /** The line printed at the foot of an invoice, such as "Goods once sold will not take back." */
  terms: z.string().nullable(),
});
export type DocumentCompany = z.infer<typeof DocumentCompanySchema>;

export const INVOICE_COMMISSION_TYPES = ['NONE', 'FIXED', 'GIFT'] as const;
export const InvoiceCommissionTypeSchema = z.enum(INVOICE_COMMISSION_TYPES);
export type InvoiceCommissionTypeName = z.infer<typeof InvoiceCommissionTypeSchema>;

/**
 * What was agreed with the broker at the time of the sale. `FIXED` is an amount of money; `GIFT` is a named gift with its
 * value (the gift is not stock, and nothing is taken from the stock ledger for it). The photo of a gift is added to the
 * draft afterwards.
 */
export const InvoiceCommissionInputSchema = z
  .object({
    type: InvoiceCommissionTypeSchema,
    amount: MoneyAmountSchema.optional(),
    giftName: z
      .string()
      .trim()
      .min(1, 'Enter the name of the gift')
      .max(120, 'Use at most 120 characters')
      .optional(),
  })
  .superRefine((value, context) => {
    if (value.type === 'NONE') {
      if (value.amount !== undefined || value.giftName !== undefined)
        context.addIssue({
          code: 'custom',
          path: ['type'],
          message: 'No commission has no amount or gift',
        });
      return;
    }
    if (value.amount === undefined || !(Number(value.amount) > 0))
      context.addIssue({
        code: 'custom',
        path: ['amount'],
        message:
          value.type === 'GIFT' ? 'Enter the value of the gift' : 'Enter the commission amount',
      });
    if (value.type === 'GIFT' && value.giftName === undefined)
      context.addIssue({
        code: 'custom',
        path: ['giftName'],
        message: 'Enter the name of the gift',
      });
    if (value.type === 'FIXED' && value.giftName !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['giftName'],
        message: 'A fixed commission has no gift',
      });
  });
export type InvoiceCommissionInput = z.input<typeof InvoiceCommissionInputSchema>;

const InvoiceBodyShape = {
  customerId: z.uuid('Choose the customer'),
  type: InvoiceTypeSchema,
  lines: z
    .array(InvoiceLineInputSchema)
    .min(1, 'Add at least one line')
    .max(MAX_INVOICE_LINES, `At most ${MAX_INVOICE_LINES} lines`),
  dueDate: DateOnlySchema.nullable().default(null),
  /** The broker who brought the sale. Commission is worked out for them when the invoice is issued. */
  brokerId: z.uuid().nullable().default(null),
  /** What was agreed with that broker for this sale. Only with a broker. */
  commission: InvoiceCommissionInputSchema.nullable().default(null),
};

function commissionNeedsBroker(
  value: { brokerId: string | null; commission: unknown },
  context: z.RefinementCtx,
): void {
  if (value.commission !== null && value.brokerId === null)
    context.addIssue({
      code: 'custom',
      path: ['commission'],
      message: 'Choose the broker before agreeing a commission',
    });
}

function noRepeatedSerials(
  value: { lines: { serialUnitId?: string | undefined }[] },
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  value.lines.forEach((line, index) => {
    if (!line.serialUnitId) return;
    if (seen.has(line.serialUnitId))
      context.addIssue({
        code: 'custom',
        path: ['lines', index, 'serialUnitId'],
        message: 'This unit is already on the invoice',
      });
    seen.add(line.serialUnitId);
  });
}

export const CreateInvoiceRequestSchema = z
  .object({ ...InvoiceBodyShape, branchId: z.uuid().optional() })
  .superRefine(noRepeatedSerials)
  .superRefine(commissionNeedsBroker);
export type CreateInvoiceRequest = z.input<typeof CreateInvoiceRequestSchema>;

export const UpdateInvoiceRequestSchema = z
  .object({ ...InvoiceBodyShape, rowVersion: z.number().int().min(1) })
  .superRefine(noRepeatedSerials)
  .superRefine(commissionNeedsBroker);
export type UpdateInvoiceRequest = z.input<typeof UpdateInvoiceRequestSchema>;

export const PreviewInvoiceRequestSchema = CreateInvoiceRequestSchema;

const ReasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);

export const IssueInvoiceRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  /** Only needed when a battery on the invoice is past its expiry date. */
  overrideReason: ReasonSchema.optional(),
  /** Only needed to deliver a custom order before it is fully paid, by someone who may. */
  unpaidDeliveryReason: ReasonSchema.optional(),
});
export type IssueInvoiceRequest = z.input<typeof IssueInvoiceRequestSchema>;

export const CancelInvoiceRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  reason: ReasonSchema,
});
export type CancelInvoiceRequest = z.input<typeof CancelInvoiceRequestSchema>;

export const ReissueInvoiceRequestSchema = CancelInvoiceRequestSchema;
export type ReissueInvoiceRequest = CancelInvoiceRequest;

export const DiscardInvoiceRequestSchema = z.object({ rowVersion: z.number().int().min(1) });

const TotalsShape = {
  subtotal: z.string(),
  discountTotal: z.string(),
  taxableValue: z.string(),
  cgstAmount: z.string(),
  sgstAmount: z.string(),
  igstAmount: z.string(),
  roundOff: z.string(),
  total: z.string(),
};

export const InvoiceLineSchema = z.object({
  id: z.string().nullable(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unitCode: z.string(),
  hsnCode: z.string().nullable(),
  taxRate: z.string().nullable(),
  qty: z.number().int(),
  unitPrice: z.string(),
  discountAmount: z.string(),
  taxableAmount: z.string(),
  cgstAmount: z.string(),
  sgstAmount: z.string(),
  igstAmount: z.string(),
  amount: z.string(),
  serialUnitId: z.string().nullable(),
  serialNo: z.string().nullable(),
  /** What one unit cost, as the viewer may know it: the real cost for a Super Admin, the shown cost for everyone else. */
  unitCost: z.string().nullable().optional(),
  /** Taxable amount less cost for the line, worked out with the same cost. `null` when no cost was recorded. */
  profit: z.string().nullable().optional(),
});
export type InvoiceLine = z.infer<typeof InvoiceLineSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  invoiceNo: z.string().nullable(),
  type: InvoiceTypeSchema,
  status: InvoiceStatusSchema,
  branchId: z.string(),
  branchCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  customerGstin: z.string().nullable(),
  /** The buyer's mobile number and address, as printed on the invoice. */
  customerPhone: z.string().nullable().optional(),
  customerAddress: z.string().nullable().optional(),
  branchGstin: z.string().nullable(),
  /** The business's details for printing. Sent when one invoice is opened, not in lists. */
  company: DocumentCompanySchema.nullable().optional(),
  brokerId: z.string().nullable(),
  brokerName: z.string().nullable(),
  /** What was agreed with the broker for this sale; `null` when nothing was agreed on the invoice. */
  commission: z
    .object({
      type: InvoiceCommissionTypeSchema,
      amount: z.string().nullable(),
      giftName: z.string().nullable(),
      hasPhoto: z.boolean(),
      photoFileName: z.string().nullable(),
    })
    .nullable()
    .optional(),
  /** The quotation this invoice delivers, when it came from one. */
  quotationId: z.string().nullable(),
  quotationNo: z.string().nullable(),
  placeOfSupply: z.string().nullable(),
  /** True when the sale crosses a state border, so tax is charged as IGST instead of CGST and SGST. */
  interState: z.boolean(),
  issuedOn: z.string().nullable(),
  dueDate: z.string().nullable(),
  ...TotalsShape,
  /** The total in capital letters, as printed under the table: ONE LAKH FIFTY EIGHT THOUSAND ONLY. */
  totalInWords: z.string().optional(),
  lines: z.array(InvoiceLineSchema),
  /** Profit on an issued invoice for this viewer (see `InvoiceLine.unitCost`). `null` when it cannot be worked out. */
  profit: z.string().nullable().optional(),
  replacesInvoiceId: z.string().nullable(),
  replacesInvoiceNo: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelledByName: z.string().nullable(),
  cancelReason: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** What an invoice would come to, worked out the same way as when it is saved. Nothing is stored. */
export const InvoicePreviewSchema = z.object({
  interState: z.boolean(),
  placeOfSupply: z.string().nullable(),
  ...TotalsShape,
  lines: z.array(InvoiceLineSchema),
});
export type InvoicePreview = z.infer<typeof InvoicePreviewSchema>;

export const InvoiceSummarySchema = z.object({
  id: z.string(),
  invoiceNo: z.string().nullable(),
  type: InvoiceTypeSchema,
  status: InvoiceStatusSchema,
  branchCode: z.string(),
  customerName: z.string(),
  issuedOn: z.string().nullable(),
  dueDate: z.string().nullable(),
  total: z.string(),
  lineCount: z.number().int(),
  /** Profit on an issued invoice for this viewer: taxable value less cost. `null` when it cannot be worked out. */
  profit: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type InvoiceSummary = z.infer<typeof InvoiceSummarySchema>;

export const INVOICE_SORT_FIELDS = ['createdAt', 'issuedOn', 'invoiceNo', 'total'] as const;
export const InvoiceListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', ...INVOICE_STATUSES]).default('all'),
  type: z.enum(['all', ...INVOICE_TYPES]).default('all'),
  customerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  /** Only invoices that sold something from this group (a top-level category, with everything under it). */
  groupId: z.uuid().optional(),
  /** Only invoices that sold something from this product category. */
  categoryId: z.uuid().optional(),
  /** Only invoices of sales this broker brought. */
  brokerId: z.uuid().optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});
export type InvoiceListQuery = z.input<typeof InvoiceListQuerySchema>;
export const InvoiceListResponseSchema = paginatedSchema(InvoiceSummarySchema);
export type InvoiceListResponse = z.infer<typeof InvoiceListResponseSchema>;
