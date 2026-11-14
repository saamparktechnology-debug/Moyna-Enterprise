import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateDayOffRequest,
  CreateHolidayRequest,
  SetWeeklyOffRequest,
} from '@erp/contracts';
import {
  addDayOff,
  addHoliday,
  getRoster,
  listHolidays,
  removeDayOff,
  removeHoliday,
  setWeeklyOff,
} from './holidays-api';

const KEY = 'hr';

export const useHolidays = (year: number) =>
  useQuery({ queryKey: [KEY, 'holidays', year], queryFn: () => listHolidays(year) });
export const useRoster = (staffId: string, year: number) =>
  useQuery({ queryKey: [KEY, 'roster', staffId, year], queryFn: () => getRoster(staffId, year) });

/** Holidays and rosters change what the day screen and payroll show, so everything in HR is refreshed. */
export function useHolidayMutations(staffId?: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    addHoliday: useMutation({
      mutationFn: (values: CreateHolidayRequest) => addHoliday(values),
      onSuccess: refresh,
    }),
    removeHoliday: useMutation({
      mutationFn: (id: string) => removeHoliday(id),
      onSuccess: refresh,
    }),
    setWeeklyOff: useMutation({
      mutationFn: (values: SetWeeklyOffRequest) => setWeeklyOff(staffId as string, values),
      onSuccess: refresh,
    }),
    addDayOff: useMutation({
      mutationFn: (values: CreateDayOffRequest) => addDayOff(staffId as string, values),
      onSuccess: refresh,
    }),
    removeDayOff: useMutation({
      mutationFn: (dayOffId: string) => removeDayOff(staffId as string, dayOffId),
      onSuccess: refresh,
    }),
  };
}
