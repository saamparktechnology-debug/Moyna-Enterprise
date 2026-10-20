import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { PermissionCode } from '@erp/permissions';
import type { AuthContext, AuthenticatedRequest } from './auth.types.js';

export const PUBLIC_KEY = 'auth:public';
export const AUTHENTICATED_KEY = 'auth:authenticated';
export const PERMISSIONS_KEY = 'auth:permissions';
export const ALLOW_PASSWORD_CHANGE_KEY = 'auth:allow-password-change';

/** The endpoint needs no sign-in. Use sparingly: health checks and the login routes. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(PUBLIC_KEY, true);

/** Any signed-in user may call the endpoint; it is not tied to a permission. */
export const Authenticated = (): MethodDecorator & ClassDecorator =>
  SetMetadata(AUTHENTICATED_KEY, true);

/** The user must hold every listed permission. */
export const RequirePermission = (
  ...permissions: PermissionCode[]
): MethodDecorator & ClassDecorator => SetMetadata(PERMISSIONS_KEY, permissions);

/** The endpoint may be used while the user still has to change their password. */
export const AllowPasswordChange = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_KEY, true);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error('CurrentAuth used on an endpoint that is not authenticated');
    return request.auth;
  },
);
