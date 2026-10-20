import type { Logger } from 'pino';

export type ExternalChannel = 'EMAIL' | 'SMS' | 'WHATSAPP';

export interface OutgoingMessage {
  notificationId: string;
  channel: ExternalChannel;
  /** An email address, or a phone number for SMS and WhatsApp. */
  to: string;
  subject: string;
  body: string;
}

/** Thrown when a message can never be delivered (no address, bad number), so retrying would be pointless. */
export class PermanentDeliveryError extends Error {}

/**
 * The one door out to email, SMS and WhatsApp. A real provider (SMTP, an SMS gateway, the WhatsApp Business API) is
 * another class that implements this; nothing else in the worker knows which one is in use.
 */
export interface NotificationProvider {
  send(message: OutgoingMessage): Promise<void>;
}

/** Keeps every message in memory so tests can look at what would have been sent. */
export class FakeProvider implements NotificationProvider {
  readonly sent: OutgoingMessage[] = [];
  failures: Error[] = [];

  async send(message: OutgoingMessage): Promise<void> {
    const failure = this.failures.shift();
    if (failure) throw failure;
    this.sent.push(message);
  }
}

/** Writes each message to the log instead of sending it. The default until a real provider is configured. */
export class LoggingProvider implements NotificationProvider {
  constructor(private readonly logger: Logger) {}

  async send(message: OutgoingMessage): Promise<void> {
    this.logger.info(
      { channel: message.channel, notificationId: message.notificationId },
      'Notification not sent: no provider configured, logged only',
    );
  }
}
