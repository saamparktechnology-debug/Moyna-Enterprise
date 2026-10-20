import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstallBatteryRequest, SetBatteryDetailsRequest } from '@erp/contracts';
import {
  getAlerts,
  getBattery,
  installBattery,
  listBatteries,
  setDetails,
  uninstallBattery,
} from './batteries-api';
import type { BatteryListParams } from './batteries-api';

const KEY = 'batteries';

export const useBatteries = (params: BatteryListParams) =>
  useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listBatteries(params),
    placeholderData: keepPreviousData,
  });

export const useBatteryAlerts = (withinDays: number) =>
  useQuery({ queryKey: [KEY, 'alerts', withinDays], queryFn: () => getAlerts(withinDays) });

export const useBattery = (serialUnitId: string | null) =>
  useQuery({
    queryKey: [KEY, 'one', serialUnitId],
    queryFn: () => getBattery(serialUnitId ?? ''),
    enabled: serialUnitId !== null,
  });

export function useBatteryMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    setDetails: useMutation({
      mutationFn: ({ id, values }: { id: string; values: SetBatteryDetailsRequest }) =>
        setDetails(id, values),
      onSuccess: refresh,
    }),
    install: useMutation({
      mutationFn: ({ id, values }: { id: string; values: InstallBatteryRequest }) =>
        installBattery(id, values),
      onSuccess: refresh,
    }),
    uninstall: useMutation({
      mutationFn: (id: string) => uninstallBattery(id),
      onSuccess: refresh,
    }),
  };
}
