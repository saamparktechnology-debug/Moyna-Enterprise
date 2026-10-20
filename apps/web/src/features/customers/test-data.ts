import type { Customer, KycDocument } from '@erp/contracts';
import { jsonResponse, makeSession, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';

export const MANAGER = [
  'customers.view',
  'customers.manage',
  'kyc.view',
  'kyc.upload',
  'kyc.verify',
];
export const STAFF = ['customers.view', 'customers.manage', 'kyc.view', 'kyc.upload'];
export const VIEWER = ['customers.view'];

export function makeCustomer(over: Partial<Customer> = {}): Customer {
  return {
    id: 'c-1',
    name: 'Rahul Menon',
    phone: '9876543210',
    email: 'ravi@example.com',
    address: '12 Main Road',
    stateCode: '27',
    stateName: 'Maharashtra',
    gstin: '27AAPFU0939F1ZV',
    kycStatus: 'NOT_SUBMITTED',
    rowVersion: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

export function makeDocument(over: Partial<KycDocument> = {}): KycDocument {
  return {
    id: 'd-1',
    customerId: 'c-1',
    docType: 'AADHAAR',
    docTypeName: 'Aadhaar card',
    status: 'PENDING',
    fileName: 'aadhaar.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 2048,
    docNumberMasked: 'XXXXXXXX9012',
    uploadedByName: 'Asha Rao',
    uploadedAt: '2026-10-08T05:00:00.000Z',
    reviewedByName: null,
    reviewedAt: null,
    rejectionReason: null,
    isCurrent: true,
    rowVersion: 1,
    ...over,
  };
}

export const pageOf = <T>(items: T[], over: Record<string, number> = {}) => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...over,
});

export function customerHandlers(
  permissions: string[] = MANAGER,
  customers: Customer[] = [makeCustomer()],
  documents: KycDocument[] = [],
): Record<string, RouteHandler> {
  const kycStatus = customers[0]?.kycStatus ?? 'NOT_SUBMITTED';
  return {
    ...signedIn(makeSession({ permissions })),
    'GET /api/customers?*': () => jsonResponse(pageOf(customers)),
    'GET /api/reference/states': () =>
      jsonResponse([
        { code: '27', name: 'Maharashtra' },
        { code: '29', name: 'Karnataka' },
      ]),
    'GET /api/reference/kyc-document-types': () =>
      jsonResponse([
        { code: 'AADHAAR', name: 'Aadhaar card' },
        { code: 'PAN', name: 'PAN card' },
        { code: 'PHOTO', name: 'Photograph' },
      ]),
    'GET /api/customers/c-1/kyc': () => jsonResponse({ kycStatus, documents }),
  };
}
