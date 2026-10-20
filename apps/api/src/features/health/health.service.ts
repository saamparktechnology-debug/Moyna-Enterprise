import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { HealthResponse } from '@erp/contracts';
import { PinoLogger } from 'nestjs-pino';
import { PrismaService } from '../../common/prisma/prisma.service.js';

const DATABASE_CHECK_TIMEOUT_MS = 3000;

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(HealthService.name);
  }

  async check(): Promise<HealthResponse> {
    await this.assertDatabaseReachable();
    return { status: 'ok', database: 'up', uptimeSeconds: process.uptime() };
  }

  private async assertDatabaseReachable(): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('database health check timed out')),
        DATABASE_CHECK_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([this.prisma.$queryRaw`SELECT 1`, timeout]);
    } catch (err) {
      this.logger.warn({ err }, 'Database health check failed');
      throw new ServiceUnavailableException({
        code: 'DATABASE_UNAVAILABLE',
        message: 'The database is not reachable',
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
