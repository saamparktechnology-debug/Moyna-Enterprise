import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { SectionPanel, SectionTabs } from './section-tabs';

const TABS = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two' },
  { id: 'three', label: 'Three' },
] as const;

function Harness() {
  const [value, setValue] = useState<(typeof TABS)[number]['id']>('one');
  return (
    <>
      <SectionTabs label="Test sections" tabs={TABS} value={value} onChange={setValue} />
      <SectionPanel id={value}>Content of {value}</SectionPanel>
    </>
  );
}

describe('SectionTabs', () => {
  it('names the list, marks the selected tab and links it to its panel', () => {
    render(<Harness />);
    expect(screen.getByRole('tablist', { name: 'Test sections' })).toBeInTheDocument();
    const one = screen.getByRole('tab', { name: 'One' });
    expect(one).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: 'One' })).toHaveTextContent('Content of one');
    expect(one.getAttribute('aria-controls')).toBe(screen.getByRole('tabpanel').id);
  });

  it('has a single tab stop and changes tab on click', async () => {
    render(<Harness />);
    expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('tabindex', '-1');
    await userEvent.click(screen.getByRole('tab', { name: 'Two' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Content of two');
  });

  it('moves with the arrow keys, wrapping at the ends, and jumps with Home and End', async () => {
    render(<Harness />);
    screen.getByRole('tab', { name: 'One' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveFocus();
    expect(screen.getByRole('tab', { name: 'Two' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{End}');
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
    await userEvent.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: 'One' })).toHaveFocus();
  });
});
