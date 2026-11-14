import { createTransport } from 'nodemailer';
import type { MessageTemplateKey } from '@erp/contracts';
import type { Env } from '../../common/config/env.js';

export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');
export const MAIL_CLIENT = Symbol('MAIL_CLIENT');

/** A message that can never be delivered (a bad number, a number not on WhatsApp): trying again would be pointless. */
export class PermanentSendError extends Error {}
/** WhatsApp refused a free message because the customer has not written to the business in the last 24 hours. */
export class OutsideWindowError extends Error {}

export interface SentMessage {
  messageId: string;
}

/** The approved template names, one for each purpose; null where none is set up. */
export interface WhatsAppTemplates {
  general: string | null;
  invoice: string | null;
  receipt: string | null;
  reminder: string | null;
}

/** The setting that holds the template for each purpose, for the message that says what is missing. */
export const TEMPLATE_SETTINGS: Record<MessageTemplateKey, string> = {
  GENERAL: 'WHATSAPP_TEMPLATE_NAME',
  INVOICE: 'WHATSAPP_TEMPLATE_INVOICE',
  RECEIPT: 'WHATSAPP_TEMPLATE_RECEIPT',
  REMINDER: 'WHATSAPP_TEMPLATE_REMINDER',
};

/** The template to use for a purpose: its own, else the nearest one that is set up. */
export function resolveTemplate(
  templates: WhatsAppTemplates,
  key: MessageTemplateKey,
): string | null {
  const order: (keyof WhatsAppTemplates)[] =
    key === 'RECEIPT'
      ? ['receipt', 'invoice', 'general']
      : key === 'INVOICE'
        ? ['invoice', 'general']
        : key === 'REMINDER'
          ? ['reminder', 'general']
          : ['general'];
  for (const name of order) if (templates[name]) return templates[name];
  return null;
}

export interface WhatsAppClient {
  readonly configured: boolean;
  /** Whether a template can be used for this purpose (its own, or the one it falls back to). */
  hasTemplate(key: MessageTemplateKey): boolean;
  sendText(to: string, text: string): Promise<SentMessage>;
  sendDocument(
    to: string,
    file: { bytes: Buffer; fileName: string; mimeType: string },
    caption: string,
  ): Promise<SentMessage>;
  /** A template message with one text variable, allowed outside the 24-hour window. */
  sendTemplate(to: string, text: string, key: MessageTemplateKey): Promise<SentMessage>;
}

export interface MailClient {
  readonly configured: boolean;
  readonly from: string | null;
  send(message: {
    to: string;
    subject: string;
    text: string;
    attachment?: { bytes: Buffer; fileName: string; mimeType: string };
  }): Promise<SentMessage>;
}

/**
 * A phone number as WhatsApp wants it: digits only with the country code, no plus sign. A 10-digit number gets the default
 * country code; a leading 0 is dropped.
 */
export function toWhatsAppNumber(raw: string, countryCode: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `${countryCode}${digits}`;
  if (digits.length < 11 || digits.length > 15)
    throw new PermanentSendError(`"${raw}" is not a phone number WhatsApp can use`);
  return digits;
}

export function isEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** WhatsApp error codes that mean "busy, try again": too many messages, throughput, a paused number, a service hiccup. */
const TEMPORARY_CODES = new Set([4, 80007, 130429, 131016, 131056]);
/** Codes that mean the access token or its permission is wrong. This is for the owner to fix, so it is not tried again. */
const TOKEN_CODES = new Set([10, 190]);

interface GraphError {
  error?: { code?: number; message?: string; error_data?: { details?: string } };
}

/** WhatsApp Business (Meta Cloud API) over plain HTTPS. */
export class CloudWhatsAppClient implements WhatsAppClient {
  readonly configured = true;

  constructor(
    private readonly token: string,
    private readonly phoneNumberId: string,
    private readonly version: string,
    private readonly templates: WhatsAppTemplates,
    private readonly language: string,
    private readonly http: typeof fetch = fetch,
  ) {}

  hasTemplate(key: MessageTemplateKey): boolean {
    return resolveTemplate(this.templates, key) !== null;
  }

  private url(path: string): string {
    return `https://graph.facebook.com/${this.version}/${this.phoneNumberId}/${path}`;
  }

  private async post(path: string, init: { json?: unknown; form?: FormData }): Promise<unknown> {
    let response: Response;
    try {
      response = await this.http(this.url(path), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(init.json ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.json ? JSON.stringify(init.json) : (init.form as FormData),
      });
    } catch (error) {
      throw new Error(`Could not reach WhatsApp: ${(error as Error).message}`, { cause: error });
    }
    const text = await response.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (response.ok) return body;
    const failure = (body as GraphError | null)?.error;
    const code = failure?.code ?? 0;
    const message =
      failure?.error_data?.details ?? failure?.message ?? `WhatsApp answered ${response.status}`;
    if (code === 131047) throw new OutsideWindowError(message);
    if (response.status === 429 || response.status >= 500 || TEMPORARY_CODES.has(code))
      throw new Error(`WhatsApp is busy or down: ${message}`);
    if (TOKEN_CODES.has(code) || (code >= 200 && code < 300))
      throw new Error(`WhatsApp refused the access token or its permissions: ${message}`);
    throw new PermanentSendError(message);
  }

  private idOf(body: unknown): string {
    const id = (body as { messages?: { id?: string }[] } | null)?.messages?.[0]?.id;
    if (!id) throw new Error('WhatsApp did not give a message id');
    return id;
  }

  async sendText(to: string, text: string): Promise<SentMessage> {
    const body = await this.post('messages', {
      json: {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text, preview_url: false },
      },
    });
    return { messageId: this.idOf(body) };
  }

  async sendDocument(
    to: string,
    file: { bytes: Buffer; fileName: string; mimeType: string },
    caption: string,
  ): Promise<SentMessage> {
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', file.mimeType);
    form.set(
      'file',
      new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }),
      file.fileName,
    );
    const uploaded = (await this.post('media', { form })) as { id?: string } | null;
    if (!uploaded?.id) throw new Error('WhatsApp did not accept the file');
    const body = await this.post('messages', {
      json: {
        messaging_product: 'whatsapp',
        to,
        type: 'document',
        document: { id: uploaded.id, filename: file.fileName, caption },
      },
    });
    return { messageId: this.idOf(body) };
  }

  async sendTemplate(to: string, text: string, key: MessageTemplateKey): Promise<SentMessage> {
    const name = resolveTemplate(this.templates, key);
    if (!name)
      throw new PermanentSendError(`No WhatsApp template is set up (${TEMPLATE_SETTINGS[key]})`);
    // A template variable cannot hold line breaks or long runs of spaces.
    const flat = text
      .replace(/\s*\n+\s*/g, ' · ')
      .replace(/ {2,}/g, ' ')
      .slice(0, 1000);
    const body = await this.post('messages', {
      json: {
        messaging_product: 'whatsapp',
        to,
        type: 'template',
        template: {
          name,
          language: { code: this.language },
          components: [{ type: 'body', parameters: [{ type: 'text', text: flat }] }],
        },
      },
    });
    return { messageId: this.idOf(body) };
  }
}

/** Email through an SMTP server such as Google's. */
export class SmtpMailClient implements MailClient {
  readonly configured = true;
  private readonly transport;

  constructor(
    host: string,
    port: number,
    user: string,
    password: string,
    readonly from: string,
  ) {
    this.transport = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });
  }

  async send(message: {
    to: string;
    subject: string;
    text: string;
    attachment?: { bytes: Buffer; fileName: string; mimeType: string };
  }): Promise<SentMessage> {
    if (!isEmailAddress(message.to))
      throw new PermanentSendError(`"${message.to}" is not an email address`);
    try {
      const sent = await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        ...(message.attachment
          ? {
              attachments: [
                {
                  filename: message.attachment.fileName,
                  content: message.attachment.bytes,
                  contentType: message.attachment.mimeType,
                },
              ],
            }
          : {}),
      });
      return { messageId: String(sent.messageId ?? '') };
    } catch (error) {
      const failure = error as { responseCode?: number; message?: string };
      // 5xx from the mail server: the address or message was refused for good. Anything else may work next time.
      if (failure.responseCode && failure.responseCode >= 550 && failure.responseCode < 560)
        throw new PermanentSendError(failure.message ?? 'The mail server refused the message', {
          cause: error,
        });
      throw new Error(`Could not send the email: ${failure.message ?? 'unknown error'}`, {
        cause: error,
      });
    }
  }
}

/** Stands in when nothing is set up: every use says plainly what is missing. */
export class NotConfiguredWhatsApp implements WhatsAppClient {
  readonly configured = false;
  hasTemplate(): boolean {
    return false;
  }
  private fail(): never {
    throw new PermanentSendError(
      'WhatsApp is not set up: add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to the settings file',
    );
  }
  async sendText(): Promise<SentMessage> {
    return this.fail();
  }
  async sendDocument(): Promise<SentMessage> {
    return this.fail();
  }
  async sendTemplate(): Promise<SentMessage> {
    return this.fail();
  }
}

export class NotConfiguredMail implements MailClient {
  readonly configured = false;
  readonly from = null;
  async send(): Promise<SentMessage> {
    throw new PermanentSendError(
      'Email is not set up: add SMTP_USER and SMTP_PASSWORD to the settings file',
    );
  }
}

/** Keeps what would have been sent, so tests can look at it and make a send fail on purpose. */
export class FakeWhatsAppClient implements WhatsAppClient {
  readonly configured = true;
  /** Purposes with no template, so tests can try the missing-template case. */
  readonly missing = new Set<MessageTemplateKey>();
  hasTemplate(key: MessageTemplateKey): boolean {
    return !this.missing.has(key);
  }
  readonly sent: {
    kind: 'TEXT' | 'DOCUMENT' | 'TEMPLATE';
    to: string;
    text: string;
    fileName?: string;
    templateKey?: MessageTemplateKey;
  }[] = [];
  /** Errors to throw, one for each coming call. */
  failures: Error[] = [];
  private counter = 0;
  private next(): SentMessage {
    this.counter += 1;
    return { messageId: `wamid.fake.${this.counter}` };
  }
  private check(): void {
    const failure = this.failures.shift();
    if (failure) throw failure;
  }
  async sendText(to: string, text: string): Promise<SentMessage> {
    this.check();
    this.sent.push({ kind: 'TEXT', to, text });
    return this.next();
  }
  async sendDocument(
    to: string,
    file: { bytes: Buffer; fileName: string; mimeType: string },
    caption: string,
  ): Promise<SentMessage> {
    this.check();
    this.sent.push({ kind: 'DOCUMENT', to, text: caption, fileName: file.fileName });
    return this.next();
  }
  async sendTemplate(to: string, text: string, key: MessageTemplateKey): Promise<SentMessage> {
    this.check();
    this.sent.push({ kind: 'TEMPLATE', to, text, templateKey: key });
    return this.next();
  }
}

export class FakeMailClient implements MailClient {
  readonly configured = true;
  readonly from = 'shop@example.com';
  readonly sent: { to: string; subject: string; text: string; fileName?: string }[] = [];
  failures: Error[] = [];
  async send(message: {
    to: string;
    subject: string;
    text: string;
    attachment?: { bytes: Buffer; fileName: string; mimeType: string };
  }): Promise<SentMessage> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push({
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.attachment ? { fileName: message.attachment.fileName } : {}),
    });
    return { messageId: `<fake.${this.sent.length}@example.com>` };
  }
}

export function createWhatsAppClient(env: Env): WhatsAppClient {
  if (env.MESSAGING_MODE === 'fake') return new FakeWhatsAppClient();
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) return new NotConfiguredWhatsApp();
  return new CloudWhatsAppClient(
    env.WHATSAPP_TOKEN,
    env.WHATSAPP_PHONE_NUMBER_ID,
    env.WHATSAPP_API_VERSION,
    {
      general: env.WHATSAPP_TEMPLATE_NAME ?? null,
      invoice: env.WHATSAPP_TEMPLATE_INVOICE ?? null,
      receipt: env.WHATSAPP_TEMPLATE_RECEIPT ?? null,
      reminder: env.WHATSAPP_TEMPLATE_REMINDER ?? null,
    },
    env.WHATSAPP_TEMPLATE_LANGUAGE,
  );
}

export function createMailClient(env: Env): MailClient {
  if (env.MESSAGING_MODE === 'fake') return new FakeMailClient();
  if (!env.SMTP_USER || !env.SMTP_PASSWORD) return new NotConfiguredMail();
  return new SmtpMailClient(
    env.SMTP_HOST,
    env.SMTP_PORT,
    env.SMTP_USER,
    env.SMTP_PASSWORD,
    env.SMTP_FROM ?? env.SMTP_USER,
  );
}
