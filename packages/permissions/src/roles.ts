export const ROLES = ['SUPER_ADMIN', 'ADMIN', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
