import { z } from 'zod';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const GSTIN_BASE = GSTIN_ALPHABET.length;

export function gstinCheckCharacter(firstFourteen: string): string {
  let sum = 0;
  for (let i = 0; i < firstFourteen.length; i += 1) {
    const value = GSTIN_ALPHABET.indexOf(firstFourteen.charAt(i));
    const product = value * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / GSTIN_BASE) + (product % GSTIN_BASE);
  }
  return GSTIN_ALPHABET.charAt((GSTIN_BASE - (sum % GSTIN_BASE)) % GSTIN_BASE);
}

/** Returns what is wrong with a GSTIN (and, when given, how it disagrees with the state), or null when it is fine. */
export function gstinProblem(gstin: string, stateCode?: string): string | null {
  if (!GSTIN_PATTERN.test(gstin)) return 'Enter a valid 15-character GSTIN';
  if (gstinCheckCharacter(gstin.slice(0, 14)) !== gstin.charAt(14))
    return 'The GSTIN check character is wrong. Check for a typing mistake';
  if (stateCode && gstin.slice(0, 2) !== stateCode)
    return `The GSTIN must start with the state code ${stateCode}`;
  return null;
}

export const BranchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{2,4}$/, 'Use 2 to 4 capital letters or digits');

export const BranchNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(100, 'Use at most 100 characters');

export const StateCodeSchema = z.string().regex(/^\d{2}$/, 'Choose a state');

export const GstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .superRefine((value, context) => {
    const problem = gstinProblem(value);
    if (problem) context.addIssue({ code: 'custom', message: problem });
  });

export const CreateBranchRequestSchema = z
  .object({
    code: BranchCodeSchema,
    name: BranchNameSchema,
    stateCode: StateCodeSchema,
    gstin: GstinSchema.nullable(),
  })
  .superRefine((value, context) => {
    if (value.gstin && !gstinProblem(value.gstin) && value.gstin.slice(0, 2) !== value.stateCode) {
      context.addIssue({
        code: 'custom',
        path: ['gstin'],
        message: `The GSTIN must start with the state code ${value.stateCode}`,
      });
    }
  });
export type CreateBranchRequest = z.infer<typeof CreateBranchRequestSchema>;

export const UpdateBranchRequestSchema = z
  .object({
    name: BranchNameSchema.optional(),
    stateCode: StateCodeSchema.optional(),
    gstin: GstinSchema.nullable().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine(
    (value) =>
      value.name !== undefined || value.stateCode !== undefined || value.gstin !== undefined,
    {
      message: 'Change at least one field',
    },
  );
export type UpdateBranchRequest = z.infer<typeof UpdateBranchRequestSchema>;

export const BranchSchema = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  stateCode: z.string(),
  stateName: z.string(),
  isActive: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Branch = z.infer<typeof BranchSchema>;

export const BRANCH_SORT_FIELDS = ['code', 'name', 'createdAt'] as const;

export const BranchListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type BranchListQuery = z.infer<typeof BranchListQuerySchema>;

export const BranchListResponseSchema = paginatedSchema(BranchSchema);
export type BranchListResponse = z.infer<typeof BranchListResponseSchema>;

export const StateSchema = z.object({ code: z.string(), name: z.string() });
export type State = z.infer<typeof StateSchema>;
export const StateListResponseSchema = z.array(StateSchema);
