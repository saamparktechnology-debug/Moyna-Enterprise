import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  OkResponseSchema,
  ResetPasswordResponseSchema,
  SessionResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { OkResponse, ResetPasswordResponse, SessionResponse } from '@erp/contracts';
import type { Request, Response } from 'express';
import { APP_CONFIG } from '../../common/config/config.module.js';
import type { Env } from '../../common/config/env.js';
import { AuthService } from './auth.service.js';
import type { IssuedSession } from './auth.service.js';
import { requestInfoFrom } from './auth.types.js';
import type { AuthContext } from './auth.types.js';
import { readCookie, sessionCookieName, sessionCookieOptions } from './cookies.js';
import {
  AllowPasswordChange,
  Authenticated,
  CurrentAuth,
  Public,
  RequirePermission,
} from './decorators.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly env: Env,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: toOpenApiSchema(SessionResponseSchema) })
  async login(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @Body() body: unknown,
  ): Promise<SessionResponse> {
    const issued = await this.auth.login(requestInfoFrom(request), body);
    return this.start(response, issued);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOkResponse({ schema: toOpenApiSchema(OkResponseSchema) })
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<OkResponse> {
    const name = sessionCookieName(this.isProduction);
    await this.auth.logout(requestInfoFrom(request), readCookie(request.headers.cookie, name));
    response.clearCookie(name, { path: '/' });
    return { ok: true };
  }

  @Authenticated()
  @AllowPasswordChange()
  @Get('session')
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth()
  @ApiOkResponse({ schema: toOpenApiSchema(SessionResponseSchema) })
  session(@CurrentAuth() auth: AuthContext): Promise<SessionResponse> {
    return this.auth.currentSession(auth);
  }

  @Authenticated()
  @AllowPasswordChange()
  @Post('change-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth()
  @ApiOkResponse({ schema: toOpenApiSchema(SessionResponseSchema) })
  async changePassword(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentAuth() auth: AuthContext,
    @Body() body: unknown,
  ): Promise<SessionResponse> {
    const issued = await this.auth.changePassword(requestInfoFrom(request), auth, body);
    return this.start(response, issued);
  }

  @RequirePermission('users.reset_password')
  @Post('users/:userId/reset-password')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiCookieAuth()
  @ApiOkResponse({ schema: toOpenApiSchema(ResetPasswordResponseSchema) })
  resetPassword(
    @Req() request: Request,
    @CurrentAuth() auth: AuthContext,
    @Param('userId', new ParseUUIDPipe()) userId: string,
  ): Promise<ResetPasswordResponse> {
    return this.auth.resetPassword(requestInfoFrom(request), auth, userId);
  }

  private get isProduction(): boolean {
    return this.env.NODE_ENV === 'production';
  }

  private start(response: Response, issued: IssuedSession): SessionResponse {
    response.cookie(
      sessionCookieName(this.isProduction),
      issued.token,
      sessionCookieOptions(this.isProduction, issued.maxAgeMs),
    );
    return issued.response;
  }
}
