import { Inject, Injectable } from '@nestjs/common';
import type { OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG } from '../config/config.module.js';
import type { Env } from '../config/env.js';

const CONNECTION_TIMEOUT_MS = 3000;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: Env) {
    super({
      adapter: new PrismaPg({
        connectionString: config.DATABASE_URL,
        connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
      }),
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
