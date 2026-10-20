import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { FormField } from '@/components/form-field';
import { FormSection } from '@/components/form-section';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BarcodeInput } from './barcode-input';
import { DatePicker } from './date-picker';
import { DateRangePicker } from './date-range-picker';
import { FileUpload } from './file-upload';
import { MoneyInput } from './money-input';
import { SearchableCombobox } from './searchable-combobox';
import type { ComboOption } from './searchable-combobox';
import { SearchableSelect } from './searchable-select';

describe('FormField', () => {
  it('ties the label, hint and error to the control and marks required fields', () => {
    render(
      <FormField label="Name" required hint="As on the ID" error="Name is required">
        {(props) => <input {...props} />}
      </FormField>,
    );
    const input = screen.getByLabelText('Name');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Name is required',
      'As on the ID',
    ]);
  });

  it('adds no required marker or invalid state when there is none', () => {
    render(<FormField label="Notes">{(props) => <input {...props} />}</FormField>);
    const input = screen.getByLabelText('Notes');
    expect(input).not.toHaveAttribute('aria-required');
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('groups related fields under a named fieldset', () => {
    render(
      <FormSection title="Address">
        <FormField label="City">{(props) => <input {...props} />}</FormField>
      </FormSection>,
    );
    expect(screen.getByRole('group', { name: 'Address' })).toContainElement(
      screen.getByLabelText('City'),
    );
  });
});

function Money({ allowNegative = false }: { allowNegative?: boolean }) {
  const [value, setValue] = useState('');
  return (
    <>
      <MoneyInput
        aria-label="Amount"
        value={value}
        onValueChange={setValue}
        allowNegative={allowNegative}
      />
      <output data-testid="out">{value}</output>
    </>
  );
}

describe('MoneyInput', () => {
  it('accepts digits and a point, rejects letters, and pads when the field is left', async () => {
    render(<Money />);
    const box = screen.getByLabelText('Amount');
    await userEvent.type(box, 'a12x.5');
    expect(box).toHaveValue('12.5');
    await userEvent.tab();
    expect(box).toHaveValue('12.50');
    expect(screen.getByTestId('out')).toHaveTextContent('12.50');
  });

  it('stops at two decimals and leaves an empty field empty', async () => {
    render(<Money />);
    const box = screen.getByLabelText('Amount');
    await userEvent.type(box, '1.999');
    expect(box).toHaveValue('1.99');
    await userEvent.clear(box);
    await userEvent.tab();
    expect(box).toHaveValue('');
  });

  it('allows a minus sign only when negatives are allowed', async () => {
    const { unmount } = render(<Money />);
    await userEvent.type(screen.getByLabelText('Amount'), '-4');
    expect(screen.getByLabelText('Amount')).toHaveValue('4');
    unmount();
    render(<Money allowNegative />);
    await userEvent.type(screen.getByLabelText('Amount'), '-4');
    expect(screen.getByLabelText('Amount')).toHaveValue('-4');
  });

  it('uses a numeric keypad on phones without becoming a number input', () => {
    render(<Money />);
    expect(screen.getByLabelText('Amount')).toHaveAttribute('inputmode', 'decimal');
    expect(screen.getByLabelText('Amount')).toHaveAttribute('type', 'text');
  });
});

describe('BarcodeInput', () => {
  it('sends the trimmed code on Enter, clears, and keeps focus for the next scan', async () => {
    const onScan = vi.fn();
    render(<BarcodeInput label="Scan item" onScan={onScan} />);
    const box = screen.getByLabelText('Scan item');
    await userEvent.type(box, '  8901234567890  {Enter}');
    expect(onScan).toHaveBeenCalledExactlyOnceWith('8901234567890');
    expect(box).toHaveValue('');
    expect(box).toHaveFocus();
    await userEvent.type(box, 'ABC-1{Enter}');
    expect(onScan).toHaveBeenLastCalledWith('ABC-1');
  });

  it('ignores an empty scan and works with the Look up button', async () => {
    const onScan = vi.fn();
    render(<BarcodeInput label="Scan item" onScan={onScan} />);
    await userEvent.type(screen.getByLabelText('Scan item'), '{Enter}');
    expect(onScan).not.toHaveBeenCalled();
    await userEvent.type(screen.getByLabelText('Scan item'), '123');
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(onScan).toHaveBeenCalledWith('123');
  });

  it('announces the result, and does not send while a lookup is running', async () => {
    const onScan = vi.fn();
    const { rerender } = render(
      <BarcodeInput
        label="Scan item"
        onScan={onScan}
        feedback={{ tone: 'error', message: 'No item has this barcode.' }}
      />,
    );
    expect(screen.getByText('No item has this barcode.').closest('[aria-live]')).toHaveAttribute(
      'aria-live',
      'polite',
    );
    rerender(<BarcodeInput label="Scan item" onScan={onScan} busy />);
    expect(screen.getByText('Looking up…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Look up' })).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Scan item'), '123{Enter}');
    expect(onScan).not.toHaveBeenCalled();
  });
});

describe('date inputs', () => {
  it('hands back the YYYY-MM-DD text', async () => {
    const onValueChange = vi.fn();
    render(<DatePicker aria-label="Due" value="" onValueChange={onValueChange} />);
    await userEvent.type(screen.getByLabelText('Due'), '2026-10-11');
    expect(onValueChange).toHaveBeenLastCalledWith('2026-10-11');
  });

  it('stops the end date from being before the start date', () => {
    render(
      <DateRangePicker
        legend="Period"
        from="2026-10-01"
        to="2026-10-20"
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole('group', { name: 'Period' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveAttribute('max', '2026-10-20');
    expect(screen.getByLabelText('To')).toHaveAttribute('min', '2026-10-01');
  });
});

const OPTIONS: ComboOption[] = [
  { value: 'a', label: 'Asha Traders', description: '98300 11111' },
  { value: 'b', label: 'Bharat Motors' },
  { value: 'c', label: 'Chandra Parts' },
];

function Combo(props: Partial<React.ComponentProps<typeof SearchableCombobox>>) {
  const [value, setValue] = useState<ComboOption | null>(null);
  return (
    <>
      <SearchableCombobox
        aria-label="Customer"
        value={value}
        onChange={setValue}
        options={OPTIONS}
        {...props}
      />
      <output data-testid="chosen">{value?.label ?? 'none'}</output>
    </>
  );
}

describe('SearchableCombobox', () => {
  it('opens on focus, moves with the arrow keys, chooses with Enter, and keeps focus in the box', async () => {
    render(<Combo />);
    const box = screen.getByRole('combobox', { name: 'Customer' });
    await userEvent.click(box);
    expect(await screen.findAllByRole('option')).toHaveLength(3);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByTestId('chosen')).toHaveTextContent('Chandra Parts');
    expect(box).toHaveValue('Chandra Parts');
    expect(box).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('chooses with the mouse and shows a description line', async () => {
    render(<Combo />);
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('98300 11111')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('option', { name: /Bharat Motors/ }));
    expect(screen.getByTestId('chosen')).toHaveTextContent('Bharat Motors');
  });

  it('sends one search for what was typed, not one per key', async () => {
    const onSearchChange = vi.fn();
    render(<Combo onSearchChange={onSearchChange} debounceMs={30} />);
    await userEvent.type(screen.getByRole('combobox'), 'bha');
    await waitFor(() => expect(onSearchChange).toHaveBeenCalledTimes(1));
    expect(onSearchChange).toHaveBeenCalledWith('bha');
  });

  it('shows loading, empty and error states, and retries', async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <SearchableCombobox
        aria-label="Customer"
        value={null}
        onChange={() => undefined}
        options={[]}
        loading
      />,
    );
    await userEvent.click(screen.getByRole('combobox'));
    expect(await screen.findByText('Searching…')).toBeInTheDocument();
    rerender(
      <SearchableCombobox
        aria-label="Customer"
        value={null}
        onChange={() => undefined}
        options={[]}
        emptyText="No customers"
      />,
    );
    expect(await screen.findByText('No customers')).toBeInTheDocument();
    rerender(
      <SearchableCombobox
        aria-label="Customer"
        value={null}
        onChange={() => undefined}
        options={[]}
        error="Could not search"
        onRetry={onRetry}
      />,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not search');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('clears the choice when asked', async () => {
    render(<Combo clearable />);
    await userEvent.click(screen.getByRole('combobox'));
    await userEvent.click(await screen.findByRole('option', { name: /Asha/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByTestId('chosen')).toHaveTextContent('none');
  });

  it('closes its list on Escape without closing the dialog around it', async () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogTitle>Pick</DialogTitle>
          <Combo />
        </DialogContent>
      </Dialog>,
    );
    await userEvent.click(screen.getByRole('combobox'));
    await screen.findByRole('listbox');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('SearchableSelect', () => {
  it('filters the list in the browser and reports the chosen value', async () => {
    const onValueChange = vi.fn();
    render(
      <SearchableSelect
        aria-label="State"
        options={OPTIONS}
        value=""
        onValueChange={onValueChange}
      />,
    );
    await userEvent.type(screen.getByRole('combobox', { name: 'State' }), 'par');
    const list = await screen.findByRole('listbox');
    expect(within(list).getAllByRole('option')).toHaveLength(1);
    await userEvent.click(within(list).getByRole('option', { name: /Chandra Parts/ }));
    expect(onValueChange).toHaveBeenCalledWith('c');
  });
});

describe('FileUpload', () => {
  it('shows the chosen file and lets it be removed', async () => {
    const onFileChange = vi.fn();
    const file = new File(['x'.repeat(2048)], 'licence.pdf', { type: 'application/pdf' });
    const { rerender } = render(
      <FileUpload
        label="Document"
        file={null}
        onFileChange={onFileChange}
        accept="application/pdf"
      />,
    );
    expect(screen.getByText('No file chosen')).toBeInTheDocument();
    await userEvent.upload(screen.getByLabelText('Document'), file);
    expect(onFileChange).toHaveBeenCalledWith(file);
    rerender(<FileUpload label="Document" file={file} onFileChange={onFileChange} />);
    expect(screen.getByText('licence.pdf')).toBeInTheDocument();
    expect(screen.getByText('2 KB')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove licence.pdf' }));
    expect(onFileChange).toHaveBeenLastCalledWith(null);
  });

  it('tells the person at once when the file is over the limit', () => {
    const file = new File([new Uint8Array(6 * 1024 * 1024)], 'big.jpg', { type: 'image/jpeg' });
    render(
      <FileUpload
        label="Document"
        file={file}
        onFileChange={() => undefined}
        maxBytes={5 * 1024 * 1024}
      />,
    );
    expect(screen.getByText('This file is larger than 5.0 MB.')).toBeInTheDocument();
    expect(screen.getByLabelText('Document')).toHaveAttribute('aria-invalid', 'true');
  });
});
