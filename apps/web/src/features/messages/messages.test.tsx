//apps/web/src/features/messages/messages.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { MessageCampaign, MessageDelivery, MessagingStatus } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { ISSUED, MANAGER, billingHandlers, pageOf } from '../billing/test-data';
import { makeCustomer } from '../customers/test-data';

const CUSTOMER = '11111111-1111-4111-8111-aaaaaaaaaaa1';
const delivery = (over: Partial<MessageDelivery> = {}): MessageDelivery => ({
  id: 'd-1',
  recipientName: 'Ravi Kumar',
  toAddress: '9937117681',
  status: 'SENT',
  via: 'TEXT',
  error: null,
  attempts: 1,
  sentAt: '2026-11-12T05:00:00.000Z',
  ...over,
});
const campaign = (over: Partial<MessageCampaign> = {}): MessageCampaign => ({
  id: 'c-1',
  kind: 'BULK',
  channel: 'WHATSAPP',
  subject: null,
  body: 'Dear {{name}}, you owe Rs. {{due}}.',
  audience: 'Customers who owe money (2)',
  templateKey: 'REMINDER',
  createdAt: '2026-11-12T05:00:00.000Z',
  createdByName: 'Meena',
  total: 2,
  sent: 1,
  failed: 1,
  pending: 0,
  deliveries: [
    delivery(),
    delivery({
      id: 'd-2',
      recipientName: 'Asha Rao',
      status: 'FAILED',
      via: null,
      error: 'Not on WhatsApp',
      attempts: 1,
    }),
  ],
  ...over,
});
const ALL_TEMPLATES = { general: true, invoice: true, receipt: true, reminder: true };
const NO_TEMPLATES = { general: false, invoice: false, receipt: false, reminder: false };
const READY: MessagingStatus = {
  whatsapp: { configured: true, templates: ALL_TEMPLATES },
  email: { configured: true, from: 'shop@example.com' },
};
const BULK = ['messages.bulk', 'messages.send', 'customers.view'];

const handlers = (
  permissions: string[] = BULK,
  extra: Record<string, RouteHandler> = {},
  status: MessagingStatus = READY,
): Record<string, RouteHandler> => ({
  ...signedIn(makeSession({ permissions })),
  'GET /api/messages/status': () => jsonResponse(status),
  'GET /api/messages/campaigns?*': () => jsonResponse(pageOf([campaign()])),
  'GET /api/customers?*': () =>
    jsonResponse(pageOf([makeCustomer({ id: CUSTOMER, name: 'Ravi Kumar', phone: '9937117681' })])),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  renderApp('/messages');
  return state;
};
const posted = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((call) => call.key === key).map((call) => call.body);

describe('the messages page', () => {
  it('lists what was sent with how it went, and warns when WhatsApp or email is not set up', async () => {
    open(
      handlers(
        BULK,
        {},
        {
          whatsapp: { configured: false, templates: NO_TEMPLATES },
          email: { configured: false, from: null },
        },
      ),
    );
    const table = await screen.findByRole('table', { name: 'Messages sent' });
    const row = within(table).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Bulk message');
    expect(row).toHaveTextContent('WhatsApp · Customers who owe money (2)');
    expect(row).toHaveTextContent('1 sent, 1 failed');
    expect(await screen.findByText(/WhatsApp is not set up/)).toBeInTheDocument();
    expect(screen.getByText(/Email is not set up/)).toBeInTheDocument();
  });

  it('says so when nothing was sent yet, and is closed to someone without the permission', async () => {
    open(handlers(BULK, { 'GET /api/messages/campaigns?*': () => jsonResponse(pageOf([])) }));
    expect(await screen.findByText('Nothing has been sent yet.')).toBeInTheDocument();
  });

  it('opens a campaign to show each person, with the reason for a failure', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: /^Open Bulk message/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Bulk message' });
    expect(within(dialog).getByText('Dear {{name}}, you owe Rs. {{due}}.')).toBeInTheDocument();
    expect(within(dialog).getByText('1 sent · 1 failed · 0 waiting (of 2)')).toBeInTheDocument();
    expect(within(dialog).getByText('Not on WhatsApp')).toBeInTheDocument();
    expect(within(dialog).getByText('as Message')).toBeInTheDocument();
  });

  it('sends the failed ones again, and carries on until none are waiting', async () => {
    const sends = [
      campaign({ failed: 0, pending: 3, sent: 1, total: 4 }),
      campaign({ failed: 0, pending: 0, sent: 4, total: 4 }),
    ];
    const { calls } = open(
      handlers(BULK, {
        'POST /api/messages/campaigns/c-1/retry': () =>
          jsonResponse(campaign({ failed: 0, pending: 3, sent: 1, total: 4 })),
        'POST /api/messages/campaigns/c-1/send': () =>
          jsonResponse(sends.shift() ?? campaign({ pending: 0, sent: 4, failed: 0, total: 4 })),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Open Bulk message/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Bulk message' });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Send the failed ones again' }),
    );
    expect(
      await within(dialog).findByText('4 sent · 0 failed · 0 waiting (of 4)'),
    ).toBeInTheDocument();
    expect(posted(calls, 'POST /api/messages/campaigns/c-1/retry')).toHaveLength(1);
    expect(posted(calls, 'POST /api/messages/campaigns/c-1/send').length).toBeGreaterThanOrEqual(2);
  });
});

describe('a new bulk message', () => {
  const openForm = async (h: Record<string, RouteHandler> = handlers()) => {
    const state = open(h);
    await userEvent.click(await screen.findByRole('button', { name: 'New bulk message' }));
    const dialog = await screen.findByRole('dialog', { name: 'New bulk message' });
    return { ...state, dialog };
  };

  it('is only offered to those who may send bulk messages', async () => {
    open(handlers(['messages.send', 'messages.bulk']));
    await screen.findByRole('button', { name: 'New bulk message' });
  });

  it('asks for the message, counts who it reaches, and fills in the details with buttons', async () => {
    const { dialog, calls } = await openForm(
      handlers(BULK, {
        'POST /api/messages/bulk/preview': () =>
          jsonResponse({
            count: 12,
            withoutContact: 3,
            optedOut: 2,
            sampleNames: ['Ravi Kumar', 'Asha Rao'],
          }),
      }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to everyone' }));
    expect(await within(dialog).findByText('Enter the message')).toBeInTheDocument();
    expect(posted(calls, 'POST /api/messages/bulk')).toHaveLength(0);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Count who it reaches' }));
    expect(
      await within(dialog).findByText(
        /It reaches 12 people; 3 more have no phone number; 2 have opted out and are left out/,
      ),
    ).toBeInTheDocument();
    expect(posted(calls, 'POST /api/messages/bulk/preview')[0]).toEqual({
      channel: 'WHATSAPP',
      audience: { kind: 'DUES' },
    });
    const group = within(dialog).getByRole('group', { name: 'Add a detail' });
    await userEvent.click(within(group).getByRole('button', { name: 'Customer name' }));
    expect(within(dialog).getByLabelText('Message')).toHaveValue('{{name}}');
  });

  it('makes the campaign and sends it in rounds, showing the progress', async () => {
    const rounds = [
      campaign({ sent: 20, pending: 5, failed: 0, total: 25, deliveries: [] }),
      campaign({ sent: 25, pending: 0, failed: 0, total: 25, deliveries: [] }),
    ];
    const { dialog, calls } = await openForm(
      handlers(BULK, {
        'POST /api/messages/bulk': () =>
          jsonResponse(
            campaign({ sent: 0, pending: 25, failed: 0, total: 25, deliveries: [] }),
            201,
          ),
        'POST /api/messages/campaigns/c-1/send': () =>
          jsonResponse(
            rounds.shift() ??
              campaign({ sent: 25, pending: 0, failed: 0, total: 25, deliveries: [] }),
          ),
      }),
    );
    await userEvent.click(within(dialog).getByLabelText('Message'));
    await userEvent.paste('Hello {{name}}, we are open.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to everyone' }));
    expect(await screen.findByText('25 sent · 0 failed · 0 waiting (of 25)')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(posted(calls, 'POST /api/messages/bulk')[0]).toEqual({
      channel: 'WHATSAPP',
      audience: { kind: 'DUES' },
      body: 'Hello {{name}}, we are open.',
    });
    expect(posted(calls, 'POST /api/messages/campaigns/c-1/send')).toHaveLength(2);
  });

  it('asks for a subject when it goes by email', async () => {
    const { dialog, calls } = await openForm();
    await userEvent.selectOptions(within(dialog).getByLabelText('Send by'), 'EMAIL');
    await userEvent.click(within(dialog).getByLabelText('Message'));
    await userEvent.paste('Hello {{name}}, news.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to everyone' }));
    expect(await within(dialog).findByText('Enter the subject of the email')).toBeInTheDocument();
    expect(posted(calls, 'POST /api/messages/bulk')).toHaveLength(0);
  });

  it('can go to customers that are chosen one by one', async () => {
    const { dialog, calls } = await openForm(
      handlers(BULK, {
        'POST /api/messages/bulk': () =>
          jsonResponse(campaign({ sent: 0, pending: 1, failed: 0, total: 1, deliveries: [] }), 201),
        'POST /api/messages/campaigns/c-1/send': () =>
          jsonResponse(campaign({ sent: 1, pending: 0, failed: 0, total: 1, deliveries: [] })),
      }),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Send to'), 'SELECTED');
    await userEvent.click(await within(dialog).findByRole('checkbox', { name: /Ravi Kumar/ }));
    expect(within(dialog).getByText('1 chosen')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByLabelText('Message'));
    await userEvent.paste('Hello {{name}}, hi.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to everyone' }));
    await screen.findByText('1 sent · 0 failed · 0 waiting (of 1)');
    expect(posted(calls, 'POST /api/messages/bulk')[0]).toMatchObject({
      audience: { kind: 'SELECTED', customerIds: [CUSTOMER] },
    });
  });

  it('shows why the server refused, such as no one to send to', async () => {
    const { dialog } = await openForm(
      handlers(BULK, {
        'POST /api/messages/bulk': () =>
          jsonResponse(
            {
              code: 'BUSINESS_RULE_VIOLATION',
              message: 'There is no one to send this to',
              details: [
                { field: 'audience', message: 'None of these customers has a phone number' },
              ],
              requestId: 'r',
            },
            422,
          ),
      }),
    );
    await userEvent.click(within(dialog).getByLabelText('Message'));
    await userEvent.paste('Hello {{name}}, hi.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send to everyone' }));
    expect(
      (
        await within(dialog).findAllByText(
          /None of these customers has a phone number|no one to send/,
        )
      ).length,
    ).toBeGreaterThan(0);
  });

  it('says when there is no template, so people outside the 24-hour window cannot be reached', async () => {
    const { dialog } = await openForm(
      handlers(
        BULK,
        {},
        { whatsapp: { configured: true, templates: NO_TEMPLATES }, email: READY.email },
      ),
    );
    expect(
      await within(dialog).findByText(/No WhatsApp template is set up for reminders/),
    ).toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Send to'), 'ALL');
    expect(
      await within(dialog).findByText(/No WhatsApp template is set up for general messages/),
    ).toBeInTheDocument();
  });

  it('does not warn about the general template when only the reminder template is missing', async () => {
    const { dialog } = await openForm(
      handlers(
        BULK,
        {},
        {
          whatsapp: { configured: true, templates: { ...ALL_TEMPLATES, reminder: false } },
          email: READY.email,
        },
      ),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText('Send to'), 'ALL');
    expect(within(dialog).queryByText(/No WhatsApp template is set up/)).not.toBeInTheDocument();
  });
});

describe('the opt-out list', () => {
  const ENTRY = {
    customerId: CUSTOMER,
    customerName: 'Ravi Kumar',
    phone: '9937117681',
    reason: 'Asked on the phone',
    createdAt: '2026-11-12T05:00:00.000Z',
  };
  const openList = async (items = [ENTRY], extra: Record<string, RouteHandler> = {}) => {
    const state = open(
      handlers(BULK, { 'GET /api/messages/opt-outs': () => jsonResponse({ items }), ...extra }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Opted out' }));
    return {
      ...state,
      dialog: await screen.findByRole('dialog', { name: 'Customers who opted out' }),
    };
  };

  it('shows who opted out and puts them back when asked', async () => {
    const { dialog, calls } = await openList([ENTRY], {
      'DELETE /api/messages/opt-outs/*': () => jsonResponse({ items: [] }),
    });
    expect(await within(dialog).findByText('Asked on the phone')).toBeInTheDocument();
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Include Ravi Kumar in bulk messages again' }),
    );
    expect(calls.map((call) => call.key)).toContain(`DELETE /api/messages/opt-outs/${CUSTOMER}`);
  });

  it('adds a customer found by search, with the reason', async () => {
    const { dialog, calls } = await openList([], {
      'POST /api/messages/opt-outs': () => jsonResponse(ENTRY, 201),
    });
    expect(await within(dialog).findByText('No one has opted out.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Do not disturb');
    await userEvent.type(within(dialog).getByLabelText('Add a customer'), 'Ravi');
    await userEvent.click(
      await within(dialog).findByRole('button', { name: 'Opt out Ravi Kumar' }),
    );
    expect(posted(calls, 'POST /api/messages/opt-outs')[0]).toEqual({
      customerId: CUSTOMER,
      reason: 'Do not disturb',
    });
  });
});

describe('sending an invoice to the customer', () => {
  const openInvoice = async (permissions: string[], extra: Record<string, RouteHandler> = {}) => {
    const state = routeFetch({
      ...billingHandlers(permissions, [ISSUED()]),
      'GET /api/messages/status': () => jsonResponse(READY),
      ...extra,
    });
    renderApp('/sales');
    await userEvent.click(await screen.findByRole('button', { name: 'Open HQ/GI/26-27/00001' }));
    return { ...state, dialog: await screen.findByRole('dialog') };
  };
  const SEND = [...MANAGER, 'messages.send'];

  it('is offered only to those who may send messages', async () => {
    const { dialog } = await openInvoice(MANAGER);
    await within(dialog).findByRole('button', { name: 'Download PDF' });
    expect(
      within(dialog).queryByRole('button', { name: 'Send to customer' }),
    ).not.toBeInTheDocument();
  });

  it('sends the PDF by WhatsApp to the customer’s own number and says it was attached', async () => {
    const { dialog, calls } = await openInvoice(SEND, {
      'POST /api/messages/documents': () =>
        jsonResponse(
          campaign({
            kind: 'INVOICE',
            total: 1,
            sent: 1,
            failed: 0,
            deliveries: [delivery({ via: 'DOCUMENT' })],
          }),
          201,
        ),
    });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Send to customer' }));
    const form = await screen.findByRole('dialog', { name: /Send invoice HQ\/GI\/26-27\/00001/ });
    await userEvent.click(within(form).getByRole('button', { name: 'Send' }));
    expect(
      await within(form).findByText(/Sent on WhatsApp with the PDF attached/),
    ).toBeInTheDocument();
    const body = posted(calls, 'POST /api/messages/documents')[0] as Record<string, unknown>;
    expect(body).toMatchObject({ kind: 'INVOICE', channel: 'WHATSAPP' });
    expect(body).not.toHaveProperty('to');
    expect(body).not.toHaveProperty('message');
  });

  it('can go by email to another address with a message of its own', async () => {
    const { dialog, calls } = await openInvoice(SEND, {
      'POST /api/messages/documents': () =>
        jsonResponse(
          campaign({
            kind: 'INVOICE',
            channel: 'EMAIL',
            total: 1,
            sent: 1,
            failed: 0,
            deliveries: [delivery({ via: 'EMAIL', toAddress: 'accounts@example.com' })],
          }),
          201,
        ),
    });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Send to customer' }));
    const form = await screen.findByRole('dialog', { name: /Send invoice/ });
    await userEvent.selectOptions(within(form).getByLabelText('Send by'), 'EMAIL');
    await userEvent.type(within(form).getByLabelText('Email address'), 'accounts@example.com');
    await userEvent.type(within(form).getByLabelText('Message'), 'Please find it attached.');
    await userEvent.click(within(form).getByRole('button', { name: 'Send' }));
    expect(
      await within(form).findByText(/Sent by email with the PDF attached/),
    ).toBeInTheDocument();
    expect(posted(calls, 'POST /api/messages/documents')[0]).toMatchObject({
      channel: 'EMAIL',
      to: 'accounts@example.com',
      message: 'Please find it attached.',
    });
  });

  it('says plainly when it went as a template without the PDF, and when it failed', async () => {
    const results = [
      campaign({
        kind: 'INVOICE',
        total: 1,
        sent: 1,
        failed: 0,
        deliveries: [delivery({ via: 'TEMPLATE' })],
      }),
      campaign({
        kind: 'INVOICE',
        total: 1,
        sent: 0,
        failed: 1,
        deliveries: [delivery({ status: 'FAILED', via: null, error: 'Not on WhatsApp' })],
      }),
    ];
    const { dialog } = await openInvoice(SEND, {
      'POST /api/messages/documents': () => jsonResponse(results.shift(), 201),
    });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Send to customer' }));
    let form = await screen.findByRole('dialog', { name: /Send invoice/ });
    await userEvent.click(within(form).getByRole('button', { name: 'Send' }));
    expect(await within(form).findByText(/The PDF is not attached/)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Close' }));
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Send to customer' }));
    form = await screen.findByRole('dialog', { name: /Send invoice/ });
    await userEvent.click(within(form).getByRole('button', { name: 'Send' }));
    expect(
      await within(form).findByText(/could not be sent to 9937117681: Not on WhatsApp/),
    ).toBeInTheDocument();
  });

  it('warns when WhatsApp is not set up, and shows what the server refused', async () => {
    const { dialog } = await openInvoice(SEND, {
      'GET /api/messages/status': () =>
        jsonResponse({
          whatsapp: { configured: false, templates: NO_TEMPLATES },
          email: READY.email,
        }),
      'POST /api/messages/documents': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'There is nowhere to send this',
            details: [{ field: 'to', message: 'The customer has no phone number. Enter one' }],
            requestId: 'r',
          },
          400,
        ),
    });
    await userEvent.click(await within(dialog).findByRole('button', { name: 'Send to customer' }));
    const form = await screen.findByRole('dialog', { name: /Send invoice/ });
    expect(await within(form).findByText(/WhatsApp is not set up yet/)).toBeInTheDocument();
    await userEvent.click(within(form).getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(within(form).getAllByText(/The customer has no phone number/).length).toBeGreaterThan(
        0,
      ),
    );
  });
});
