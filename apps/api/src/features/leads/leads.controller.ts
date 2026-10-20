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
  ConvertLeadResponseSchema,
  FollowupCountsSchema,
  FollowupListResponseSchema,
  FollowupSchema,
  LeadAssigneeListResponseSchema,
  LeadListResponseSchema,
  LeadNoteSchema,
  LeadSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type {
  ConvertLeadResponse,
  Followup,
  FollowupCounts,
  FollowupListResponse,
  Lead,
  LeadAssignee,
  LeadListResponse,
  LeadNote,
} from '@erp/contracts';
import type { AuthContext } from '../auth/auth.types.js';
import { CurrentAuth, RequirePermission } from '../auth/decorators.js';
import { FollowupsService } from './followups.service.js';
import { LeadsService } from './leads.service.js';

@ApiTags('leads')
@ApiCookieAuth()
@Controller('leads')
export class LeadsController {
  constructor(
    @Inject(LeadsService) private readonly leads: LeadsService,
    @Inject(FollowupsService) private readonly followups: FollowupsService,
  ) {}

  @RequirePermission('leads.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(LeadListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<LeadListResponse> {
    return this.leads.list(auth, query);
  }

  @RequirePermission('leads.view')
  @Get('assignees')
  @ApiOkResponse({ schema: toOpenApiSchema(LeadAssigneeListResponseSchema) })
  assignees(@Query('branchId') branchId?: string): Promise<LeadAssignee[]> {
    return this.leads.assignees(branchId);
  }

  @RequirePermission('leads.view')
  @Get(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(LeadSchema) })
  get(@Param('id', new ParseUUIDPipe()) id: string): Promise<Lead> {
    return this.leads.get(id);
  }

  @RequirePermission('leads.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(LeadSchema) })
  create(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<Lead> {
    return this.leads.create(auth, body);
  }

  @RequirePermission('leads.manage')
  @Patch(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(LeadSchema) })
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Lead> {
    return this.leads.update(auth, id, body);
  }

  @RequirePermission('leads.manage')
  @Post(':id/stage')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(LeadSchema) })
  changeStage(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Lead> {
    return this.leads.changeStage(auth, id, body);
  }

  @RequirePermission('leads.manage')
  @Post(':id/assign')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(LeadSchema) })
  assign(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Lead> {
    return this.leads.assign(auth, id, body);
  }

  @RequirePermission('leads.manage')
  @Post(':id/notes')
  @ApiCreatedResponse({ schema: toOpenApiSchema(LeadNoteSchema) })
  note(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<LeadNote> {
    return this.leads.note(auth, id, body);
  }

  /** Makes the lead a customer, or links the customer who already has its phone number. */
  @RequirePermission('leads.manage')
  @Post(':id/convert')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(ConvertLeadResponseSchema) })
  convert(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<ConvertLeadResponse> {
    return this.leads.convert(auth, id, body);
  }

  @RequirePermission('leads.manage')
  @Post(':id/followups')
  @ApiCreatedResponse({ schema: toOpenApiSchema(FollowupSchema) })
  schedule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Followup> {
    return this.followups.create(auth, id, body);
  }
}

@ApiTags('leads')
@ApiCookieAuth()
@Controller('followups')
export class FollowupsController {
  constructor(@Inject(FollowupsService) private readonly followups: FollowupsService) {}

  @RequirePermission('leads.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(FollowupListResponseSchema) })
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<FollowupListResponse> {
    return this.followups.list(auth, query);
  }

  @RequirePermission('leads.view')
  @Get('counts')
  @ApiOkResponse({ schema: toOpenApiSchema(FollowupCountsSchema) })
  counts(
    @CurrentAuth() auth: AuthContext,
    @Query() query: Record<string, unknown>,
  ): Promise<FollowupCounts> {
    return this.followups.counts(auth, query);
  }

  @RequirePermission('leads.manage')
  @Post(':id/complete')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(FollowupSchema) })
  complete(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Followup> {
    return this.followups.complete(auth, id, body);
  }

  @RequirePermission('leads.manage')
  @Post(':id/reschedule')
  @HttpCode(200)
  @ApiOkResponse({ schema: toOpenApiSchema(FollowupSchema) })
  reschedule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: unknown,
  ): Promise<Followup> {
    return this.followups.reschedule(auth, id, body);
  }
}
