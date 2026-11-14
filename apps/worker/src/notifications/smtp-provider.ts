import { createTransport } from 'nodemailer';
import { PermanentDeliveryError } from './provider.js';
import type { NotificationProvider, OutgoingMessage } from './provider.js';

/** Sends the EMAIL notifications through an SMTP server such as Google's (smtp.gmail.com with an app password). */
export class SmtpProvider implements NotificationProvider {
  private readonly transport;

  constructor(
    host: string,
    port: number,
    user: string,
    password: string,
    private readonly from: string,
  ) {
    this.transport = createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass: password },
    });
  }

  async send(message: OutgoingMessage): Promise<void> {
    if (message.channel !== 'EMAIL')
      throw new PermanentDeliveryError(
        `${message.channel} messages are not sent by the mail provider`,
      );
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(message.to))
      throw new PermanentDeliveryError(`"${message.to}" is not an email address`);
    try {
      await this.transport.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.body,
      });
    } catch (error) {
      const failure = error as { responseCode?: number; message?: string };
      // The mail server refused the address or message for good: do not try again.
      if (failure.responseCode && failure.responseCode >= 550 && failure.responseCode < 560)
        throw new PermanentDeliveryError(failure.message ?? 'The mail server refused the message', {
          cause: error,
        });
      throw new Error(`Could not send the email: ${failure.message ?? 'unknown error'}`, {
        cause: error,
      });
    }
  }
}
