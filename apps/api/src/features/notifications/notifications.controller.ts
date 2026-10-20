import {
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  MarkAllReadResponseSchema,
  NotificationListResponseSchema,
  NotificationSchema,
  UnreadCountResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  MarkAllReadResponse,
  Notification,
  NotificationListResponse,
  UnreadCountResponse,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiCookieAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(@Inject(NotificationsService) private readonly notifications: NotificationsService) {}

  @RequirePermission('notifications.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(NotificationListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<NotificationListResponse> {
    return this.notifications.list(auth, query);
  }

  @RequirePermission('notifications.view')
  @Get('unread-count')
  @ApiOkResponse({ schema: toOpenApiSchema(UnreadCountResponseSchema) })
  unreadCount(@CurrentAuth() auth: AuthContext): Promise<UnreadCountResponse> {
    return this.notifications.unreadCount(auth);
  }

  @RequirePermission('notifications.view')
  @Post('read-all')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(MarkAllReadResponseSchema) })
  markAllRead(@CurrentAuth() auth: AuthContext): Promise<MarkAllReadResponse> {
    return this.notifications.markAllRead(auth);
  }

  @RequirePermission('notifications.view')
  @Post(':id/read')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(NotificationSchema) })
  markRead(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<Notification> {
    return this.notifications.markRead(auth, id);
  }
}
