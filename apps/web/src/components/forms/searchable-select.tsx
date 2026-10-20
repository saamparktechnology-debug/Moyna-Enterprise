import { useMemo, useState } from 'react';
import { SearchableCombobox } from './searchable-combobox';
import type { ComboOption, SearchableComboboxProps } from './searchable-combobox';

interface SearchableSelectProps extends Omit<
  SearchableComboboxProps,
  'value' | 'onChange' | 'onSearchChange' | 'options' | 'loading' | 'error' | 'onRetry'
> {
  /** The complete list. Filtering happens in the browser, so use it for lists of a few hundred at most. */
  options: readonly ComboOption[];
  /** The chosen option's `value`, or `""`. */
  value: string;
  onValueChange: (value: string) => void;
}

/** A select you can type into: for example choosing one state out of thirty-six. */
export function SearchableSelect({
  options,
  value,
  onValueChange,
  ...rest
}: SearchableSelectProps) {
  const [text, setText] = useState('');
  const selected = options.find((option) => option.value === value) ?? null;
  const visible = useMemo(() => {
    const needle = text.trim().toLowerCase();
    if (needle === '') return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(needle) ||
        (option.description ?? '').toLowerCase().includes(needle),
    );
  }, [options, text]);
  return (
    <SearchableCombobox
      {...rest}
      options={visible}
      value={selected}
      debounceMs={0}
      onSearchChange={setText}
      onChange={(option) => onValueChange(option?.value ?? '')}
    />
  );
}
