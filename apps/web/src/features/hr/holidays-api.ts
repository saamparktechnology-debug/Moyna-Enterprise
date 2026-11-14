import { HolidayListResponseSchema, HolidaySchema, RosterSchema } from '@erp/contracts';
import type {
  CreateDayOffRequest,
  CreateHolidayRequest,
  Holiday,
  HolidayListResponse,
  Roster,
  SetWeeklyOffRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export const listHolidays = (year: number): Promise<HolidayListResponse> =>
  api.get(`/holidays?year=${year}`, HolidayListResponseSchema);
export const addHoliday = (values: CreateHolidayRequest): Promise<Holiday> =>
  api.post('/holidays', values, HolidaySchema);
export const removeHoliday = (id: string): Promise<HolidayListResponse> =>
  api.delete(`/holidays/${id}`, HolidayListResponseSchema);

export const getRoster = (staffId: string, year: number): Promise<Roster> =>
  api.get(`/staff/${staffId}/roster?year=${year}`, RosterSchema);
export const setWeeklyOff = (staffId: string, values: SetWeeklyOffRequest): Promise<Roster> =>
  api.put(`/staff/${staffId}/roster/weekly-off`, values, RosterSchema);
export const addDayOff = (staffId: string, values: CreateDayOffRequest): Promise<Roster> =>
  api.post(`/staff/${staffId}/roster/days-off`, values, RosterSchema);
export const removeDayOff = (staffId: string, dayOffId: string): Promise<Roster> =>
  api.delete(`/staff/${staffId}/roster/days-off/${dayOffId}`, RosterSchema);
