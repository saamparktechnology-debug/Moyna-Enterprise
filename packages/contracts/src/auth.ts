import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export const LoginRequestSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(64),
  password: z.string().min(1, 'Enter your password').max(PASSWORD_MAX_LENGTH),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const NewPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`);

export const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password').max(PASSWORD_MAX_LENGTH),
  newPassword: NewPasswordSchema,
});
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const SessionBranchSchema = z.object({ id: z.string(), code: z.string(), name: z.string() });

export const SessionUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  fullName: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  branches: z.array(SessionBranchSchema),
  isSuperAdmin: z.boolean(),
  mustChangePassword: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionResponseSchema = z.object({
  user: SessionUserSchema,
  csrfToken: z.string(),
  expiresAt: z.string(),
});
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

export const ResetPasswordResponseSchema = z.object({ temporaryPassword: z.string() });
export type ResetPasswordResponse = z.infer<typeof ResetPasswordResponseSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;
