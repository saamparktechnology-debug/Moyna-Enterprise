import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SimpleTable } from './simple-table';

interface Line {
  id: string;
  name: string;
  qty: number;
}
const ROWS: Line[] = [
  { id: 'a', name: 'Battery', qty: 2 },
  { id: 'b', name: 'Tyre', qty: 4 },
];
const COLUMNS = [
  { header: 'Item', cell: (row: Line) => row.name },
  { header: 'Qty', cell: (row: Line) => row.qty, align: 'right' as const },
];

describe('SimpleTable', () => {
  it('is a named table with column headers and one row per line', () => {
    render(<SimpleTable label="Lines" columns={COLUMNS} rows={ROWS} getRowKey={(row) => row.id} />);
    const table = screen.getByRole('table', { name: 'Lines' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((h) => h.textContent),
    ).toEqual(['Item', 'Qty']);
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByRole('cell', { name: 'Tyre' })).toBeInTheDocument();
  });

  it('can be scrolled with the keyboard on a narrow screen', () => {
    render(<SimpleTable label="Lines" columns={COLUMNS} rows={ROWS} getRowKey={(row) => row.id} />);
    expect(screen.getByRole('region', { name: 'Lines, scrollable' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });

  it('contains its own screen-reader-only text, so it cannot widen the page', () => {
    render(<SimpleTable label="Lines" columns={COLUMNS} rows={ROWS} getRowKey={(row) => row.id} />);
    // Absolutely positioned hidden text escapes an overflow box unless the box is a positioning context.
    expect(screen.getByRole('region', { name: 'Lines, scrollable' })).toHaveClass('relative');
  });

  it('says so instead of drawing an empty table', () => {
    render(
      <SimpleTable
        label="Lines"
        columns={COLUMNS}
        rows={[]}
        getRowKey={(row: Line) => row.id}
        emptyText="No lines yet."
      />,
    );
    expect(screen.getByText('No lines yet.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('marks chosen rows', () => {
    render(
      <SimpleTable
        label="Lines"
        columns={COLUMNS}
        rows={ROWS}
        getRowKey={(row) => row.id}
        rowClassName={(row) => (row.qty > 3 ? 'font-semibold' : undefined)}
      />,
    );
    expect(screen.getByRole('row', { name: /Tyre/ })).toHaveClass('font-semibold');
    expect(screen.getByRole('row', { name: /Battery/ })).not.toHaveClass('font-semibold');
  });
});
