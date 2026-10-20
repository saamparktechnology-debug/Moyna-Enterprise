import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './bootstrap.js';
import { ConfigValidationError, loadEnv } from './common/config/env.js';

async function bootstrap(): Promise<void> {
  const env = loadEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(env), {
    bufferLogs: true,
  });
  configureApp(app, env);
  await app.listen(env.API_PORT);
}

bootstrap().catch((err: unknown) => {
  if (err instanceof ConfigValidationError) {
    process.stderr.write(`${err.message}\n`);
  } else {
    process.stderr.write(
      `API failed to start: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
  }
  process.exit(1);
});
