import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';

interface DatePickerProps extends Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'type'> {
  /** A calendar date as `YYYY-MM-DD`, or `""`. */
  value: string;
  onValueChange: (value: string) => void;
  min?: string;
  max?: string;
}

/**
 * The platform's own date control: it brings the right calendar, keyboard entry and screen-reader
 * behaviour on every device, and it hands back the `YYYY-MM-DD` text the API already expects.
 */
export function DatePicker({ value, onValueChange, ...props }: DatePickerProps) {
  return (
    <Input
      {...props}
      type="date"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    />
  );
}
