import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  PermissionGroupsResponseSchema,
  RoleListResponseSchema,
  RoleSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { PermissionGroup, Role } from '@erp/contracts';
import type { Request } from 'express';
import { requestInfoFrom } from '../auth/auth.types.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { RolesService } from './roles.service.js';

@ApiTags('roles')
@ApiCookieAuth()
@Controller()
export class RolesController {
  constructor(@Inject(RolesService) private readonly roles: RolesService) {}

  @RequirePermission('roles.view')
  @Get('roles')
  @ApiOkResponse({ schema: toOpenApiSchema(RoleListResponseSchema) })
  list(@CurrentAuth() auth: AuthContext): Promise<Role[]> {
    return this.roles.list(auth);
  }

  @RequirePermission('roles.view')
  @Get('roles/:id')
  @ApiOkResponse({ schema: toOpenApiSchema(RoleSchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Role> {
    return this.roles.get(auth, id);
  }

  @RequirePermission('roles.view')
  @Get('permissions')
  @ApiOkResponse({ schema: toOpenApiSchema(PermissionGroupsResponseSchema) })
  permissions(): Promise<PermissionGroup[]> {
    return this.roles.permissions();
  }

  @RequirePermission('roles.manage')
  @Post('roles')
  @ApiCreatedResponse({ schema: toOpenApiSchema(RoleSchema) })
  create(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
  ): Promise<Role> {
    return this.roles.create(requestInfoFrom(request), auth, body);
  }

  @RequirePermission('roles.manage')
  @Patch('roles/:id')
  @ApiOkResponse({ schema: toOpenApiSchema(RoleSchema) })
  update(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Role> {
    return this.roles.update(requestInfoFrom(request), auth, id, body);
  }
}
