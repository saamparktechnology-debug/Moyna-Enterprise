import { useState } from 'react';
import { CreateDayOffRequestSchema, WEEKDAYS } from '@erp/contracts';
import type { Staff, Weekday } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { FormField, Input } from '@/components/form-field';
import { LoadingState } from '@/components/loading-state';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { WEEKDAY_TEXT, weekdaysText } from './hr-shared';
import { useHolidayMutations, useRoster } from './use-holidays';

/**
 * The roster of one employee, set by the Super Admin: their own weekly off days (or the company's) and days off for them
 * alone. Company holidays are shown for reference and are set on the Holidays tab.
 */
export function RosterDialog({
  person,
  year,
  onClose,
}: {
  person: Staff;
  year: number;
  onClose: () => void;
}) {
  const roster = useRoster(person.id, year);
  const { setWeeklyOff, addDayOff, removeDayOff } = useHolidayMutations(person.id);
  const [picked, setPicked] = useState<Set<Weekday> | null>(null);
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const data = roster.data;
  // What the boxes show: what the person is picking now, else what is saved (their own days, else the company's).
  const shown = picked ?? new Set<Weekday>(data?.weeklyOffDays ?? []);
  const toggle = (day: Weekday, on: boolean) => {
    const next = new Set(shown);
    if (on) next.add(day);
    else next.delete(day);
    setPicked(next);
  };

  const run = async (action: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try {
      await action();
      toast.success(done);
      return true;
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
      return false;
    }
  };

  const saveWeekly = async (days: Weekday[] | null) => {
    if (!data) return;
    const ok = await run(
      () => setWeeklyOff.mutateAsync({ weeklyOffDays: days, rowVersion: data.rowVersion }),
      days === null ? 'Back to the company’s weekly off days' : 'Weekly off days saved',
    );
    if (ok) setPicked(null);
  };

  const addOff = async () => {
    const checked = CreateDayOffRequestSchema.safeParse({
      date,
      ...(name.trim() ? { name: name.trim() } : {}),
    });
    if (!checked.success) {
      setErrors(
        Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
      );
      return;
    }
    setErrors({});
    if (await run(() => addDayOff.mutateAsync(checked.data), 'Day off added')) {
      setDate('');
      setName('');
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Roster of {person.fullName}</DialogTitle>
        <DialogDescription>
          Their weekly off days and days off for {year}. Holidays for everyone are on the Holidays
          tab. A change counts from the next payroll that is made.
        </DialogDescription>
        {problem ? <ProblemAlert problem={problem} /> : null}
        {roster.isPending ? (
          <LoadingState label="Loading the roster…" rows={3} />
        ) : roster.isError || !data ? (
          <Alert tone="error">Could not load the roster.</Alert>
        ) : (
          <div className="mt-3 space-y-5">
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Weekly off days</legend>
              <p className="text-sm text-muted-foreground">
                {data.ownWeeklyOff === null
                  ? `Using the company’s weekly off: ${weekdaysText(data.companyWeeklyOffDays)}.`
                  : `Their own weekly off: ${weekdaysText(data.ownWeeklyOff)}. The company’s is ${weekdaysText(data.companyWeeklyOffDays)}.`}
              </p>
              <div
                className="flex flex-wrap gap-x-4 gap-y-2"
                role="group"
                aria-label="Weekly off days"
              >
                {WEEKDAYS.map((day) => (
                  <label key={day} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={shown.has(day)}
                      onChange={(event) => toggle(day, event.target.checked)}
                    />
                    {WEEKDAY_TEXT[day]}
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={setWeeklyOff.isPending || picked === null}
                  onClick={() => void saveWeekly(WEEKDAYS.filter((day) => shown.has(day)))}
                >
                  Save weekly off days
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={setWeeklyOff.isPending || data.ownWeeklyOff === null}
                  onClick={() => void saveWeekly(null)}
                >
                  Use the company’s weekly off
                </Button>
              </div>
            </fieldset>

            <section aria-label="Days off" className="space-y-2">
              <h3 className="text-sm font-medium">Days off for {person.fullName} only</h3>
              {data.daysOff.length === 0 ? (
                <p className="text-sm text-muted-foreground">None in {year}.</p>
              ) : (
                <SimpleTable
                  label="Days off"
                  rows={data.daysOff}
                  getRowKey={(row) => row.id}
                  columns={[
                    { header: 'Day', cell: (row) => row.date },
                    { header: 'Reason', cell: (row) => row.name ?? '—' },
                    {
                      header: 'Actions',
                      cell: (row) => (
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={removeDayOff.isPending}
                          aria-label={`Remove day off ${row.date}`}
                          onClick={() =>
                            void run(() => removeDayOff.mutateAsync(row.id), 'Day off removed')
                          }
                        >
                          Remove
                        </Button>
                      ),
                    },
                  ]}
                />
              )}
              <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                <FormField label="Date" error={errors['date']}>
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Reason (optional)" error={errors['name']}>
                  {(props) => (
                    <Input
                      {...props}
                      value={name}
                      maxLength={80}
                      onChange={(event) => setName(event.target.value)}
                    />
                  )}
                </FormField>
                <Button disabled={addDayOff.isPending} onClick={() => void addOff()}>
                  Add day off
                </Button>
              </div>
            </section>

            <section aria-label="Company holidays" className="space-y-1">
              <h3 className="text-sm font-medium">Company holidays {year}</h3>
              {data.companyHolidays.length === 0 ? (
                <p className="text-sm text-muted-foreground">None set.</p>
              ) : (
                <ul className="text-sm">
                  {data.companyHolidays.map((holiday) => (
                    <li key={holiday.id}>
                      {holiday.date} · {holiday.name}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
