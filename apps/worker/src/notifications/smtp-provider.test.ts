import { describe, expect, it } from 'vitest';
import { PermanentDeliveryError } from './provider.js';
import { SmtpProvider } from './smtp-provider.js';

describe('the mail provider', () => {
  const provider = new SmtpProvider(
    'smtp.gmail.com',
    465,
    'shop@gmail.com',
    'pw',
    'shop@gmail.com',
  );
  const message = {
    notificationId: 'n-1',
    channel: 'EMAIL' as const,
    to: 'ravi@example.com',
    subject: 'Hello',
    body: 'Body',
  };

  it('refuses an address that is not an email address, for good, without trying the network', async () => {
    await expect(provider.send({ ...message, to: 'not-an-address' })).rejects.toBeInstanceOf(
      PermanentDeliveryError,
    );
  });

  it('does not send SMS or WhatsApp', async () => {
    await expect(provider.send({ ...message, channel: 'SMS' })).rejects.toBeInstanceOf(
      PermanentDeliveryError,
    );
    await expect(provider.send({ ...message, channel: 'WHATSAPP' })).rejects.toBeInstanceOf(
      PermanentDeliveryError,
    );
  });
});
