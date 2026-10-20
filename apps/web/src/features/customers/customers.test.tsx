import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { MANAGER, STAFF, VIEWER, customerHandlers, makeCustomer, pageOf } from './test-data';

const open = (handlers: Record<string, RouteHandler> = customerHandlers()) => {
  const state = routeFetch(handlers);
  const view = renderApp('/customers');
  return { ...state, ...view };
};
const listCalls = (calls: { key: string }[]) =>
  calls.filter((call) => call.key.startsWith('GET /api/customers?'));
const bodyOf = (calls: { key: string; body: unknown }[], key: string) =>
  calls.find((call) => call.key === key)?.body as Record<string, unknown>;
const failure = () =>
  jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500);
const conflict = (message: string, details: { field: string; message: string }[] = []) =>
  jsonResponse({ code: 'CONFLICT', message, details, requestId: 'r' }, 409);

describe('the customer list', () => {
  it('shows each customer with phone, state, GSTIN and KYC in words', async () => {
    open(
      customerHandlers(MANAGER, [
        makeCustomer({ kycStatus: 'VERIFIED' }),
        makeCustomer({
          id: 'c-2',
          name: 'Meera Das',
          phone: '9123456780',
          stateName: null,
          gstin: null,
          kycStatus: 'PENDING',
        }),
        makeCustomer({ id: 'c-3', name: 'Joy Roy', phone: '9000000003', kycStatus: 'REJECTED' }),
      ]),
    );
    const rows = within(await screen.findByRole('table', { name: 'Customers' }))
      .getAllByRole('row')
      .slice(1);
    expect(rows[0]).toHaveTextContent('Rahul Menon');
    expect(rows[0]).toHaveTextContent('9876543210');
    expect(rows[0]).toHaveTextContent('Maharashtra');
    expect(rows[0]).toHaveTextContent('27AAPFU0939F1ZV');
    expect(rows[0]).toHaveTextContent('Verified');
    expect(rows[1]).toHaveTextContent('Waiting for review');
    expect(rows[1]).toHaveTextContent('—');
    expect(rows[2]).toHaveTextContent('Rejected');
  });

  it('shows a loading message while the customers are fetched', async () => {
    open({
      ...customerHandlers(),
      'GET /api/customers?*': () => new Promise<Response>(() => undefined),
    });
    expect(await screen.findByText('Loading customers…')).toBeInTheDocument();
  });

  it('explains an empty list', async () => {
    open({
      ...customerHandlers(MANAGER, []),
      'GET /api/customers?*': () => jsonResponse(pageOf([])),
    });
    expect(await screen.findByText('There are no customers yet.')).toBeInTheDocument();
  });

  it('shows an error and recovers when Retry is pressed', async () => {
    let fail = true;
    open({
      ...customerHandlers(),
      'GET /api/customers?*': () => (fail ? failure() : jsonResponse(pageOf([makeCustomer()]))),
    });
    expect(await screen.findByText('Could not load the customers.')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Rahul Menon')).toBeInTheDocument();
  });

  it('asks the server for the search and KYC status the user chose, and for the next page', async () => {
    const { calls } = open({
      ...customerHandlers(),
      'GET /api/customers?*': () =>
        jsonResponse(pageOf([makeCustomer()], { total: 25, totalPages: 3 })),
    });
    await screen.findByText('Rahul Menon');
    await userEvent.type(screen.getByLabelText('Search'), 'ravi');
    await waitFor(() =>
      expect(listCalls(calls).some((call) => call.key.includes('search=ravi'))).toBe(true),
    );
    await userEvent.selectOptions(screen.getByLabelText('KYC'), 'PENDING');
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('kycStatus=PENDING'));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(listCalls(calls).at(-1)?.key).toContain('page=2'));
  });
});

describe('who sees what', () => {
  it('lets people who manage customers create and edit', async () => {
    open(customerHandlers(STAFF));
    await screen.findByRole('table', { name: 'Customers' });
    expect(screen.getByRole('button', { name: 'New customer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Rahul Menon' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'KYC documents of Rahul Menon' }),
    ).toBeInTheDocument();
  });

  it('shows read-only users the list only', async () => {
    open(customerHandlers(VIEWER));
    await screen.findByRole('table', { name: 'Customers' });
    expect(screen.queryByRole('button', { name: 'New customer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Rahul Menon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /KYC documents of/ })).not.toBeInTheDocument();
  });

  it('keeps people without customers.view away', async () => {
    open(customerHandlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });
});

describe('creating and editing a customer', () => {
  const openNew = async (extra: Record<string, RouteHandler> = {}) => {
    const state = open({ ...customerHandlers(), ...extra });
    await userEvent.click(await screen.findByRole('button', { name: 'New customer' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: '27 · Maharashtra' });
    return { ...state, dialog };
  };

  it('names every field that is wrong and sends nothing', async () => {
    const { dialog, calls } = await openNew();
    await userEvent.type(within(dialog).getByLabelText('Phone'), '12345');
    await userEvent.type(within(dialog).getByLabelText('Email'), 'nope');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), 'BAD');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create customer' }));
    await waitFor(() =>
      expect(within(dialog).getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true'),
    );
    for (const label of ['Phone', 'Email', 'GSTIN'])
      expect(within(dialog).getByLabelText(label)).toHaveAttribute('aria-invalid', 'true');
    expect(calls.some((call) => call.key === 'POST /api/customers')).toBe(false);
  });

  it('refuses a GSTIN that belongs to another state', async () => {
    const { dialog } = await openNew();
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Mismatch');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9000000011');
    await userEvent.selectOptions(within(dialog).getByLabelText('State'), '29');
    await userEvent.type(within(dialog).getByLabelText('GSTIN'), '27AAPFU0939F1ZV');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create customer' }));
    expect(
      await within(dialog).findByText(/must start with the state code 29/),
    ).toBeInTheDocument();
  });

  it('creates the customer, sending empty optional fields as nothing', async () => {
    const { dialog, calls } = await openNew({
      'POST /api/customers': () => jsonResponse(makeCustomer({ name: 'New Person' }), 201),
    });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'New Person');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9000000012');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create customer' }));
    expect(await screen.findByText('Customer New Person created')).toBeInTheDocument();
    expect(bodyOf(calls, 'POST /api/customers')).toEqual({
      name: 'New Person',
      phone: '9000000012',
      email: null,
      address: null,
      stateCode: null,
      gstin: null,
    });
  });

  it('puts a duplicate phone message next to the field and keeps what was typed', async () => {
    const { dialog } = await openNew({
      'POST /api/customers': () =>
        conflict('A customer with this phone number already exists', [
          { field: 'phone', message: 'Already used by Rahul Menon' },
        ]),
    });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Copy');
    await userEvent.type(within(dialog).getByLabelText('Phone'), '9876543210');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create customer' }));
    expect(await within(dialog).findByText('Already used by Rahul Menon')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Copy');
  });

  it('edits with the row version and says it was saved', async () => {
    const { calls } = open({
      ...customerHandlers(),
      'PATCH /api/customers/c-1': () =>
        jsonResponse(makeCustomer({ name: 'Rahul M', rowVersion: 4 })),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Rahul Menon' }));
    const dialog = await screen.findByRole('dialog');
    const name = within(dialog).getByLabelText('Name');
    await userEvent.clear(name);
    await userEvent.type(name, 'Rahul M');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Customer Rahul M saved')).toBeInTheDocument();
    expect(bodyOf(calls, 'PATCH /api/customers/c-1')).toMatchObject({
      name: 'Rahul M',
      phone: '9876543210',
      gstin: '27AAPFU0939F1ZV',
      rowVersion: 3,
    });
  });

  it('shows the message when somebody else changed the customer first', async () => {
    open({
      ...customerHandlers(),
      'PATCH /api/customers/c-1': () =>
        conflict('This customer was changed by someone else. Reload them and try again'),
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Rahul Menon' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
  });
});
