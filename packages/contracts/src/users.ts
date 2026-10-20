import { z } from 'zod';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const UsernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9._-]{3,32}$/,
    'Use 3 to 32 lowercase letters, digits, dots, dashes or underscores',
  );
export const FullNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter the full name')
  .max(100, 'Use at most 100 characters');
export const EmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Use at most 254 characters')
  .pipe(z.email('Enter a valid email address'));

const distinct = (ids: string[]): boolean => new Set(ids).size === ids.length;
const BranchIdsSchema = z
  .array(z.uuid())
  .min(1, 'Choose at least one branch')
  .max(50)
  .refine(distinct, 'A branch was chosen twice');
/** An edit may leave the list empty: an Admin removing someone from their own branch keeps the branches they do not manage. */
const EditedBranchIdsSchema = z
  .array(z.uuid())
  .max(50)
  .refine(distinct, 'A branch was chosen twice');

export const CreateUserRequestSchema = z.object({
  username: UsernameSchema,
  fullName: FullNameSchema,
  email: EmailSchema,
  roleId: z.uuid('Choose a role'),
  branchIds: BranchIdsSchema,
});
export type CreateUserRequest = z.infer<typeof CreateUserRequestSchema>;

export const UpdateUserRequestSchema = z.object({
  fullName: FullNameSchema,
  email: EmailSchema,
  roleId: z.uuid('Choose a role'),
  branchIds: EditedBranchIdsSchema,
  rowVersion: z.number().int().min(1),
});
export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const UserRoleSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
});

export const UserSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'LOCKED']),
  role: UserRoleSummarySchema.nullable(),
  branches: z.array(z.object({ id: z.string(), code: z.string(), name: z.string() })),
  lastLoginAt: z.string().nullable(),
  mustChangePassword: z.boolean(),
  /** Whether the person asking may edit, deactivate or reset this user. */
  manageable: z.boolean(),
  rowVersion: z.number().int(),
  createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const CreateUserResponseSchema = z.object({
  user: UserSchema,
  temporaryPassword: z.string(),
});
export type CreateUserResponse = z.infer<typeof CreateUserResponseSchema>;

export const USER_SORT_FIELDS = ['username', 'fullName', 'createdAt', 'lastLoginAt'] as const;
export const UserListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
  roleId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type UserListQuery = z.infer<typeof UserListQuerySchema>;

export const UserListResponseSchema = paginatedSchema(UserSchema);
export type UserListResponse = z.infer<typeof UserListResponseSchema>;
