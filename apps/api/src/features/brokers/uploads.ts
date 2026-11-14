import type { KycMime } from '@erp/contracts';
import { KYC_MAX_BYTES } from '@erp/contracts';
import { ValidationFailedError } from '../../common/errors/domain-errors.js';
import { detectKycMime } from '../customers/kyc.service.js';

export const FILE_EXTENSIONS: Record<KycMime, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
};

/**
 * Checks a file sent as the request body. What it really is comes from its first bytes; the name and the declared type
 * are not trusted. A photo must be a JPEG or PNG picture, a document may also be a PDF. The size limit is the KYC one.
 */
export function checkUploadedFile(
  body: unknown,
  declaredType: string | undefined,
  allowPdf: boolean,
): { bytes: Buffer; mimeType: KycMime } {
  const wanted = allowPdf ? 'Upload a PDF, JPEG or PNG file' : 'Upload a JPEG or PNG picture';
  if (!Buffer.isBuffer(body) || body.length === 0)
    throw new ValidationFailedError('No file was sent', [{ field: 'file', message: wanted }]);
  if (body.length > KYC_MAX_BYTES)
    throw new ValidationFailedError('The file is too large', [
      { field: 'file', message: 'The file is larger than 5 MB' },
    ]);
  const detected = detectKycMime(body);
  if (
    !detected ||
    (!allowPdf && detected === 'application/pdf') ||
    (declaredType && declaredType.split(';')[0]?.trim() !== detected)
  )
    throw new ValidationFailedError('The file is not of an allowed kind', [
      { field: 'file', message: wanted },
    ]);
  return { bytes: body, mimeType: detected };
}
