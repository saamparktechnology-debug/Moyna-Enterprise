import { ValidationFailedError } from '../../common/errors/domain-errors.js';

export const FILE_EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10 MB

export function checkUploadedFile(
  body: unknown,
  declaredType: string | undefined,
  allowPdf = false,
): { bytes: Buffer; mimeType: string } {
  if (!body) {
    throw new ValidationFailedError('No file data provided', [
      { field: 'file', message: 'Upload a file' },
    ]);
  }

  const bytes = Buffer.isBuffer(body)
    ? body
    : typeof body === 'string'
      ? Buffer.from(body, 'base64')
      : Buffer.from(body as ArrayBuffer);

  if (bytes.length === 0) {
    throw new ValidationFailedError('Empty file provided', [
      { field: 'file', message: 'The uploaded file is empty' },
    ]);
  }

  if (bytes.length > MAX_IMAGE_SIZE) {
    throw new ValidationFailedError('File is too large', [
      { field: 'file', message: 'File must be under 10 MB' },
    ]);
  }

  // Detect MIME type from buffer magic bytes with declaredType fallback
  let mimeType = declaredType?.toLowerCase().trim();

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    mimeType = 'image/jpeg';
  } else if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    mimeType = 'image/png';
  } else if (
    bytes.length >= 12 &&
    bytes.toString('ascii', 0, 4) === 'RIFF' &&
    bytes.toString('ascii', 8, 12) === 'WEBP'
  ) {
    mimeType = 'image/webp';
  } else if (bytes.length >= 4 && bytes.toString('ascii', 0, 4) === '%PDF') {
    mimeType = 'application/pdf';
  }

  const allowedTypes = allowPdf
    ? ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    : ['image/jpeg', 'image/png', 'image/webp'];

  if (!mimeType || !allowedTypes.includes(mimeType) || !FILE_EXTENSIONS[mimeType]) {
    throw new ValidationFailedError('Invalid file type', [
      {
        field: 'file',
        message: allowPdf
          ? 'Allowed types: JPEG, PNG, WEBP, PDF'
          : 'Allowed types: JPEG, PNG, WEBP',
      },
    ]);
  }

  return { bytes, mimeType };
}
