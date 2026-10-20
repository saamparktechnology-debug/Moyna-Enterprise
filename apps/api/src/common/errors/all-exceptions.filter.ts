import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { ErrorCode, ErrorDetail, ErrorResponse } from '@erp/contracts';
import { ErrorCodeSchema } from '@erp/contracts';
import { PinoLogger } from 'nestjs-pino';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';
import { DomainError } from './domain-errors.js';

const CODE_BY_STATUS: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'VALIDATION_ERROR',
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: 'VALIDATION_ERROR',
  [HttpStatus.UNPROCESSABLE_ENTITY]: 'VALIDATION_ERROR',
};

interface NormalizedError {
  status: number;
  code: ErrorCode;
  message: string;
  details: ErrorDetail[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function zodDetails(error: ZodError): ErrorDetail[] {
  return error.issues.map((issue) => ({
    field: issue.path.map(String).join('.'),
    message: issue.message,
  }));
}

function clientStatusOf(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const status = error['status'] ?? error['statusCode'];
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

function normalizeHttpException(exception: HttpException): NormalizedError {
  const status = exception.getStatus();
  const body = exception.getResponse();
  const explicitCode = isRecord(body) ? ErrorCodeSchema.safeParse(body['code']) : undefined;
  const bodyMessage =
    isRecord(body) && typeof body['message'] === 'string' ? body['message'] : null;
  return {
    status,
    code: explicitCode?.success
      ? explicitCode.data
      : (CODE_BY_STATUS[status] ?? (status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR')),
    message: bodyMessage ?? exception.message,
    details: [],
  };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const normalized = this.normalize(exception);
    if (normalized.status >= 500) {
      this.logger.error({ err: exception }, 'Unhandled error while processing request');
    }

    const body: ErrorResponse = {
      code: normalized.code,
      message: normalized.message,
      details: normalized.details,
      requestId: String(request.id ?? response.getHeader('x-request-id') ?? 'unknown'),
    };
    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: zodDetails(exception),
      };
    }
    if (exception instanceof DomainError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }
    if (exception instanceof HttpException) {
      return normalizeHttpException(exception);
    }
    const clientStatus = clientStatusOf(exception);
    if (clientStatus !== undefined) {
      return {
        status: clientStatus,
        code: CODE_BY_STATUS[clientStatus] ?? 'VALIDATION_ERROR',
        message: 'The request could not be processed',
        details: [],
      };
    }
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: [],
    };
  }
}
