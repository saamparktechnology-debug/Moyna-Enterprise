import { Global, Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { Env } from './env.js';

export const APP_CONFIG = Symbol('APP_CONFIG');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: APP_CONFIG, useValue: env }],
      exports: [APP_CONFIG],
    };
  }
}
