import type { NestExpressApplication } from '@nestjs/platform-express';
import { ErrorResponseSchema, HealthResponseSchema, toOpenApiSchema } from '@erp/contracts';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { testEnv } from '../support/test-env.js';

describe('GET /health with the database up', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a healthy response that matches the shared contract', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(HealthResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      database: 'up',
    });
  });

  it('adds a request id header and reuses a well-formed incoming one', async () => {
    const generated = await request(app.getHttpServer()).get('/health').expect(200);
    expect(generated.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);

    const reused = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'trace-abc.123')
      .expect(200);
    expect(reused.headers['x-request-id']).toBe('trace-abc.123');
  });

  it('replaces a malformed incoming request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .set('x-request-id', 'bad id!')
      .expect(200);
    expect(response.headers['x-request-id']).not.toBe('bad id!');
  });

  it('does not advertise the framework', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(200);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /health with the database down', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({
      env: testEnv({ DATABASE_URL: 'postgresql://erp:erp@127.0.0.1:1/erp_test' }),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 503 with a clear error in the standard shape', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(503);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.code).toBe('DATABASE_UNAVAILABLE');
    expect(body.message).toBe('The database is not reachable');
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('does not leak connection details', async () => {
    const response = await request(app.getHttpServer()).get('/health').expect(503);
    expect(JSON.stringify(response.body)).not.toMatch(/127\.0\.0\.1|erp:erp|ECONNREFUSED/);
  });
});

describe('OpenAPI document', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('documents /health using the shared Zod contracts', async () => {
    const response = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const operation = response.body.paths['/health'].get;
    expect(operation.responses['200'].content['application/json'].schema).toEqual(
      toOpenApiSchema(HealthResponseSchema),
    );
    expect(operation.responses['503'].content['application/json'].schema).toEqual(
      toOpenApiSchema(ErrorResponseSchema),
    );
  });

  it('serves the interactive docs page at /docs', async () => {
    const response = await request(app.getHttpServer()).get('/docs').redirects(1).expect(200);
    expect(response.text).toContain('swagger');
  });
});
