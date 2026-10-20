import { z } from 'zod';

export const RoleNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter the role name')
  .max(50, 'Use at most 50 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9 &_-]*$/, 'Use letters, digits, spaces, & _ or -');

const DescriptionSchema = z
  .string()
  .trim()
  .max(200, 'Use at most 200 characters')
  .transform((value) => (value === '' ? null : value))
  .nullable()
  .optional()
  .transform((value) => value ?? null);

const PermissionCodesSchema = z
  .array(z.string().min(1).max(64))
  .max(200)
  .refine((codes) => new Set(codes).size === codes.length, 'A permission was chosen twice');

export const CreateRoleRequestSchema = z.object({
  name: RoleNameSchema,
  description: DescriptionSchema,
  tier: z.enum(['ADMIN', 'STAFF']),
  permissionCodes: PermissionCodesSchema,
});
export type CreateRoleRequest = z.infer<typeof CreateRoleRequestSchema>;

export const UpdateRoleRequestSchema = z.object({
  name: RoleNameSchema,
  description: DescriptionSchema,
  permissionCodes: PermissionCodesSchema,
  rowVersion: z.number().int().min(1),
});
export type UpdateRoleRequest = z.infer<typeof UpdateRoleRequestSchema>;

export const RoleSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  tier: z.enum(['SUPER_ADMIN', 'ADMIN', 'STAFF']),
  isSystem: z.boolean(),
  /** The Super Admin role cannot be edited by anyone. */
  editable: z.boolean(),
  permissionCodes: z.array(z.string()),
  userCount: z.number().int().min(0),
  rowVersion: z.number().int(),
});
export type Role = z.infer<typeof RoleSchema>;

export const PermissionGroupSchema = z.object({
  module: z.string(),
  permissions: z.array(
    z.object({ code: z.string(), description: z.string(), reserved: z.boolean() }),
  ),
});
export type PermissionGroup = z.infer<typeof PermissionGroupSchema>;

export const RoleListResponseSchema = z.array(RoleSchema);
export const PermissionGroupsResponseSchema = z.array(PermissionGroupSchema);
