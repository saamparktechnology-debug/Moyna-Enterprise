import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS } from './logger.module.js';

describe('log redaction', () => {
  it('removes credentials and tokens from logged requests', () => {
    let output = '';
    const sink = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        output += chunk.toString();
        callback();
      },
    });
    const logger = pino({ redact: { paths: REDACTED_PATHS, censor: '[redacted]' } }, sink);

    logger.info({
      req: {
        headers: {
          authorization: 'Bearer top-secret',
          cookie: 'sid=session-secret',
          'x-csrf-token': 'csrf-secret',
          accept: 'application/json',
        },
      },
      res: { headers: { 'set-cookie': ['sid=new-session-secret'] } },
    });

    expect(output).not.toMatch(/top-secret|session-secret|csrf-secret/);
    expect(output).toContain('application/json');
  });
});
