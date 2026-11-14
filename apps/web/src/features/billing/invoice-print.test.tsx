//apps/web/src/features/billing/invoice-print.test.tsx
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { DocumentCompany } from '@erp/contracts';
import { routeFetch } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { ISSUED, MANAGER, billingHandlers } from './test-data';

const company: DocumentCompany = {
  name: 'Moyna Enterprise',
  proprietor: 'Balaram Das Gajendra Mahapatra',
  address: 'Garsafat (Brishpatibarer Bazar), Moyna, Purba Medinipur, Pin-721629, WB-19',
  phone: '9564245909',
  gstin: '19ANLPD2676F2ZU',
  tagline: null,
  terms: 'Goods once sold will not take back.',
};

const open = async (over: Parameters<typeof ISSUED>[0]) => {
  routeFetch(billingHandlers(MANAGER, [ISSUED(over)]));
  renderApp('/sales');
  await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
  return screen.findByRole('dialog');
};

describe('the printed invoice', () => {
  it('has the heading of the business: the name, the proprietor, the GSTIN, the address and the mobile number', async () => {
    const dialog = await open({
      type: 'GST',
      branchGstin: '19ANLPD2676F2ZU',
      company,
    });
    expect(await within(dialog).findByText('Moyna Enterprise')).toBeInTheDocument();
    expect(within(dialog).getByText('Prop-Balaram Das Gajendra Mahapatra')).toBeInTheDocument();
    expect(within(dialog).getByText('GST IN: 19ANLPD2676F2ZU')).toBeInTheDocument();
    expect(within(dialog).getByText(/Garsafat/)).toBeInTheDocument();
    expect(within(dialog).getByText('Mob-9564245909')).toBeInTheDocument();
    expect(within(dialog).getByText('GST INVOICE')).toBeInTheDocument();
  });

  it('is only on the printed page: the heading and the foot are hidden on screen', async () => {
    const dialog = await open({ company, totalInWords: 'ONE LAKH FIFTY EIGHT THOUSAND ONLY' });
    const name = await within(dialog).findByText('Moyna Enterprise');
    expect(name.parentElement).toHaveClass('hidden', 'print:block');
    const words = within(dialog).getByText(/Total Value \(in Word\)/);
    expect(words.parentElement).toHaveClass('hidden', 'print:block');
  });

  it('has the total in words, the terms and both signatures at the foot', async () => {
    const dialog = await open({ company, totalInWords: 'ONE LAKH FIFTY EIGHT THOUSAND ONLY' });
    expect(
      await within(dialog).findByText('Total Value (in Word)- ONE LAKH FIFTY EIGHT THOUSAND ONLY'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('1. Goods once sold will not take back.')).toBeInTheDocument();
    expect(within(dialog).getByText('Customer Signature')).toBeInTheDocument();
    expect(within(dialog).getByText('For MOYNA ENTERPRISE')).toBeInTheDocument();
  });

  it('calls an invoice without GST just an invoice, with no GSTIN', async () => {
    const dialog = await open({
      type: 'NON_GST',
      branchGstin: null,
      company: { ...company, gstin: null },
    });
    await within(dialog).findByText('Moyna Enterprise');
    expect(within(dialog).queryByText(/GST IN:/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText('GST INVOICE')).not.toBeInTheDocument();
  });

  it('shows the buyer’s mobile number and address', async () => {
    const dialog = await open({
      customerPhone: '9937117681',
      customerAddress: 'MURAIL, MURAIL PURBA MEDINIPUR,721634',
    });
    expect(await within(dialog).findByText('9937117681')).toBeInTheDocument();
    expect(within(dialog).getByText('MURAIL, MURAIL PURBA MEDINIPUR,721634')).toBeInTheDocument();
  });

  it('prints no heading when the business details did not come with the invoice', async () => {
    const dialog = await open({ company: null });
    await within(dialog).findByText('Customer');
    expect(within(dialog).queryByText('Customer Signature')).not.toBeInTheDocument();
  });
});
