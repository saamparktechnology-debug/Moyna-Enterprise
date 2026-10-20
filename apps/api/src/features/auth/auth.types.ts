import type { RoleTier } from '@erp/permissions';
import type { Request } from 'express';

export interface AuthContext {
  userId: string;
  username: string;
  fullName: string;
  email: string;
  sessionId: string;
  roles: string[];
  /** The highest tier among the user's roles. */
  tier: RoleTier;
  permissions: string[];
  branches: { id: string; code: string; name: string }[];
  branchIds: string[];
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

export interface RequestInfo {
  ipAddress: string | undefined;
  userAgent: string | undefined;
  requestId: string | undefined;
}

export function requestInfoFrom(request: Request): RequestInfo {
  const requestId = (request as Request & { id?: unknown }).id;
  return {
    ipAddress: request.ip,
    userAgent: request.headers['user-agent']?.slice(0, 300),
    requestId: requestId === undefined ? undefined : String(requestId),
  };
}
