import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { FormActions } from './form-actions';
import { FormSection } from './form-section';
import { LoadingState } from './loading-state';
import { PageHeader } from './page-header';
import { StatusBadge, toneOf } from './status-badge';
import { Toaster, toast } from './toast';

describe('StatusBadge', () => {
  it('shows words, not only a colour, and an icon the screen reader skips', () => {
    const { container } = render(<StatusBadge status="PARTIAL" />);
    expect(screen.getByText('Partial')).toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the screen’s own wording when it has one', () => {
    render(<StatusBadge status="ACTIVE" label="Switched on" />);
    expect(screen.getByText('Switched on')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('gives every known status a tone and unknown ones the neutral tone', () => {
    expect(toneOf('PAID')).toBe('success');
    expect(toneOf('overdue')).toBe('destructive');
    expect(toneOf('in-transit')).toBe('info');
    expect(toneOf('Low stock')).toBe('warning');
    expect(toneOf('something new')).toBe('neutral');
  });

  it('lets a screen override the tone', () => {
    const { container } = render(<StatusBadge status="ACTIVE" tone="info" />);
    expect(container.firstElementChild).toHaveClass('text-info');
  });
});

describe('EmptyState, ErrorState and LoadingState', () => {
  it('explains what is empty and offers the way out', () => {
    render(
      <EmptyState action={<button type="button">Clear filters</button>}>
        No items match.
      </EmptyState>,
    );
    expect(screen.getByText('No items match.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('announces an error as an alert and retries on request', async () => {
    const retry = vi.fn();
    render(<ErrorState onRetry={retry}>Could not load.</ErrorState>);
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('can word the retry button differently, and omits it with no handler', () => {
    const { rerender } = render(
      <ErrorState onRetry={() => undefined} retryLabel="Try again">
        Failed.
      </ErrorState>,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    rerender(<ErrorState>Failed.</ErrorState>);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('announces loading once, politely, with placeholder rows', () => {
    const { container } = render(<LoadingState label="Loading branches…" rows={3} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading branches…');
    expect(container.firstElementChild?.children).toHaveLength(4);
  });
});

describe('PageHeader', () => {
  it('has one level-one heading, a description and the actions', () => {
    render(
      <PageHeader
        title="Items"
        description="Products and parts."
        actions={<button type="button">New item</button>}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Items' })).toBeInTheDocument();
    expect(screen.getByText('Products and parts.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New item' })).toBeInTheDocument();
  });

  it('draws no empty description or actions area', () => {
    const { container } = render(<PageHeader title="Items" />);
    expect(container.querySelector('p')).toBeNull();
    expect(container.firstElementChild?.children).toHaveLength(1);
  });
});

describe('toasts', () => {
  it('shows a message in the Messages region and lets the person dismiss it', async () => {
    render(<Toaster />);
    act(() => void toast.success('Saved the branch'));
    const region = screen.getByRole('region', { name: 'Messages' });
    expect(within(region).getByText('Saved the branch')).toBeInTheDocument();
    await userEvent.click(within(region).getByRole('button', { name: 'Dismiss message' }));
    expect(within(region).queryByText('Saved the branch')).not.toBeInTheDocument();
  });

  it('keeps only the latest four', () => {
    render(<Toaster />);
    act(() => {
      for (let i = 1; i <= 6; i++) toast.info(`Message ${i}`);
    });
    expect(screen.queryByText('Message 2')).not.toBeInTheDocument();
    expect(screen.getByText('Message 3')).toBeInTheDocument();
    expect(screen.getByText('Message 6')).toBeInTheDocument();
  });

  it('dismisses success messages by itself but keeps errors until dismissed', () => {
    vi.useFakeTimers();
    try {
      render(<Toaster />);
      act(() => {
        toast.success('Done');
        toast.error('Failed to save');
      });
      act(() => void vi.advanceTimersByTime(7000));
      expect(screen.queryByText('Done')).not.toBeInTheDocument();
      expect(screen.getByText('Failed to save')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('FormSection and FormActions', () => {
  it('groups fields under a named fieldset', () => {
    render(
      <FormSection title="Delivery details">
        <input aria-label="Note" />
      </FormSection>,
    );
    const group = screen.getByRole('group', { name: 'Delivery details' });
    expect(within(group).getByLabelText('Note')).toBeInTheDocument();
  });

  it('puts Cancel and Save in the same order every time and stops double sending', async () => {
    const cancel = vi.fn();
    const { rerender } = render(<FormActions onCancel={cancel} submitLabel="Save branch" />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Save branch']);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel).toHaveBeenCalledTimes(1);

    rerender(<FormActions onCancel={cancel} saving submitLabel="Save branch" />);
    expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  });
});
