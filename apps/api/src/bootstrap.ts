import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import type { Env } from './common/config/env.js';

export function configureApp(app: NestExpressApplication, env: Env): void {
  app.useLogger(app.get(Logger));
  app.disable('x-powered-by');
  // Behind Nginx in production the client address is the first forwarded hop; elsewhere never trust the header.
  app.set('trust proxy', env.NODE_ENV === 'production' ? 1 : false);
  app.enableCors({ origin: env.WEB_ORIGIN, credentials: true });
  // KYC files arrive as the raw request body. The limit is a little above the 5 MB rule so that an oversized file gets
  // a clear message from the application instead of a bare transport error.
  app.useBodyParser('raw', {
    type: ['application/pdf', 'image/jpeg', 'image/png'],
    limit: '6mb',
  });
  app.enableShutdownHooks();
  // KYC files arrive as the request body. The limit is a little above the 5 MB rule so that a file just over it
  // gets the friendly message from the service, not a bare parser error.
  app.useBodyParser('raw', {
    type: ['application/pdf', 'image/jpeg', 'image/png'],
    limit: '6mb',
  });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('ERP API')
      .setVersion('0.1.0')
      .addCookieAuth('erp_session')
      .build(),
  );
  SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
}
