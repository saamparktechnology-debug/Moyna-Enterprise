import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiCookieAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import {
  HolidayListResponseSchema,
  HolidaySchema,
  RosterSchema,
  toOpenApiSchema,
} from '@erp/contracts';
import type { Holiday, HolidayListResponse, Roster } from '@erp/contracts';
import { RequirePermission } from '../auth/decorators.js';
import { RosterService } from './roster.service.js';

/** The company's holidays. Anyone who may see HR can read them; only the Super Admin changes them. */
@ApiTags('HR')
@ApiCookieAuth()
@Controller('holidays')
export class HolidaysController {
  constructor(@Inject(RosterService) private readonly roster: RosterService) {}

  @RequirePermission('hr.view')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(HolidayListResponseSchema) })
  list(@Query() query: Record<string, unknown>): Promise<HolidayListResponse> {
    return this.roster.listHolidays(query);
  }

  @RequirePermission('settings.manage')
  @Post()
  @ApiCreatedResponse({ schema: toOpenApiSchema(HolidaySchema) })
  add(@Body() body: unknown): Promise<Holiday> {
    return this.roster.addHoliday(body);
  }

  @RequirePermission('settings.manage')
  @Delete(':id')
  @ApiOkResponse({ schema: toOpenApiSchema(HolidayListResponseSchema) })
  remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<HolidayListResponse> {
    return this.roster.removeHoliday(id);
  }
}

/** The roster of one employee: their own weekly off days and days off. Read by managers, set by the Super Admin. */
@ApiTags('HR')
@ApiCookieAuth()
@Controller('staff/:staffId/roster')
export class RosterController {
  constructor(@Inject(RosterService) private readonly roster: RosterService) {}

  @RequirePermission('hr.manage')
  @Get()
  @ApiOkResponse({ schema: toOpenApiSchema(RosterSchema) })
  get(
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Query() query: Record<string, unknown>,
  ): Promise<Roster> {
    return this.roster.roster(staffId, query);
  }

  @RequirePermission('settings.manage')
  @Put('weekly-off')
  @ApiOkResponse({ schema: toOpenApiSchema(RosterSchema) })
  setWeeklyOff(
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Body() body: unknown,
  ): Promise<Roster> {
    return this.roster.setWeeklyOff(staffId, body);
  }

  @RequirePermission('settings.manage')
  @Post('days-off')
  @ApiCreatedResponse({ schema: toOpenApiSchema(RosterSchema) })
  addDayOff(
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Body() body: unknown,
  ): Promise<Roster> {
    return this.roster.addDayOff(staffId, body);
  }

  @RequirePermission('settings.manage')
  @Delete('days-off/:dayOffId')
  @ApiOkResponse({ schema: toOpenApiSchema(RosterSchema) })
  removeDayOff(
    @Param('staffId', new ParseUUIDPipe()) staffId: string,
    @Param('dayOffId', new ParseUUIDPipe()) dayOffId: string,
  ): Promise<Roster> {
    return this.roster.removeDayOff(staffId, dayOffId);
  }
}
