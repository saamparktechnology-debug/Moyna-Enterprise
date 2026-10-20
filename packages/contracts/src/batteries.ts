import { z } from 'zod';
import {
  BatteryMonthsSchema,
  DEFAULT_EXPIRY_WINDOW_DAYS,
  DateOnlySchema,
  ExpiryStatusSchema,
  WarrantyStatusSchema,
  checkBatteryDates,
} from './battery-dates.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';
import { SerialUnitStateSchema } from './stock.js';

const OverrideReasonSchema = z
  .string()
  .trim()
  .min(3, 'Give a reason of at least 3 characters')
  .max(300, 'Use at most 300 characters');

export const BatterySchema = z.object({
  serialUnitId: z.string(),
  serialNo: z.string(),
  chassisNo: z.string().nullable(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  state: SerialUnitStateSchema,
  manufacturedOn: z.string().nullable(),
  expiryOn: z.string().nullable(),
  expiryStatus: ExpiryStatusSchema,
  daysToExpiry: z.number().int().nullable(),
  warrantyMonths: z.number().int().nullable(),
  warrantyEnd: z.string().nullable(),
  warrantyStatus: WarrantyStatusSchema,
  installedInSerialUnitId: z.string().nullable(),
  installedInSerialNo: z.string().nullable(),
  installedOn: z.string().nullable(),
  /** Empty until the battery's dates have been recorded for the first time. */
  rowVersion: z.number().int().nullable(),
});
export type Battery = z.infer<typeof BatterySchema>;

export const BATTERY_SORT_FIELDS = ['expiryOn', 'warrantyEnd', 'installedOn', 'serialNo'] as const;

const withinDaysSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(365)
  .default(DEFAULT_EXPIRY_WINDOW_DAYS);

export const BatteryListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  branchId: z.uuid().optional(),
  itemId: z.uuid().optional(),
  state: SerialUnitStateSchema.optional(),
  expiry: z.enum(['any', 'expired', 'expiring', 'ok', 'none']).default('any'),
  warranty: z.enum(['any', 'active', 'ended', 'none']).default('any'),
  installed: z.enum(['any', 'yes', 'no']).default('any'),
  withinDays: withinDaysSchema,
});
export type BatteryListQuery = z.input<typeof BatteryListQuerySchema>;
export const BatteryListResponseSchema = paginatedSchema(BatterySchema);
export type BatteryListResponse = z.infer<typeof BatteryListResponseSchema>;

export const BatteryAlertsQuerySchema = z.object({
  branchId: z.uuid().optional(),
  withinDays: withinDaysSchema,
});
export const BatteryAlertsSchema = z.object({
  withinDays: z.number().int(),
  expired: z.number().int(),
  expiring: z.number().int(),
});
export type BatteryAlerts = z.infer<typeof BatteryAlertsSchema>;

export const SetBatteryDetailsRequestSchema = z
  .object({
    manufacturedOn: DateOnlySchema.nullable().default(null),
    expiryOn: DateOnlySchema.nullable().default(null),
    warrantyMonths: BatteryMonthsSchema.nullable().default(null),
    warrantyEnd: DateOnlySchema.nullable().default(null),
    /** Needed once the battery already has details, so a stale edit is refused. */
    rowVersion: z.number().int().min(1).optional(),
  })
  .superRefine((value, context) =>
    checkBatteryDates(value, (path, message) =>
      context.addIssue({ code: 'custom', path: [path], message }),
    ),
  );
export type SetBatteryDetailsRequest = z.input<typeof SetBatteryDetailsRequestSchema>;

export const InstallBatteryRequestSchema = z.object({
  vehicleSerialUnitId: z.uuid('Choose the vehicle'),
  installedOn: DateOnlySchema.optional(),
  /** Needed only when the battery is past its expiry date. */
  overrideReason: OverrideReasonSchema.optional(),
});
export type InstallBatteryRequest = z.input<typeof InstallBatteryRequestSchema>;

export const SaleCheckRequestSchema = z.object({ overrideReason: OverrideReasonSchema.optional() });
export type SaleCheckRequest = z.input<typeof SaleCheckRequestSchema>;

export const SaleCheckResponseSchema = z.object({
  ok: z.literal(true),
  overridden: z.boolean(),
  expiryOn: z.string().nullable(),
});
export type SaleCheckResponse = z.infer<typeof SaleCheckResponseSchema>;
