import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NAV_ITEMS } from '@/app/navigation';
import { NavSearchInput, NavSearchList, useNavSearch } from './nav-search';

function Harness({ onSelect = () => undefined }: { onSelect?: (path: string) => void }) {
  const [query, setQuery] = useState('');
  const search = useNavSearch(
    NAV_ITEMS,
    query,
    (item) => onSelect(item.path),
    () => setQuery(''),
  );
  const expanded = query.trim() !== '';
  return (
    <>
      <NavSearchInput
        label="Search menu"
        placeholder="Search"
        value={query}
        onChange={setQuery}
        search={search}
        expanded={expanded}
      />
      {expanded ? (
        <NavSearchList
          search={search}
          favourites={[]}
          onSelect={(item) => onSelect(item.path)}
          emptyText="No screen matches."
        />
      ) : null}
    </>
  );
}

describe('menu search', () => {
  it('only points at its results list while that list exists', async () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Search menu' });
    // A reference to a missing element is an accessibility error, so the closed box has none.
    expect(box).not.toHaveAttribute('aria-controls');
    expect(box).toHaveAttribute('aria-expanded', 'false');

    await userEvent.type(box, 'inventory');
    const list = screen.getByRole('listbox', { name: 'Matching screens' });
    expect(box).toHaveAttribute('aria-expanded', 'true');
    expect(box.getAttribute('aria-controls')).toBe(list.id);
  });

  it('keeps focus in the box while arrow keys move, and Enter opens the highlighted screen', async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const box = screen.getByRole('combobox', { name: 'Search menu' });
    await userEvent.type(box, 'a');
    await userEvent.keyboard('{ArrowDown}');
    expect(box).toHaveFocus();
    const active = box.getAttribute('aria-activedescendant');
    expect(active).toBeTruthy();
    expect(document.getElementById(active ?? '')).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('clears the text on Escape', async () => {
    render(<Harness />);
    const box = screen.getByRole('combobox', { name: 'Search menu' });
    await userEvent.type(box, 'sales');
    await userEvent.keyboard('{Escape}');
    expect(box).toHaveValue('');
  });
});
