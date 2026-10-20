import { Inject, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom } from 'rxjs';
import type { Observable } from 'rxjs';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { z } from 'zod';
import { BranchAccessError, ValidationFailedError } from '../../common/errors/domain-errors.js';
import { requestInfoFrom } from './auth.types.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class BranchContextInterceptor implements NestInterceptor {
  constructor(@Inject(BranchContextService) private readonly contexts: BranchContextService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const auth = request.auth;
    if (!auth) return next.handle();
    const info = requestInfoFrom(request);
    const active = this.activeBranch(request.headers['x-branch-id'], auth.branchIds);
    const scope = active
      ? { branchIds: [active], isSuperAdmin: false }
      : { branchIds: auth.branchIds, isSuperAdmin: auth.isSuperAdmin };
    return from(
      this.contexts.run({ userId: auth.userId, ...scope, ...info }, () =>
        lastValueFrom(next.handle()),
      ),
    );
  }

  /**
   * The branch the user has chosen to work in, sent as `X-Branch-Id`. Without it (or with `all`) a user works
   * across all their branches. A branch that is not one of theirs is refused, never silently ignored.
   */
  private activeBranch(
    header: string | string[] | undefined,
    allowed: readonly string[],
  ): string | null {
    if (header === undefined || header === 'all') return null;
    const parsed = z.uuid().safeParse(header);
    if (!parsed.success)
      throw new ValidationFailedError('Invalid branch', [
        { field: 'x-branch-id', message: 'The branch must be an id or "all"' },
      ]);
    if (!allowed.includes(parsed.data)) throw new BranchAccessError();
    return parsed.data;
  }
}
