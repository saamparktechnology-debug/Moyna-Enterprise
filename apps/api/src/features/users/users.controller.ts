import {
  Body,
  Controller,
  Get,
  Header,
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
import {
  CreateUserResponseSchema,
  UserListResponseSchema,
  UserSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { CreateUserResponse, User, UserListResponse } from '@erp/contracts';
import type { Request } from 'express';
import { requestInfoFrom } from '../auth/auth.types.js';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { UsersService } from './users.service.js';

@ApiTags('users')
@ApiCookieAuth()
@Controller('users')
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @RequirePermission('users.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(UserListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<UserListResponse> {
    return this.users.list(auth, query);
  }

  @RequirePermission('users.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(UserSchema) })
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<User> {
    return this.users.get(auth, id);
  }

  @RequirePermission('users.manage')
  @Post()
  @Header('Cache-Control', 'no-store')
  @ApiCreatedResponse({ schema: toOpenApiSchema(CreateUserResponseSchema) })
  create(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
  ): Promise<CreateUserResponse> {
    return this.users.create(requestInfoFrom(request), auth, body);
  }

  @RequirePermission('users.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(UserSchema) })
  update(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<User> {
    return this.users.update(requestInfoFrom(request), auth, id, body);
  }

  @RequirePermission('users.manage')
  @Post(':id/deactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(UserSchema) })
  deactivate(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<User> {
    return this.users.deactivate(requestInfoFrom(request), auth, id);
  }

  @RequirePermission('users.manage')
  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(UserSchema) })
  reactivate(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<User> {
    return this.users.reactivate(requestInfoFrom(request), auth, id);
  }
}
