import { Body, ConflictException, Controller, Get, Param, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorResponseSchema } from '@erp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BranchAccessError,
  BusinessRuleError,
  ConflictError,
  InvalidStateError,
  NotFoundError,
  ValidationFailedError,
} from '../../src/common/errors/domain-errors.js';
import { Public } from '../../src/features/auth/decorators.js';
import { createTestApp } from '../support/create-test-app.js';

@Public()
@Controller('__test')
class ThrowingController {
  @Get('conflict')
  conflict(): never {
    throw new ConflictException('Already exists');
  }

  @Get('invalid')
  invalid(): never {
    z.object({ name: z.string().min(2), qty: z.number().int() }).parse({ name: 'a', qty: 1.5 });
    throw new Error('unreachable');
  }

  @Get('domain/:kind')
  domain(@Param('kind') kind: string): never {
    const errors: Record<string, Error> = {
      notfound: new NotFoundError('Invoice', 'abc'),
      conflict: new ConflictError('Barcode already exists', [
        { field: 'barcode', message: 'Already used' },
      ]),
      state: new InvalidStateError('Transfer', 'RECEIVED', 'DISPATCHED'),
      rule: new BusinessRuleError('Stock cannot go below zero'),
      branch: new BranchAccessError(),
      validation: new ValidationFailedError('Invalid sort', [
        { field: 'sortBy', message: 'Not allowed' },
      ]),
    };
    throw errors[kind] ?? new Error('unknown');
  }

  @Get('boom')
  boom(): never {
    throw new Error('secret internal detail: password=hunter2');
  }

  @Post('echo')
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

describe('standard error shape', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [ThrowingController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns NOT_FOUND for an unknown route', async () => {
    const response = await request(app.getHttpServer()).get('/nope').expect(404);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.code).toBe('NOT_FOUND');
    expect(body.details).toEqual([]);
  });

  it('maps an HTTP exception to its code and message', async () => {
    const response = await request(app.getHttpServer()).get('/__test/conflict').expect(409);
    expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
      code: 'CONFLICT',
      message: 'Already exists',
    });
  });

  it('turns a Zod failure into VALIDATION_ERROR with field details', async () => {
    const response = await request(app.getHttpServer()).get('/__test/invalid').expect(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.code).toBe('VALIDATION_ERROR');
    expect(body.details.map((detail) => detail.field).sort()).toEqual(['name', 'qty']);
  });

  it.each([
    ['notfound', 404, 'NOT_FOUND', 'Invoice abc was not found', 0],
    ['conflict', 409, 'CONFLICT', 'Barcode already exists', 1],
    ['state', 409, 'INVALID_STATE', 'Transfer cannot move from RECEIVED to DISPATCHED', 0],
    ['rule', 422, 'BUSINESS_RULE_VIOLATION', 'Stock cannot go below zero', 0],
    ['branch', 403, 'FORBIDDEN', 'Access to this branch is not allowed', 0],
    ['validation', 400, 'VALIDATION_ERROR', 'Invalid sort', 1],
  ])('maps the %s domain error to %i %s', async (kind, status, code, message, details) => {
    const response = await request(app.getHttpServer())
      .get(`/__test/domain/${kind}`)
      .expect(status);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body).toMatchObject({ code, message });
    expect(body.details).toHaveLength(details);
  });

  it('hides the cause of an unexpected error', async () => {
    const response = await request(app.getHttpServer()).get('/__test/boom').expect(500);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).toBe('An unexpected error occurred');
    expect(JSON.stringify(body)).not.toContain('hunter2');
  });

  it('rejects malformed JSON with VALIDATION_ERROR', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/echo')
      .set('content-type', 'application/json')
      .send('{"broken":')
      .expect(400);
    expect(ErrorResponseSchema.parse(response.body).code).toBe('VALIDATION_ERROR');
  });

  it('rejects an oversized payload with VALIDATION_ERROR', async () => {
    const response = await request(app.getHttpServer())
      .post('/__test/echo')
      .send({ blob: 'x'.repeat(200_000) })
      .expect(413);
    expect(ErrorResponseSchema.parse(response.body).code).toBe('VALIDATION_ERROR');
  });

  it('always includes the request id from the response header', async () => {
    const response = await request(app.getHttpServer())
      .get('/__test/conflict')
      .set('x-request-id', 'trace-42')
      .expect(409);
    expect(response.body.requestId).toBe('trace-42');
  });
});
