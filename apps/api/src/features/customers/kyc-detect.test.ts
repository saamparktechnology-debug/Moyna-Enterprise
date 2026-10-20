import { describe, expect, it } from 'vitest';
import { detectKycMime } from './kyc.service.js';

describe('detectKycMime', () => {
  it('recognises a PDF, a JPEG and a PNG by their first bytes', () => {
    expect(detectKycMime(Buffer.from('%PDF-1.7 rest'))).toBe('application/pdf');
    expect(detectKycMime(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0x00]))).toBe('image/jpeg');
    expect(detectKycMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))).toBe(
      'image/png',
    );
  });

  it('refuses programs, scripts, web pages, archives and empty files', () => {
    for (const bytes of [
      Buffer.from('MZ\u0090\u0000'),
      Buffer.from('#!/bin/sh\necho hi'),
      Buffer.from('<html><script>alert(1)</script></html>'),
      Buffer.from('<?xml version="1.0"?><svg onload="x()"/>'),
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.from('GIF89a'),
      Buffer.alloc(0),
    ])
      expect(detectKycMime(bytes)).toBeNull();
  });

  it('does not accept files that only partly look like the right kind', () => {
    expect(detectKycMime(Buffer.from('%PDF'))).toBeNull();
    expect(detectKycMime(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectKycMime(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(detectKycMime(Buffer.from(' %PDF-1.4'))).toBeNull();
  });
});
