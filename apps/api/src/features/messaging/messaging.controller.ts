import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  BulkPreviewSchema,
  MessageOptOutListResponseSchema,
  MessageOptOutSchema,
  MessageCampaignListResponseSchema,
  MessageCampaignSchema,
  MessagingStatusSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  BulkPreview,
  MessageCampaign,
  MessageCampaignListResponse,
  MessageOptOut,
  MessageOptOutListResponse,
  MessagingStatus,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { MessagingService } from './messaging.service.js';

@ApiTags('Messages')
@ApiCookieAuth()
@Controller('messages')
export class MessagingController {
  constructor(@Inject(MessagingService) private readonly messaging: MessagingService) {}

  /** Whether WhatsApp and email are set up. */
  @RequirePermission('messages.send')
  @Get('status')
  @ApiOkResponse({ schema: toOpenApiSchema(MessagingStatusSchema) })
  status(): MessagingStatus {
    return this.messaging.status();
  }

  /** Sends an invoice or a receipt to the customer as a PDF, by WhatsApp or email. */
  @RequirePermission('messages.send')
  @Post('documents')
  @ApiCreatedResponse({ schema: toOpenApiSchema(MessageCampaignSchema) })
  sendDocument(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<MessageCampaign> {
    return this.messaging.sendDocument(auth, body);
  }

  @RequirePermission('messages.bulk')
  @Post('bulk/preview')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(BulkPreviewSchema) })
  preview(@Body() body: unknown): Promise<BulkPreview> {
    return this.messaging.preview(body);
  }

  /** Makes a bulk message and its list of people. Nothing is sent until the campaign is sent. */
  @RequirePermission('messages.bulk')
  @Post('bulk')
  @ApiCreatedResponse({ schema: toOpenApiSchema(MessageCampaignSchema) })
  createBulk(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<MessageCampaign> {
    return this.messaging.createBulk(auth, body);
  }

  @RequirePermission('messages.bulk')
  @Get('campaigns')
  @ApiOkResponse({ schema: toOpenApiSchema(MessageCampaignListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<MessageCampaignListResponse> {
    return this.messaging.listCampaigns(query);
  }

  @RequirePermission('messages.bulk')
  @Get('campaigns/:id')
  @ApiOkResponse({ schema: toOpenApiSchema(MessageCampaignSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<MessageCampaign> {
    return this.messaging.get(id);
  }

  /** Sends the next few waiting messages of a campaign; call again until none are waiting. */
  @RequirePermission('messages.bulk')
  @Post('campaigns/:id/send')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(MessageCampaignSchema) })
  send(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MessageCampaign> {
    return this.messaging.send(auth, id);
  }

  /** Customers who asked not to get bulk messages. */
  @RequirePermission('messages.bulk')
  @Get('opt-outs')
  @ApiOkResponse({ schema: toOpenApiSchema(MessageOptOutListResponseSchema) })
  optOuts(): Promise<MessageOptOutListResponse> {
    return this.messaging.listOptOuts();
  }

  @RequirePermission('messages.bulk')
  @Post('opt-outs')
  @ApiCreatedResponse({ schema: toOpenApiSchema(MessageOptOutSchema) })
  addOptOut(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<MessageOptOut> {
    return this.messaging.addOptOut(auth, body);
  }

  @RequirePermission('messages.bulk')
  @Delete('opt-outs/:customerId')
  @ApiOkResponse({ schema: toOpenApiSchema(MessageOptOutListResponseSchema) })
  removeOptOut(
    @Param('customerId', new ParseUUIDPipe()) customerId: string,
  ): Promise<MessageOptOutListResponse> {
    return this.messaging.removeOptOut(customerId);
  }

  @RequirePermission('messages.bulk')
  @Post('campaigns/:id/retry')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(MessageCampaignSchema) })
  retry(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<MessageCampaign> {
    return this.messaging.retryFailed(auth, id);
  }
}
