import { useState } from 'react';
import { CreateHolidayRequestSchema, todayInIndia, weekdayOf } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { FormField, Input } from '@/components/form-field';
import { LoadingState } from '@/components/loading-state';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { WEEKDAY_TEXT, weekdaysText } from './hr-shared';
import { useHolidayMutations, useHolidays } from './use-holidays';

/** The company's weekly off days and holidays. Everyone can read them; only the Super Admin changes them. */
export function HolidaysTab() {
  const { can } = useAuth();
  const editable = can('settings.manage');
  const [year, setYear] = useState(Number(todayInIndia().slice(0, 4)));
  const holidays = useHolidays(year);
  const { addHoliday, removeHoliday } = useHolidayMutations();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const add = async () => {
    setProblem(null);
    const checked = CreateHolidayRequestSchema.safeParse({ date, name });
    if (!checked.success) {
      setErrors(
        Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
      );
      return;
    }
    setErrors({});
    try {
      await addHoliday.mutateAsync(checked.data);
      setDate('');
      setName('');
      toast.success('Holiday added');
      if (Number(checked.data.date.slice(0, 4)) !== year)
        setYear(Number(checked.data.date.slice(0, 4)));
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };
  const remove = async (id: string) => {
    setProblem(null);
    try {
      await removeHoliday.mutateAsync(id);
      toast.success('Holiday removed');
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <section aria-label="Holidays" className="space-y-4">
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Previous year"
          onClick={() => setYear(year - 1)}
        >
          ‹
        </Button>
        <h2 className="section-title" aria-live="polite">
          {year}
        </h2>
        <Button
          variant="secondary"
          size="sm"
          aria-label="Next year"
          onClick={() => setYear(year + 1)}
        >
          ›
        </Button>
      </div>
      {problem ? <ProblemAlert problem={problem} /> : null}
      {holidays.isPending ? (
        <LoadingState label="Loading the holidays…" rows={3} />
      ) : holidays.isError ? (
        <Alert tone="error">Could not load the holidays.</Alert>
      ) : (
        <>
          <p className="text-sm">
            Weekly off: <strong>{weekdaysText(holidays.data.weeklyOffDays)}</strong>.{' '}
            {holidays.data.paidForDailyStaff
              ? 'People paid by the day are paid for weekly offs and holidays they do not work.'
              : 'People paid by the day are paid only for the hours they work.'}{' '}
            {editable
              ? 'Change these in Settings, Company. A person can have weekly off days and days off of their own on the Staff screen.'
              : ''}
          </p>
          {holidays.data.items.length === 0 ? (
            <p className="text-sm text-muted-foreground">No holidays are set for {year}.</p>
          ) : (
            <SimpleTable
              label="Holidays"
              rows={holidays.data.items}
              getRowKey={(row) => row.id}
              columns={[
                {
                  header: 'Day',
                  cell: (row) => `${row.date} (${WEEKDAY_TEXT[weekdayOf(row.date)]})`,
                },
                { header: 'Holiday', cell: (row) => row.name },
                ...(editable
                  ? [
                      {
                        header: 'Actions',
                        cell: (row: { id: string; name: string }) => (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={removeHoliday.isPending}
                            aria-label={`Remove ${row.name}`}
                            onClick={() => void remove(row.id)}
                          >
                            Remove
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </>
      )}
      {editable ? (
        <form
          className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-[12rem_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
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
          <FormField label="Holiday name" error={errors['name']}>
            {(props) => (
              <Input
                {...props}
                value={name}
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
              />
            )}
          </FormField>
          <Button type="submit" disabled={addHoliday.isPending}>
            Add holiday
          </Button>
        </form>
      ) : null}
    </section>
  );
}
