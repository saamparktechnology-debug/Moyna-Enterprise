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
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  BrokerLedgerSchema,
  BrokerListResponseSchema,
  BrokerSchema,
  CommissionListResponseSchema,
  PayoutResponseSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  Broker,
  BrokerLedger,
  BrokerListResponse,
  CommissionListResponse,
  PayoutResponse,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { BrokersService } from './brokers.service.js';
import { CommissionsService } from './commissions.service.js';

@ApiTags('brokers')
@ApiCookieAuth()
@Controller('brokers')
export class BrokersController {
  constructor(@Inject(BrokersService) private readonly brokers: BrokersService) {}

  @RequirePermission('brokers.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<BrokerListResponse> {
    return this.brokers.list(query);
  }

  @RequirePermission('brokers.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Broker> {
    return this.brokers.get(id);
  }

  @RequirePermission('brokers.view')
  @Get(':id/ledger')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerLedgerSchema) })
  ledger(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<BrokerLedger> {
    return this.brokers.ledger(id, query);
  }

  @RequirePermission('brokers.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(BrokerSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Broker> {
    return this.brokers.create(auth, body);
  }

  @RequirePermission('brokers.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(BrokerSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Broker> {
    return this.brokers.update(auth, id, body);
  }

  /** Puts a new commission rule in force and retires the old one; rules are never edited. */
  @RequirePermission('brokers.manage')
  @Post(':id/rules')
  @ApiCreatedResponse({ schema: toOpenApiSchema(BrokerSchema) })
  addRule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Broker> {
    return this.brokers.addRule(auth, id, body);
  }
}

@ApiTags('brokers')
@ApiCookieAuth()
@Controller('commissions')
export class CommissionsController {
  constructor(@Inject(CommissionsService) private readonly commissions: CommissionsService) {}

  @RequirePermission('brokers.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(CommissionListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<CommissionListResponse> {
    return this.commissions.list(query);
  }

  /** Pays commissions to one broker, each at what it is worth now. */
  @RequirePermission('commissions.approve_payout')
  @Post('payout')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(PayoutResponseSchema) })
  payout(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<PayoutResponse> {
    return this.commissions.payout(auth, body);
  }
}
