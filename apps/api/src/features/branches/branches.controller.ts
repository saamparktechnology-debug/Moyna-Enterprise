import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { BranchListResponseSchema, BranchSchema, toOpenApiSchema } from '@erp/contracts';
import type { Branch, BranchListResponse } from '@erp/contracts';
import type { Request } from 'express';
import { requestInfoFrom } from '../auth/auth.types.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { BranchesService } from './branches.service.js';

@ApiTags('branches')
@ApiCookieAuth()
@Controller('branches')
export class BranchesController {
  constructor(@Inject(BranchesService) private readonly branches: BranchesService) {}

  @RequirePermission('branches.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(BranchListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<BranchListResponse> {
    return this.branches.list(auth, query);
  }

  @RequirePermission('branches.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(BranchSchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Branch> {
    return this.branches.get(auth, id);
  }

  @RequirePermission('branches.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(BranchSchema) })
  create(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
  ): Promise<Branch> {
    return this.branches.create(requestInfoFrom(request), auth, body);
  }

  @RequirePermission('branches.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(BranchSchema) })
  update(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Branch> {
    return this.branches.update(requestInfoFrom(request), auth, id, body);
  }

  @RequirePermission('branches.manage')
  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(BranchSchema) })
  deactivate(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Branch> {
    return this.branches.deactivate(requestInfoFrom(request), auth, id);
  }

  @RequirePermission('branches.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(BranchSchema) })
  reactivate(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Branch> {
    return this.branches.reactivate(requestInfoFrom(request), auth, id);
  }
}
