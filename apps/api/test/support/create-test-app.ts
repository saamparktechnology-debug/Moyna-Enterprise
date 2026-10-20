import type { Type } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/bootstrap.js';
import type { Env } from '../../src/common/config/env.js';
import { testEnv } from './test-env.js';

interface CreateTestAppOptions {
  env?: Env;
  controllers?: Type<unknown>[];
}

export async function createTestApp(
  options: CreateTestAppOptions = {},
): Promise<NestExpressApplication> {
  const env = options.env ?? testEnv();
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
    controllers: options.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  configureApp(app, env);
  await app.init();
  return app;
}
