import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { ErrorResponseSchema, HealthResponseSchema, toOpenApiSchema } from '@erp/contracts';
import type { HealthResponse } from '@erp/contracts';
import { Public } from '../auth/decorators.js';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  @ApiOkResponse({
    description: 'Service and database are healthy',
    schema: toOpenApiSchema(HealthResponseSchema),
  })
  @ApiServiceUnavailableResponse({
    description: 'The database is not reachable',
    schema: toOpenApiSchema(ErrorResponseSchema),
  })
  check(): Promise<HealthResponse> {
    return this.health.check();
  }
}
