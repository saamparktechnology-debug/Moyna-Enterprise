import { describe, expect, it, vi } from 'vitest';
import { loadEnv } from '../../common/config/env.js';
import {
  CloudWhatsAppClient,
  FakeMailClient,
  FakeWhatsAppClient,
  NotConfiguredMail,
  NotConfiguredWhatsApp,
  OutsideWindowError,
  PermanentSendError,
  SmtpMailClient,
  createMailClient,
  createWhatsAppClient,
  isEmailAddress,
  toWhatsAppNumber,
} from './clients.js';
import type { WhatsAppTemplates } from './clients.js';
import type { MessageTemplateKey } from '@erp/contracts';
import { renderMessage } from './messaging.service.js';

const reply = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const OK = { messages: [{ id: 'wamid.123' }] };
const NO_TEMPLATES = { general: null, invoice: null, receipt: null, reminder: null };
const client = (http: typeof fetch, templates: Partial<WhatsAppTemplates> | null = {}) =>
  new CloudWhatsAppClient(
    'TOKEN',
    '1099',
    'v21.0',
    templates === null ? NO_TEMPLATES : { ...NO_TEMPLATES, general: 'shop_update', ...templates },
    'en',
    http,
  );

describe('toWhatsAppNumber', () => {
  it('puts the country code on a 10-digit number and strips everything that is not a digit', () => {
    expect(toWhatsAppNumber('9937117681', '91')).toBe('919937117681');
    expect(toWhatsAppNumber('99371 17681', '91')).toBe('919937117681');
    expect(toWhatsAppNumber('+91 99371-17681', '91')).toBe('919937117681');
    expect(toWhatsAppNumber('09937117681', '91')).toBe('919937117681');
    expect(toWhatsAppNumber('0091 9937117681', '91')).toBe('919937117681');
    expect(toWhatsAppNumber('447911123456', '91')).toBe('447911123456');
  });

  it('refuses what cannot be a phone number', () => {
    for (const bad of ['', '123', 'abc', '99371', '1234567890123456'])
      expect(() => toWhatsAppNumber(bad, '91')).toThrow(PermanentSendError);
  });
});

describe('isEmailAddress and renderMessage', () => {
  it('accepts an email address and nothing else', () => {
    expect(isEmailAddress('ravi@example.com')).toBe(true);
    for (const bad of ['ravi', 'ravi@', '@example.com', 'ravi @example.com', 'ravi@example'])
      expect(isEmailAddress(bad)).toBe(false);
  });

  it('fills the name, the amount owed and the shop, and leaves nothing behind for an unknown name', () => {
    expect(
      renderMessage('Dear {{name}}, you owe Rs. {{due}} to {{ shop }}.{{nothing}}', {
        name: 'Ravi',
        due: '1,500.00',
        shop: 'Moyna Enterprise',
      }),
    ).toBe('Dear Ravi, you owe Rs. 1,500.00 to Moyna Enterprise.');
  });
});

describe('the WhatsApp Business client', () => {
  it('sends a free text message with the token, to the phone number id', async () => {
    const http = vi.fn().mockResolvedValue(reply(200, OK));
    const sent = await client(http as unknown as typeof fetch).sendText('919937117681', 'Hello');
    expect(sent.messageId).toBe('wamid.123');
    const [url, init] = http.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v21.0/1099/messages');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer TOKEN');
    expect(JSON.parse(init.body as string)).toEqual({
      messaging_product: 'whatsapp',
      to: '919937117681',
      type: 'text',
      text: { body: 'Hello', preview_url: false },
    });
  });

  it('sends a document by uploading it first and then sending it with its caption', async () => {
    const http = vi
      .fn()
      .mockResolvedValueOnce(reply(200, { id: 'media-9' }))
      .mockResolvedValueOnce(reply(200, OK));
    await client(http as unknown as typeof fetch).sendDocument(
      '919937117681',
      {
        bytes: Buffer.from('%PDF-1.4'),
        fileName: 'ME-111120261123.pdf',
        mimeType: 'application/pdf',
      },
      'Your invoice',
    );
    expect((http.mock.calls[0] as [string])[0]).toBe('https://graph.facebook.com/v21.0/1099/media');
    expect((http.mock.calls[0] as [string, RequestInit])[1].body).toBeInstanceOf(FormData);
    expect(
      JSON.parse((http.mock.calls[1] as [string, RequestInit])[1].body as string),
    ).toMatchObject({
      type: 'document',
      document: { id: 'media-9', filename: 'ME-111120261123.pdf', caption: 'Your invoice' },
    });
  });

  it('sends a template with the message as its one variable, on one line', async () => {
    const http = vi.fn().mockResolvedValue(reply(200, OK));
    await client(http as unknown as typeof fetch).sendTemplate(
      '919937117681',
      'Line one\n\nLine   two',
      'GENERAL',
    );
    expect(
      JSON.parse((http.mock.calls[0] as [string, RequestInit])[1].body as string),
    ).toMatchObject({
      type: 'template',
      template: {
        name: 'shop_update',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Line one · Line two' }] }],
      },
    });
    await expect(
      client(http as unknown as typeof fetch, null).sendTemplate('1', 'x', 'GENERAL'),
    ).rejects.toThrow('WHATSAPP_TEMPLATE_NAME');
  });

  it('uses the template of the purpose, and the nearest one that is set up when there is none', async () => {
    const http = vi.fn().mockImplementation(async () => reply(200, OK));
    const sentName = async (templates: Partial<WhatsAppTemplates>, key: MessageTemplateKey) => {
      http.mockClear();
      await client(http as unknown as typeof fetch, templates).sendTemplate('1', 'x', key);
      return (
        JSON.parse((http.mock.calls[0] as [string, RequestInit])[1].body as string) as {
          template: { name: string };
        }
      ).template.name;
    };
    const all = { invoice: 'inv', receipt: 'rec', reminder: 'rem' };
    expect(await sentName(all, 'INVOICE')).toBe('inv');
    expect(await sentName(all, 'RECEIPT')).toBe('rec');
    expect(await sentName(all, 'REMINDER')).toBe('rem');
    expect(await sentName(all, 'GENERAL')).toBe('shop_update');
    expect(await sentName({ invoice: 'inv' }, 'RECEIPT')).toBe('inv');
    expect(await sentName({}, 'RECEIPT')).toBe('shop_update');
    expect(await sentName({}, 'REMINDER')).toBe('shop_update');
  });

  it('says which purposes have a template', () => {
    const only = client(vi.fn() as unknown as typeof fetch, { general: null, reminder: 'rem' });
    expect(only.hasTemplate('REMINDER')).toBe(true);
    expect(only.hasTemplate('GENERAL')).toBe(false);
    expect(only.hasTemplate('INVOICE')).toBe(false);
    expect(client(vi.fn() as unknown as typeof fetch).hasTemplate('RECEIPT')).toBe(true);
  });

  it('says when the 24-hour window has closed, so a template can be used instead', async () => {
    const http = vi.fn().mockResolvedValue(
      reply(400, {
        error: {
          code: 131047,
          message: 'Re-engagement message',
          error_data: { details: 'More than 24 hours' },
        },
      }),
    );
    await expect(
      client(http as unknown as typeof fetch).sendText('919937117681', 'Hi'),
    ).rejects.toBeInstanceOf(OutsideWindowError);
  });

  it('tells a number that can never work from a problem that may pass', async () => {
    const permanent = vi
      .fn()
      .mockResolvedValue(reply(400, { error: { code: 131026, message: 'Message undeliverable' } }));
    await expect(
      client(permanent as unknown as typeof fetch).sendText('1', 'Hi'),
    ).rejects.toBeInstanceOf(PermanentSendError);
    for (const status of [429, 500, 503]) {
      const busy = vi
        .fn()
        .mockResolvedValue(reply(status, { error: { code: 1, message: 'busy' } }));
      const failure = await client(busy as unknown as typeof fetch)
        .sendText('1', 'Hi')
        .catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).not.toBeInstanceOf(PermanentSendError);
    }
    const throughput = vi
      .fn()
      .mockResolvedValue(reply(400, { error: { code: 130429, message: 'Rate limit' } }));
    expect(
      await client(throughput as unknown as typeof fetch)
        .sendText('1', 'Hi')
        .catch((e: unknown) => e),
    ).not.toBeInstanceOf(PermanentSendError);
    const token = vi
      .fn()
      .mockResolvedValue(
        reply(401, { error: { code: 190, message: 'Invalid OAuth access token' } }),
      );
    const refused = await client(token as unknown as typeof fetch)
      .sendText('1', 'Hi')
      .catch((e: unknown) => e);
    expect(refused).not.toBeInstanceOf(PermanentSendError);
    expect((refused as Error).message).toContain('access token');
    const down = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    expect(
      (
        (await client(down as unknown as typeof fetch)
          .sendText('1', 'Hi')
          .catch((e: unknown) => e)) as Error
      ).message,
    ).toContain('Could not reach WhatsApp');
  });

  it('fails when WhatsApp gives no message id', async () => {
    const http = vi.fn().mockResolvedValue(reply(200, {}));
    await expect(client(http as unknown as typeof fetch).sendText('1', 'Hi')).rejects.toThrow(
      'message id',
    );
  });
});

describe('which client the settings give', () => {
  const env = (extra: Record<string, string> = {}) =>
    loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://erp:erp@localhost:5432/erp',
      SESSION_SECRET: 'test-session-secret-0123456789-abcdefghij',
      ...extra,
    });

  it('is not set up, and says what to add, when the settings are empty', async () => {
    const whatsapp = createWhatsAppClient(env());
    expect(whatsapp).toBeInstanceOf(NotConfiguredWhatsApp);
    await expect(whatsapp.sendText('1', 'Hi')).rejects.toThrow('WHATSAPP_TOKEN');
    const mail = createMailClient(env());
    expect(mail).toBeInstanceOf(NotConfiguredMail);
    await expect(mail.send({ to: 'a@b.co', subject: 's', text: 't' })).rejects.toThrow('SMTP_USER');
  });

  it('is the real client when the settings are given, with Google as the default mail server', () => {
    const live = env({
      WHATSAPP_TOKEN: 'abc',
      WHATSAPP_PHONE_NUMBER_ID: '1099',
      WHATSAPP_TEMPLATE_NAME: 'shop_update',
      SMTP_USER: 'shop@gmail.com',
      SMTP_PASSWORD: 'app-password',
    });
    expect(live.SMTP_HOST).toBe('smtp.gmail.com');
    expect(live.SMTP_PORT).toBe(465);
    expect(live.WHATSAPP_COUNTRY_CODE).toBe('91');
    const whatsapp = createWhatsAppClient(live);
    expect(whatsapp).toBeInstanceOf(CloudWhatsAppClient);
    expect(whatsapp.hasTemplate('GENERAL')).toBe(true);
    expect(whatsapp.hasTemplate('REMINDER')).toBe(true);
    const mail = createMailClient(live);
    expect(mail).toBeInstanceOf(SmtpMailClient);
    expect(mail.from).toBe('shop@gmail.com');
  });

  it('refuses half a setting, and fake messaging in production', () => {
    expect(() => env({ WHATSAPP_TOKEN: 'abc' })).toThrow('go together');
    expect(() => env({ SMTP_USER: 'shop@gmail.com' })).toThrow('go together');
    expect(() =>
      env({ MESSAGING_MODE: 'fake', NODE_ENV: 'production', KYC_STORAGE_PATH: '/var/kyc' }),
    ).toThrow('fake messaging');
  });

  it('is the fake client in fake mode', () => {
    const fake = env({ MESSAGING_MODE: 'fake' });
    expect(createWhatsAppClient(fake)).toBeInstanceOf(FakeWhatsAppClient);
    expect(createMailClient(fake)).toBeInstanceOf(FakeMailClient);
  });
});

describe('the mail client', () => {
  it('refuses a bad address without trying the network', async () => {
    const mail = new SmtpMailClient(
      'smtp.gmail.com',
      465,
      'shop@gmail.com',
      'pw',
      'shop@gmail.com',
    );
    await expect(
      mail.send({ to: 'not-an-address', subject: 'x', text: 'y' }),
    ).rejects.toBeInstanceOf(PermanentSendError);
  });
});
