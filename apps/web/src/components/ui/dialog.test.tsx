import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';

function renderDialog(props: { size?: 'sm' | 'md' | 'lg' | 'xl'; className?: string }) {
  render(
    <Dialog open>
      <DialogContent {...props}>
        <DialogTitle>Title</DialogTitle>
        <DialogDescription>Description</DialogDescription>
      </DialogContent>
    </Dialog>,
  );
  return screen.getByRole('dialog');
}

describe('DialogContent width', () => {
  it('is small by default', () => {
    expect(renderDialog({})).toHaveClass('sm:max-w-md');
  });

  it('follows the size prop', () => {
    expect(renderDialog({ size: 'xl' })).toHaveClass('sm:max-w-5xl');
  });

  it('keeps a width the dialog sets itself instead of adding the default', () => {
    const dialog = renderDialog({ className: 'max-w-4xl' });
    expect(dialog).toHaveClass('max-w-4xl');
    expect(dialog).not.toHaveClass('sm:max-w-md');
  });

  it('fits a phone screen and scrolls inside itself', () => {
    const dialog = renderDialog({});
    expect(dialog).toHaveClass('w-[calc(100vw-1rem)]');
    expect(dialog).toHaveClass('overflow-y-auto');
  });
});
