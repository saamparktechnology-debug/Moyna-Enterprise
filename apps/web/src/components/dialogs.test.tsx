import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';
import { DetailsDrawer } from './details-drawer';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { FormDialog } from './form-dialog';
import { LoadingState } from './loading-state';
import { StatusBadge, toneOf } from './status-badge';
import { Toaster, toast } from './toast';

function Harness({
  onSubmit = () => undefined,
  saving = false,
  error,
  startDirty = false,
  startOpen = true,
}: {
  onSubmit?: () => void | Promise<void>;
  saving?: boolean;
  error?: string;
  startDirty?: boolean;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen);
  const [name, setName] = useState('');
  const dirty = startDirty || name !== '';
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open form
      </button>
      <FormDialog
        open={open}
        title="Edit branch"
        description="Change the details."
        onClose={() => setOpen(false)}
        onSubmit={onSubmit}
        saving={saving}
        dirty={dirty}
        submitLabel="Save changes"
        savingLabel="Saving…"
        {...(error ? { error } : {})}
      >
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={error ? true : undefined}
          />
        </label>
      </FormDialog>
    </>
  );
}

describe('FormDialog', () => {
  it('has a title, a description and explicit Cancel and Save buttons', () => {
    render(<Harness />);
    const dialog = screen.getByRole('dialog', { name: 'Edit branch' });
    expect(dialog).toHaveAccessibleDescription('Change the details.');
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
  });

  it('can be read-only: no Save button, and the way out is called Close', async () => {
    const onClose = vi.fn();
    render(
      <FormDialog
        open
        readOnly
        title="Role Staff"
        onClose={onClose}
        onSubmit={() => undefined}
        submitLabel="Save changes"
      >
        <p>Permissions</p>
      </FormDialog>,
    );
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes straight away when nothing was changed', async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('asks before discarding changes: keep editing returns to the form with the text intact', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Name'), 'Kolkata');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByRole('alertdialog', { name: 'Discard your changes?' }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveValue('Kolkata');
  });

  it('discards when the person confirms', async () => {
    render(<Harness />);
    await userEvent.type(screen.getByLabelText('Name'), 'x');
    await userEvent.keyboard('{Escape}');
    await userEvent.click(await screen.findByRole('button', { name: 'Discard changes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('does not close on an outside click while there are unsaved changes', async () => {
    render(<Harness startDirty />);
    const overlay = document.querySelector('[data-state="open"].fixed.inset-0');
    expect(overlay).not.toBeNull();
    await userEvent.click(overlay as Element);
    expect(screen.getByRole('dialog', { name: 'Edit branch' })).toBeInTheDocument();
  });

  it('cannot be closed or submitted again while saving', async () => {
    const onSubmit = vi.fn();
    render(<Harness saving onSubmit={onSubmit} />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await userEvent.keyboard('{Control>}s{/Control}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves with Ctrl+S, once', async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.click(screen.getByLabelText('Name'));
    await userEvent.keyboard('{Control>}s{/Control}');
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('shows a failed save above the fields and moves focus to the invalid one', async () => {
    render(<Harness error="Name is already used" />);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Name is already used');
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus());
  });

  it('returns focus to the button that opened it', async () => {
    render(<Harness startOpen={false} />);
    const opener = screen.getByRole('button', { name: 'Open form' });
    await userEvent.click(opener);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(opener).toHaveFocus());
  });
});

describe('ConfirmDialog', () => {
  it('states the consequence and confirms', async () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Deactivate branch KOL?"
        description="People assigned here lose access straight away."
        confirmLabel="Deactivate"
        tone="destructive"
        onConfirm={onConfirm}
        onClose={() => undefined}
      />,
    );
    expect(
      screen.getByRole('dialog', { name: 'Deactivate branch KOL?' }),
    ).toHaveAccessibleDescription('People assigned here lose access straight away.');
    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('shows the server’s reasons and cannot be dismissed while working', async () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <ConfirmDialog
        open
        title="Cancel invoice?"
        description="Stock returns."
        confirmLabel="Cancel invoice"
        problem={{ message: 'Cannot cancel', reasons: ['It has a payment'] }}
        onConfirm={() => undefined}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Cannot cancel');
    expect(screen.getByText('It has a payment')).toBeInTheDocument();
    rerender(
      <ConfirmDialog
        open
        title="Cancel invoice?"
        description="Stock returns."
        confirmLabel="Cancel invoice"
        pending
        onConfirm={() => undefined}
        onClose={onClose}
      />,
    );
    expect(screen.getByRole('button', { name: 'Working…' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Cancel', async () => {
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Sure?"
        description="d"
        confirmLabel="Yes"
        onConfirm={() => undefined}
        onClose={onClose}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe('DetailsDrawer', () => {
  it('shows the record, has a named close button, and closes with Escape', async () => {
    const onClose = vi.fn();
    render(
      <DetailsDrawer
        open
        onClose={onClose}
        title="Invoice G/0001"
        description="Issued today"
        footer={<button type="button">Print</button>}
      >
        <p>Line items</p>
      </DetailsDrawer>,
    );
    expect(screen.getByRole('dialog', { name: 'Invoice G/0001' })).toBeInTheDocument();
    expect(screen.getByText('Line items')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Print' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Close details' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe('status badge', () => {
  it('uses the application’s own status values, whatever their case or punctuation', () => {
    expect(toneOf('PAID')).toBe('success');
    expect(toneOf('partial')).toBe('warning');
    expect(toneOf('IN_TRANSIT')).toBe('info');
    expect(toneOf('low stock')).toBe('warning');
    expect(toneOf('OVERDUE')).toBe('destructive');
    expect(toneOf('CANCELLED')).toBe('neutral');
    expect(toneOf('something new')).toBe('neutral');
  });

  it('always shows words, not just a colour', () => {
    render(
      <>
        <StatusBadge status="PARTLY_RECEIVED" />
        <StatusBadge status="ACTIVE" label="Open" />
      </>,
    );
    expect(screen.getByText('Partly received')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });
});

describe('states', () => {
  it('announces loading with placeholder rows', () => {
    render(<LoadingState label="Loading branches…" rows={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading branches…');
  });

  it('offers a way out of an error and of an empty list', async () => {
    const onRetry = vi.fn();
    render(
      <>
        <ErrorState onRetry={onRetry}>Could not load the branches.</ErrorState>
        <EmptyState title="No branches" action={<button type="button">Clear filters</button>}>
          Try a different search.
        </EmptyState>
      </>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the branches.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalled();
    expect(screen.getByText('No branches')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });
});

describe('toasts', () => {
  afterEach(() => {
    vi.useRealTimers();
    act(() => toast.clear());
  });

  it('shows a message in a polite live region and removes it after a while', () => {
    vi.useFakeTimers();
    render(<Toaster />);
    act(() => void toast.success('Branch saved'));
    expect(screen.getByRole('status')).toHaveTextContent('Branch saved');
    act(() => vi.advanceTimersByTime(7000));
    expect(screen.queryByText('Branch saved')).not.toBeInTheDocument();
  });

  it('keeps an error until it is dismissed', async () => {
    render(<Toaster />);
    act(() => void toast.error('Could not save'));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not save');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss message' }));
    expect(screen.queryByText('Could not save')).not.toBeInTheDocument();
  });
});
