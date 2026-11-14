import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { AssemblyListResponseSchema, AssemblySchema, toOpenApiSchema } from '@erp/contracts';
import type { Assembly, AssemblyListResponse } from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { AssemblyService } from './assembly.service.js';

@ApiTags('Manufacturing')
@ApiCookieAuth()
@Controller('assemblies')
export class AssemblyController {
  constructor(@Inject(AssemblyService) private readonly assembly: AssemblyService) {}

  @RequirePermission('manufacturing.manage')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(AssemblyListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<AssemblyListResponse> {
    return this.assembly.list(auth, query);
  }

  @RequirePermission('manufacturing.manage')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(AssemblySchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Assembly> {
    return this.assembly.get(auth, id);
  }

  /** Assembles a product from parts in stock and sets its selling price. */
  @RequirePermission('manufacturing.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(AssemblySchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Assembly> {
    return this.assembly.create(auth, body);
  }

  /** Takes an assembly apart again, with a reason. */
  @RequirePermission('manufacturing.manage')
  @Post(':id/reverse')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(AssemblySchema) })
  reverse(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Assembly> {
    return this.assembly.reverse(auth, id, body);
  }
}
