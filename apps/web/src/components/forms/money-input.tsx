import { useState } from 'react';
import type { ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { finishMoney, sanitizeMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

interface MoneyInputProps extends Omit<
  ComponentProps<'input'>,
  'value' | 'onChange' | 'type' | 'inputMode'
> {
  /** A plain decimal string such as `"1250.50"`, or `""`. */
  value: string;
  onValueChange: (value: string) => void;
  decimals?: number;
  allowNegative?: boolean;
}

/**
 * An amount in rupees. The value stays a decimal string while typing and is padded to the full number of
 * decimals when the field is left, so what the API receives is exactly what the person sees.
 */
export function MoneyInput({
  value,
  onValueChange,
  decimals = 2,
  allowNegative = false,
  className,
  onBlur,
  ...props
}: MoneyInputProps) {
  const [focused, setFocused] = useState(false);
  const options = { decimals, allowNegative };
  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground"
      >
        ₹
      </span>
      <Input
        {...props}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        className={cn('tabular pl-7 text-right', className)}
        onFocus={(event) => {
          setFocused(true);
          props.onFocus?.(event);
        }}
        onChange={(event) => onValueChange(sanitizeMoney(event.target.value, options))}
        onBlur={(event) => {
          setFocused(false);
          const finished = finishMoney(value, options);
          if (finished !== value) onValueChange(finished);
          onBlur?.(event);
        }}
        data-editing={focused || undefined}
      />
    </div>
  );
}
