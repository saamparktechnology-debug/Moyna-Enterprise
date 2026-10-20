import { HttpStatus } from '@nestjs/common';
import type { ErrorCode, ErrorDetail } from '@erp/contracts';

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
    message: string,
    readonly details: ErrorDetail[] = [],
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id?: string) {
    super(
      'NOT_FOUND',
      HttpStatus.NOT_FOUND,
      id ? `${entity} ${id} was not found` : `${entity} was not found`,
    );
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details: ErrorDetail[] = []) {
    super('CONFLICT', HttpStatus.CONFLICT, message, details);
  }
}

export class ValidationFailedError extends DomainError {
  constructor(message: string, details: ErrorDetail[]) {
    super('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, message, details);
  }
}

export class InvalidStateError extends DomainError {
  constructor(entity: string, from: string, to: string) {
    super('INVALID_STATE', HttpStatus.CONFLICT, `${entity} cannot move from ${from} to ${to}`);
  }
}

export class BusinessRuleError extends DomainError {
  constructor(message: string, details: ErrorDetail[] = []) {
    super('BUSINESS_RULE_VIOLATION', HttpStatus.UNPROCESSABLE_ENTITY, message, details);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'You do not have permission to do this') {
    super('FORBIDDEN', HttpStatus.FORBIDDEN, message);
  }
}

export class BranchAccessError extends ForbiddenError {
  constructor() {
    super('Access to this branch is not allowed');
  }
}

export class UnauthenticatedError extends DomainError {
  constructor(message = 'Sign in to continue') {
    super('UNAUTHENTICATED', HttpStatus.UNAUTHORIZED, message);
  }
}

export class PasswordChangeRequiredError extends DomainError {
  constructor() {
    super(
      'PASSWORD_CHANGE_REQUIRED',
      HttpStatus.FORBIDDEN,
      'You must change your password before continuing',
    );
  }
}

export class TooManyRequestsError extends DomainError {
  constructor(message: string) {
    super('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, message);
  }
}
