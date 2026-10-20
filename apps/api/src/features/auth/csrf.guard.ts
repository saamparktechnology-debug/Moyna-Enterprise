import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { APP_CONFIG } from '../../common/config/config.module.js';
import type { Env } from '../../common/config/env.js';
import { ForbiddenError } from '../../common/errors/domain-errors.js';
import { CSRF_HEADER } from './auth.constants.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { isValidCsrfToken } from './tokens.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function sameOrigin(given: string | undefined, allowed: string): boolean {
  return given !== undefined && given.replace(/\/+$/, '') === allowed.replace(/\/+$/, '');
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;

    if (!sameOrigin(request.headers.origin, this.env.WEB_ORIGIN)) {
      throw new ForbiddenError('This request did not come from the application');
    }
    if (request.auth) {
      const supplied = request.headers[CSRF_HEADER];
      if (!isValidCsrfToken(this.env.SESSION_SECRET, request.auth.sessionId, supplied)) {
        throw new ForbiddenError('Missing or invalid CSRF token');
      }
    }
    return true;
  }
}
