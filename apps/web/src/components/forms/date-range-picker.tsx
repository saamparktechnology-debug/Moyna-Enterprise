import { useId } from 'react';
import { DatePicker } from './date-picker';
import { cn } from '@/lib/utils';

interface DateRangePickerProps {
  legend: string;
  from: string;
  to: string;
  onChange: (range: { from: string; to: string }) => void;
  className?: string;
}

/** Two dates that cannot cross: the end cannot be before the start, so a bad range cannot be sent. */
export function DateRangePicker({ legend, from, to, onChange, className }: DateRangePickerProps) {
  const id = useId();
  return (
    <fieldset className={cn('flex flex-wrap items-end gap-2 border-0 p-0', className)}>
      <legend className="mb-1.5 text-sm font-medium">{legend}</legend>
      <label htmlFor={`${id}-from`} className="space-y-1 text-xs text-muted-foreground">
        <span>From</span>
        <DatePicker
          id={`${id}-from`}
          value={from}
          max={to || undefined}
          onValueChange={(value) => onChange({ from: value, to })}
          className="w-40 text-foreground"
        />
      </label>
      <label htmlFor={`${id}-to`} className="space-y-1 text-xs text-muted-foreground">
        <span>To</span>
        <DatePicker
          id={`${id}-to`}
          value={to}
          min={from || undefined}
          onValueChange={(value) => onChange({ from, to: value })}
          className="w-40 text-foreground"
        />
      </label>
    </fieldset>
  );
}
