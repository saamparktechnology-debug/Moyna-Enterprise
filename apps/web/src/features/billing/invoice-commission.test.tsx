//apps/web/src/features/billing/invoice-commission.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrokerSummary, Invoice } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { ISSUED, MANAGER, billingHandlers, makeInvoice, pageOf } from './test-data';

const BROKER_ID = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const PERMISSIONS = [...MANAGER, 'brokers.view'];

const broker: BrokerSummary = {
  id: BROKER_ID,
  name: 'Ravi Broker',
  phone: '9000000001',
  address: null,
  hasPhoto: false,
  isActive: true,
  activeRule: null,
  payable: '0.00',
  toRecover: '0.00',
  createdAt: '2026-10-01T05:00:00.000Z',
};

const gift = (over: object = {}): Invoice['commission'] => ({
  type: 'GIFT',
  amount: '800.00',
  giftName: 'Mixer grinder',
  hasPhoto: false,
  photoFileName: null,
  ...over,
});
const draftWith = (commission: Invoice['commission'], over: Partial<Invoice> = {}): Invoice =>
  makeInvoice({ brokerId: BROKER_ID, brokerName: 'Ravi Broker', commission, ...over });

const open = (invoices: Invoice[], extra: Record<string, RouteHandler> = {}) => {
  const state = routeFetch({
    ...billingHandlers(PERMISSIONS, invoices),
    'GET /api/brokers?*': () => jsonResponse(pageOf([broker])),
    ...extra,
  });
  renderApp('/sales');
  return state;
};
const editDraft = async () => {
  await userEvent.click(await screen.findByRole('button', { name: 'Open draft for Ravi Kumar' }));
  await userEvent.click(await screen.findByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Edit draft invoice' });
};
const patched = (calls: { key: string; body: unknown }[]) =>
  calls.find((call) => call.key === 'PATCH /api/invoices/inv-1')?.body as Record<string, unknown>;
const save = (invoice: Invoice) => ({
  'PATCH /api/invoices/inv-1': () => jsonResponse(invoice),
});

describe('the commission agreed on an invoice, in the form', () => {
  it('shows what was agreed on a draft', async () => {
    open([draftWith(gift())]);
    const dialog = await editDraft();
    expect(within(dialog).getByLabelText('Commission')).toHaveValue('GIFT');
    expect(within(dialog).getByLabelText('Value of the gift')).toHaveValue('800.00');
    expect(within(dialog).getByLabelText('Gift')).toHaveValue('Mixer grinder');
  });

  it('sends a fixed amount, with no gift', async () => {
    const state = open([draftWith(gift())], save(draftWith(null)));
    const dialog = await editDraft();
    await userEvent.selectOptions(within(dialog).getByLabelText('Commission'), 'FIXED');
    expect(within(dialog).queryByLabelText('Gift')).not.toBeInTheDocument();
    const amount = within(dialog).getByLabelText('Amount');
    await userEvent.clear(amount);
    await userEvent.type(amount, '150');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Draft saved')).toBeInTheDocument();
    expect(patched(state.calls)).toMatchObject({
      brokerId: BROKER_ID,
      commission: { type: 'FIXED', amount: '150' },
    });
    expect(
      (patched(state.calls)['commission'] as Record<string, unknown>)['giftName'],
    ).toBeUndefined();
  });

  it('sends a gift with its name and value', async () => {
    const state = open([draftWith(null)], save(draftWith(gift())));
    const dialog = await editDraft();
    await userEvent.selectOptions(within(dialog).getByLabelText('Commission'), 'GIFT');
    await userEvent.type(within(dialog).getByLabelText('Value of the gift'), '800');
    await userEvent.type(within(dialog).getByLabelText('Gift'), ' Mixer grinder ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Draft saved');
    expect(patched(state.calls)).toMatchObject({
      commission: { type: 'GIFT', amount: '800', giftName: 'Mixer grinder' },
    });
  });

  it('sends "no commission" when that is chosen', async () => {
    const state = open(
      [draftWith(gift())],
      save(
        draftWith({
          type: 'NONE',
          amount: null,
          giftName: null,
          hasPhoto: false,
          photoFileName: null,
        }),
      ),
    );
    const dialog = await editDraft();
    await userEvent.selectOptions(within(dialog).getByLabelText('Commission'), 'NONE');
    expect(within(dialog).queryByLabelText('Value of the gift')).not.toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Draft saved');
    expect(patched(state.calls)).toMatchObject({ commission: { type: 'NONE' } });
  });

  it('asks for the amount, and for the name of a gift, and sends nothing until they are there', async () => {
    const state = open([
      draftWith({
        type: 'NONE',
        amount: null,
        giftName: null,
        hasPhoto: false,
        photoFileName: null,
      }),
    ]);
    const dialog = await editDraft();
    await userEvent.selectOptions(within(dialog).getByLabelText('Commission'), 'GIFT');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText('Enter the value of the gift')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter the name of the gift')).toBeInTheDocument();
    expect(state.calls.some((call) => call.key === 'PATCH /api/invoices/inv-1')).toBe(false);
  });

  it('keeps an older draft on the broker’s standing rule until something is chosen', async () => {
    const state = open([draftWith(null)], save(draftWith(null)));
    const dialog = await editDraft();
    const select = within(dialog).getByLabelText('Commission');
    expect(select).toHaveValue('');
    expect(
      within(dialog).getByRole('option', { name: 'The broker’s standing rule' }),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await screen.findByText('Draft saved');
    expect(patched(state.calls)).not.toHaveProperty('commission');
  });

  it('shows no commission fields on an invoice without a broker', async () => {
    open([makeInvoice()]);
    const dialog = await editDraft();
    expect(within(dialog).queryByLabelText('Commission')).not.toBeInTheDocument();
  });

  it('lists a broker who has no standing rule', async () => {
    open([makeInvoice()]);
    const dialog = await editDraft();
    expect(within(dialog).getByRole('option', { name: 'Ravi Broker' })).toBeInTheDocument();
  });
});

describe('the commission agreed on an invoice, in the invoice', () => {
  const create = vi.fn(() => 'blob:gift');
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create, revokeObjectURL: vi.fn() }));
  });
  afterEach(() => vi.restoreAllMocks());

  it('shows what was agreed, and keeps it off the printed page', async () => {
    open([
      ISSUED({
        brokerId: BROKER_ID,
        brokerName: 'Ravi Broker',
        commission: {
          type: 'FIXED',
          amount: '150.00',
          giftName: null,
          hasPhoto: false,
          photoFileName: null,
        },
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    const dialog = await screen.findByRole('dialog');
    const label = await within(dialog).findByText('Commission agreed');
    expect(label).toHaveClass('print:hidden');
    expect(within(dialog).getByText('150.00 fixed')).toHaveClass('print:hidden');
  });

  it('shows nothing about commission when none was agreed', async () => {
    open([
      ISSUED({
        brokerId: BROKER_ID,
        brokerName: 'Ravi Broker',
        commission: {
          type: 'NONE',
          amount: null,
          giftName: null,
          hasPhoto: false,
          photoFileName: null,
        },
      }),
    ]);
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Ravi Broker');
    expect(within(dialog).queryByText('Commission agreed')).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: 'Gift photo' })).not.toBeInTheDocument();
  });

  it('lets a draft with a gift have its photo added', async () => {
    const state = open([draftWith(gift())], {
      'POST /api/invoices/inv-1/gift-photo?*': () =>
        jsonResponse(
          draftWith(gift({ hasPhoto: true, photoFileName: 'mixer.png' }), { rowVersion: 5 }),
          201,
        ),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Open draft for Ravi Kumar' }));
    const panel = await screen.findByRole('region', { name: 'Gift photo' });
    await userEvent.upload(
      within(panel).getByLabelText('Add gift photo'),
      new File(['x'], 'mixer.png', { type: 'image/png' }),
    );
    await waitFor(() =>
      expect(
        state.calls.some((call) =>
          call.key.startsWith('POST /api/invoices/inv-1/gift-photo?fileName=mixer.png'),
        ),
      ).toBe(true),
    );
  });

  it('refuses a gift photo over 5 MB without sending it', async () => {
    const state = open([draftWith(gift())]);
    await userEvent.click(await screen.findByRole('button', { name: 'Open draft for Ravi Kumar' }));
    const panel = await screen.findByRole('region', { name: 'Gift photo' });
    await userEvent.upload(
      within(panel).getByLabelText('Add gift photo'),
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' }),
    );
    expect(await within(panel).findByText('The file is larger than 5 MB')).toBeInTheDocument();
    expect(
      state.calls.some((call) => call.key.startsWith('POST /api/invoices/inv-1/gift-photo')),
    ).toBe(false);
  });

  it('shows the photo of an issued invoice, and lets nobody change it', async () => {
    open(
      [
        ISSUED({
          brokerId: BROKER_ID,
          brokerName: 'Ravi Broker',
          commission: gift({ hasPhoto: true, photoFileName: 'mixer.png' }),
        }),
      ],
      {
        'GET /api/invoices/inv-1/gift-photo': () =>
          new Response('png-bytes', { status: 200, headers: { 'content-type': 'image/png' } }),
      },
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    const panel = await screen.findByRole('region', { name: 'Gift photo' });
    expect(await within(panel).findByRole('img', { name: 'Gift: Mixer grinder' })).toHaveAttribute(
      'src',
      'blob:gift',
    );
    expect(within(panel).queryByLabelText('Replace gift photo')).not.toBeInTheDocument();
    expect(
      within(panel).queryByRole('button', { name: 'Remove gift photo' }),
    ).not.toBeInTheDocument();
  });
});
