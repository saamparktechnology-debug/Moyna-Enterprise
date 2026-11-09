//apps/web/src/features/billing/profit.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { routeFetch } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { ISSUED, MANAGER, billingHandlers, makeInvoice } from './test-data';

describe('profit in the sale history', () => {
  it('shows the profit of each issued invoice in the list, and a dash where there is none', async () => {
    routeFetch(
      billingHandlers(MANAGER, [
        ISSUED({ id: 'inv-1', profit: '1400.00' }),
        ISSUED({ id: 'inv-2', invoiceNo: 'HQ/GI/26-27/00002', profit: null }),
        makeInvoice({ id: 'inv-3' }),
      ]),
    );
    renderApp('/sales');
    const table = await screen.findByRole('table', { name: 'Invoices' });
    expect(within(table).getByRole('columnheader', { name: 'Profit' })).toBeInTheDocument();
    const rows = await waitFor(() => {
      const found = within(table).getAllByRole('row').slice(1);
      expect(found).toHaveLength(3);
      return found;
    });
    expect(rows[0]).toHaveTextContent('1400.00');
    expect(rows[1]).toHaveTextContent('—');
    expect(rows[2]).toHaveTextContent('—');
  });

  it('shows the profit in an invoice, and keeps it off the printed page', async () => {
    routeFetch(billingHandlers(MANAGER, [ISSUED({ profit: '1200.00' })]));
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    const dialog = await screen.findByRole('dialog');
    const totals = await within(dialog).findByLabelText('Invoice totals');
    expect(totals).toHaveTextContent('Profit1200.00');
    expect(within(totals).getByText('Profit')).toHaveClass('print:hidden');
    expect(within(totals).getByText('1200.00')).toHaveClass('print:hidden');
  });

  it('shows no profit line when none can be worked out', async () => {
    routeFetch(billingHandlers(MANAGER, [ISSUED({ profit: null })]));
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    const dialog = await screen.findByRole('dialog');
    const totals = await within(dialog).findByLabelText('Invoice totals');
    expect(within(totals).queryByText('Profit')).not.toBeInTheDocument();
  });
});
