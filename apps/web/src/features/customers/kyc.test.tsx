import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KYC_MAX_BYTES } from '@erp/contracts';
import type { KycDocument } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { MANAGER, STAFF, VIEWER, customerHandlers, makeCustomer, makeDocument } from './test-data';

const fail = (message: string, details: { field: string; message: string }[] = [], status = 422) =>
  jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);
const pdf = (name = 'aadhaar.pdf', type = 'application/pdf', size?: number) => {
  const file = new File(['%PDF-1.4 sample'], name, { type });
  if (size !== undefined) Object.defineProperty(file, 'size', { value: size });
  return file;
};

const openKyc = async (
  permissions: string[] = MANAGER,
  documents: KycDocument[] = [makeDocument()],
  extra: Record<string, RouteHandler> = {},
) => {
  const state = routeFetch({
    ...customerHandlers(permissions, [makeCustomer({ kycStatus: 'PENDING' })], documents),
    ...extra,
  });
  renderApp('/customers');
  await userEvent.click(
    await screen.findByRole('button', { name: 'KYC documents of Rahul Menon' }),
  );
  const dialog = await screen.findByRole('dialog');
  return { ...state, dialog };
};
const choose = (dialog: HTMLElement, file: File) =>
  fireEvent.change(within(dialog).getByLabelText(/^File/), { target: { files: [file] } });

describe('the KYC history', () => {
  it('shows the status and each document with a masked number, who uploaded it and who decided', async () => {
    const { dialog } = await openKyc(MANAGER, [
      makeDocument({
        id: 'd-2',
        fileName: 'new.pdf',
        status: 'VERIFIED',
        reviewedByName: 'Neha Sen',
        reviewedAt: '2026-10-09T05:00:00.000Z',
      }),
      makeDocument({
        id: 'd-1',
        isCurrent: false,
        status: 'REJECTED',
        fileName: 'blurry.jpg',
        mimeType: 'image/jpeg',
        reviewedByName: 'Neha Sen',
        reviewedAt: '2026-10-08T09:00:00.000Z',
        rejectionReason: 'Photo is not clear',
      }),
    ]);
    expect(within(dialog).getByLabelText('KYC status')).toHaveTextContent(
      'KYC status: Waiting for review',
    );
    const [current, earlier] = within(within(dialog).getByRole('table', { name: 'KYC documents' }))
      .getAllByRole('row')
      .slice(1);
    expect(current).toHaveTextContent('Aadhaar card');
    expect(current).toHaveTextContent('XXXXXXXX9012');
    expect(current).toHaveTextContent('Verified');
    expect(current).toHaveTextContent('Neha Sen · 2026-10-09');
    expect(current).not.toHaveTextContent('earlier upload');
    expect(earlier).toHaveTextContent('Aadhaar card (earlier upload)');
    expect(earlier).toHaveTextContent('Rejected');
    expect(earlier).toHaveTextContent('Photo is not clear');
  });

  it('never shows a full document number', async () => {
    const { dialog } = await openKyc();
    expect(dialog.textContent).not.toMatch(/\d{12}/);
    expect(within(dialog).getByText('XXXXXXXX9012')).toBeInTheDocument();
  });

  it('says so when nothing has been uploaded', async () => {
    const { dialog } = await openKyc(MANAGER, []);
    expect(
      await within(dialog).findByText('No documents have been uploaded yet.'),
    ).toBeInTheDocument();
  });

  it('shows an error and recovers on Retry', async () => {
    let broken = true;
    const { dialog } = await openKyc(MANAGER, [], {
      'GET /api/customers/c-1/kyc': () =>
        broken
          ? jsonResponse({ code: 'INTERNAL_ERROR', message: 'x', details: [], requestId: 'r' }, 500)
          : jsonResponse({ kycStatus: 'NOT_SUBMITTED', documents: [] }),
    });
    expect(await within(dialog).findByText('Could not load the documents.')).toBeInTheDocument();
    broken = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retry' }));
    expect(
      await within(dialog).findByText('No documents have been uploaded yet.'),
    ).toBeInTheDocument();
  });
});

describe('uploading a document', () => {
  const upload = (dialog: HTMLElement) =>
    within(within(dialog).getByRole('form', { name: 'Upload a document' }));

  it('checks the kind, the file, its size, its type and the number before sending anything', async () => {
    const { dialog, calls } = await openKyc(MANAGER, []);
    const form = upload(dialog);
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    expect(await form.findByText('Choose the kind of document')).toBeInTheDocument();
    await userEvent.selectOptions(form.getByLabelText('Kind of document'), 'AADHAAR');
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    expect(await form.findByText('Choose a file')).toBeInTheDocument();
    choose(dialog, pdf('big.pdf', 'application/pdf', KYC_MAX_BYTES + 1));
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    expect(await form.findByText('The file is larger than 5 MB')).toBeInTheDocument();
    choose(dialog, pdf('notes.txt', 'text/plain'));
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    expect(await form.findByText('Upload a PDF, JPEG or PNG file')).toBeInTheDocument();
    choose(dialog, pdf());
    await userEvent.type(form.getByLabelText(/^Document number/), '1234');
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    expect(await form.findByText('An Aadhaar number has 12 digits')).toBeInTheDocument();
    expect(calls.some((call) => call.key.startsWith('POST'))).toBe(false);
  });

  it('accepts a file of exactly the largest size', async () => {
    const { dialog, calls } = await openKyc(MANAGER, [], {
      'POST /api/customers/c-1/kyc-documents?*': () => jsonResponse(makeDocument(), 201),
    });
    const form = upload(dialog);
    await userEvent.selectOptions(form.getByLabelText('Kind of document'), 'PAN');
    choose(dialog, pdf('exact.pdf', 'application/pdf', KYC_MAX_BYTES));
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    await waitFor(() =>
      expect(
        calls.some((call) => call.key.startsWith('POST /api/customers/c-1/kyc-documents')),
      ).toBe(true),
    );
  });

  it('sends the file with its kind and name, keeps the number in a header and confirms', async () => {
    const { dialog, calls } = await openKyc(MANAGER, [], {
      'POST /api/customers/c-1/kyc-documents?*': () => jsonResponse(makeDocument(), 201),
    });
    const form = upload(dialog);
    await userEvent.selectOptions(form.getByLabelText('Kind of document'), 'AADHAAR');
    await userEvent.type(form.getByLabelText(/^Document number/), '1234 5678 9012');
    choose(dialog, pdf());
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    expect(
      await within(dialog).findByText('Document uploaded. It is now waiting for review.'),
    ).toBeInTheDocument();
    const sent = calls.find((call) => call.key.startsWith('POST /api/customers/c-1/kyc-documents'));
    expect(sent?.key).toBe(
      'POST /api/customers/c-1/kyc-documents?docType=AADHAAR&fileName=aadhaar.pdf',
    );
    expect(sent?.headers['x-document-number']).toBe('1234 5678 9012');
    expect(sent?.headers['content-type']).toBe('application/pdf');
    expect(sent?.key).not.toContain('1234');
  });

  it('shows the server’s refusal, such as a kind that is already verified', async () => {
    const { dialog } = await openKyc(MANAGER, [], {
      'POST /api/customers/c-1/kyc-documents?*': () =>
        fail('This kind of document is already verified', [
          { field: 'docType', message: 'Aadhaar card has already been verified for this customer' },
        ]),
    });
    const form = upload(dialog);
    await userEvent.selectOptions(form.getByLabelText('Kind of document'), 'AADHAAR');
    choose(dialog, pdf());
    await userEvent.click(form.getByRole('button', { name: 'Upload document' }));
    expect(
      await within(dialog).findByText(/already been verified for this customer/),
    ).toBeInTheDocument();
  });

  it('offers the upload form only to people who may upload', async () => {
    const viewer = await openKyc(['customers.view', 'kyc.view'], []);
    expect(
      within(viewer.dialog).queryByRole('form', { name: 'Upload a document' }),
    ).not.toBeInTheDocument();
  });
});

describe('verifying and rejecting', () => {
  it('lets a reviewer verify a waiting document using the version they read', async () => {
    const { dialog, calls } = await openKyc(MANAGER, [makeDocument({ rowVersion: 4 })], {
      'POST /api/customers/c-1/kyc-documents/d-1/verify': () =>
        jsonResponse(makeDocument({ status: 'VERIFIED', rowVersion: 5 })),
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Verify Aadhaar card aadhaar.pdf' }),
    );
    expect(await within(dialog).findByText('Aadhaar card verified')).toBeInTheDocument();
    expect(calls.find((call) => call.key.endsWith('/verify'))?.body).toEqual({ rowVersion: 4 });
  });

  it('shows why a verification was refused, such as verifying your own upload', async () => {
    const { dialog } = await openKyc(MANAGER, [makeDocument()], {
      'POST /api/customers/c-1/kyc-documents/d-1/verify': () =>
        jsonResponse(
          {
            code: 'FORBIDDEN',
            message: 'You cannot verify a document you uploaded. Ask another reviewer',
            details: [],
            requestId: 'r',
          },
          403,
        ),
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Verify Aadhaar card aadhaar.pdf' }),
    );
    expect(
      await within(dialog).findByText(/cannot verify a document you uploaded/),
    ).toBeInTheDocument();
  });

  it('asks for a reason to reject and sends it', async () => {
    const { dialog, calls } = await openKyc(MANAGER, [makeDocument()], {
      'POST /api/customers/c-1/kyc-documents/d-1/reject': () =>
        jsonResponse(makeDocument({ status: 'REJECTED' })),
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reject Aadhaar card aadhaar.pdf' }),
    );
    const form = within(dialog).getByRole('form', { name: 'Reject a document' });
    await userEvent.type(within(form).getByLabelText(/Reason for rejecting/), 'Photo is not clear');
    await userEvent.click(within(form).getByRole('button', { name: 'Reject document' }));
    expect(await within(dialog).findByText('Aadhaar card rejected')).toBeInTheDocument();
    expect(calls.find((call) => call.key.endsWith('/reject'))?.body).toEqual({
      rowVersion: 1,
      reason: 'Photo is not clear',
    });
  });

  it('shows the server’s message when a rejection has no reason', async () => {
    const { dialog } = await openKyc(MANAGER, [makeDocument()], {
      'POST /api/customers/c-1/kyc-documents/d-1/reject': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Some fields are not valid',
            details: [{ field: 'reason', message: 'Give a reason of at least 3 characters' }],
            requestId: 'r',
          },
          400,
        ),
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Reject Aadhaar card aadhaar.pdf' }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject document' }));
    expect(
      await within(dialog).findByText(/Give a reason of at least 3 characters/),
    ).toBeInTheDocument();
  });

  it('offers no decision on a document that was already decided, or to people who may not decide', async () => {
    const decided = await openKyc(MANAGER, [makeDocument({ status: 'VERIFIED' })]);
    expect(
      within(decided.dialog).queryByRole('button', { name: /^Verify / }),
    ).not.toBeInTheDocument();
    expect(
      within(decided.dialog).queryByRole('button', { name: /^Reject / }),
    ).not.toBeInTheDocument();
  });

  it('keeps Staff from deciding', async () => {
    const { dialog } = await openKyc(STAFF, [makeDocument()]);
    expect(within(dialog).queryByRole('button', { name: /^Verify / })).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole('button', { name: 'View Aadhaar card aadhaar.pdf' }),
    ).toBeInTheDocument();
  });

  it('keeps people who may only list customers out of the documents altogether', async () => {
    routeFetch(customerHandlers(VIEWER));
    renderApp('/customers');
    await screen.findByRole('table', { name: 'Customers' });
    expect(screen.queryByRole('button', { name: /KYC documents of/ })).not.toBeInTheDocument();
  });
});

describe('viewing a file', () => {
  const create = vi.fn(() => 'blob:kyc-file');
  const open = vi.fn();
  beforeEach(() => {
    create.mockClear();
    open.mockClear();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: create }));
    vi.spyOn(window, 'open').mockImplementation(open);
  });
  afterEach(() => vi.restoreAllMocks());

  it('opens the downloaded file in a new tab without letting it see this page', async () => {
    const { dialog, calls } = await openKyc(MANAGER, [makeDocument()], {
      'GET /api/customers/c-1/kyc-documents/d-1/file': () =>
        new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } }),
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'View Aadhaar card aadhaar.pdf' }),
    );
    await waitFor(() => expect(open).toHaveBeenCalledWith('blob:kyc-file', '_blank', 'noopener'));
    expect(calls.some((call) => call.key === 'GET /api/customers/c-1/kyc-documents/d-1/file')).toBe(
      true,
    );
  });

  it('shows the message when the file cannot be read', async () => {
    const { dialog } = await openKyc(MANAGER, [makeDocument()], {
      'GET /api/customers/c-1/kyc-documents/d-1/file': () =>
        jsonResponse(
          {
            code: 'NOT_FOUND',
            message: 'The stored file was not found',
            details: [],
            requestId: 'r',
          },
          404,
        ),
    });
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'View Aadhaar card aadhaar.pdf' }),
    );
    expect(await within(dialog).findByText('The stored file was not found')).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });
});
