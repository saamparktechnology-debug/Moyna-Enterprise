import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { APP_CONFIG } from '../../common/config/config.module.js';
import type { Env } from '../../common/config/env.js';
import {
  PasswordChangeRequiredError,
  UnauthenticatedError,
} from '../../common/errors/domain-errors.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { readCookie, sessionCookieName } from './cookies.js';
import { ALLOW_PASSWORD_CHANGE_KEY, PUBLIC_KEY } from './decorators.js';
import { SessionService } from './session.service.js';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const cookieName = sessionCookieName(this.env.NODE_ENV === 'production');
    const token = readCookie(request.headers.cookie, cookieName);
    const resolved = token ? await this.sessions.resolve(token) : null;
    if (!resolved) {
      if (token) http.getResponse<Response>().clearCookie(cookieName, { path: '/' });
      throw new UnauthenticatedError();
    }

    const auth = await this.sessions.loadAccess(resolved.user, resolved.session.id);
    if (
      auth.mustChangePassword &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_KEY, targets)
    ) {
      throw new PasswordChangeRequiredError();
    }
    request.auth = auth;
    return true;
  }
}
