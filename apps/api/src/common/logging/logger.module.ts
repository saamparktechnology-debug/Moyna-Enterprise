import type { IncomingMessage, ServerResponse } from 'node:http';
import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Env } from '../config/env.js';
import { resolveRequestId } from './request-id.js';

export const REDACTED_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-csrf-token"]',
  'req.headers["x-document-number"]',
  'req.headers["x-document-number"]',
  'res.headers["set-cookie"]',
];

@Module({})
export class AppLoggerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppLoggerModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            redact: { paths: REDACTED_PATHS, censor: '[redacted]' },
            genReqId: (req: IncomingMessage, res: ServerResponse) => {
              const id = resolveRequestId(req.headers['x-request-id']);
              res.setHeader('x-request-id', id);
              return id;
            },
            transport:
              env.NODE_ENV === 'development'
                ? { target: 'pino-pretty', options: { singleLine: true } }
                : undefined,
          },
        }),
      ],
      exports: [LoggerModule],
    };
  }
}
