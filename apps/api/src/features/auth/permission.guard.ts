import { Inject, Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { ForbiddenError } from '../../common/errors/domain-errors.js';
import type { AuthenticatedRequest } from './auth.types.js';
import { AUTHENTICATED_KEY, PERMISSIONS_KEY, PUBLIC_KEY } from './decorators.js';

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(PinoLogger) private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(PermissionGuard.name);
  }

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const auth = context.switchToHttp().getRequest<AuthenticatedRequest>().auth;
    if (!auth) throw new ForbiddenError();

    const required = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      targets,
    );
    if (required && required.length > 0) {
      if (required.every((code) => auth.permissions.includes(code))) return true;
      throw new ForbiddenError();
    }
    if (this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_KEY, targets)) return true;

    this.logger.error(
      { handler: context.getHandler().name, controller: context.getClass().name },
      'Endpoint declares no access rule; denying',
    );
    throw new ForbiddenError();
  }
}
