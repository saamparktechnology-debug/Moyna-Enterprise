import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { KYC_ALLOWED_TYPES, KYC_MAX_BYTES, documentNumberProblem } from '@erp/contracts';
import type { Customer, KycDocument } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-provider';
import { ApiError } from '@/lib/api-client';
import { KYC_LABELS, formatSize } from './customers-shared';
import { useKyc, useKycDocumentTypes, useKycMutations } from './use-customers';

interface KycDialogProps {
  customer: Customer;
  onClose: () => void;
}

function problemOf(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Something went wrong. Try again.';
  return [error.message, ...error.details.map((detail) => detail.message)]
    .filter((text, index, all) => all.indexOf(text) === index)
    .join('. ');
}

export function KycDialog({ customer, onClose }: KycDialogProps) {
  const { can } = useAuth();
  const kyc = useKyc(customer.id);
  const types = useKycDocumentTypes();
  const { upload, verify, reject, download } = useKycMutations(customer.id);
  const [docType, setDocType] = useState('');
  const [number, setNumber] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<KycDocument | null>(null);
  const [reason, setReason] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const canUpload = can('kyc.upload');
  const canView = can('kyc.view');
  const canVerify = can('kyc.verify');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setNotice(null);
    setProblem(null);
    const accepted: readonly string[] = KYC_ALLOWED_TYPES;
    const found =
      docType === ''
        ? 'Choose the kind of document'
        : !file
          ? 'Choose a file'
          : file.size > KYC_MAX_BYTES
            ? `The file is larger than ${KYC_MAX_BYTES / 1024 / 1024} MB`
            : !accepted.includes(file.type)
              ? 'Upload a PDF, JPEG or PNG file'
              : number.trim() !== '' && documentNumberProblem(docType, number)
                ? documentNumberProblem(docType, number)
                : null;
    setFormProblem(found);
    if (found || !file) return;
    try {
      await upload.mutateAsync({ docType, file, documentNumber: number });
      setDocType('');
      setNumber('');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      setNotice('Document uploaded. It is now waiting for review.');
    } catch (error) {
      setProblem(problemOf(error));
    }
  };

  const view = async (document: KycDocument) => {
    setNotice(null);
    setProblem(null);
    try {
      const blob = await download.mutateAsync(document.id);
      window.open(URL.createObjectURL(blob), '_blank', 'noopener');
    } catch (error) {
      setProblem(problemOf(error));
    }
  };

  const decide = async (document: KycDocument) => {
    setNotice(null);
    setProblem(null);
    try {
      await verify.mutateAsync(document);
      setNotice(`${document.docTypeName} verified`);
    } catch (error) {
      setProblem(problemOf(error));
    }
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    setNotice(null);
    setProblem(null);
    try {
      await reject.mutateAsync({
        documentId: rejecting.id,
        values: { rowVersion: rejecting.rowVersion, reason },
      });
      setNotice(`${rejecting.docTypeName} rejected`);
      setRejecting(null);
      setReason('');
    } catch (error) {
      setProblem(problemOf(error));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>KYC documents · {customer.name}</DialogTitle>
        <DialogDescription>
          Document numbers are shown masked, and every time a file is opened it is recorded who
          opened it.
        </DialogDescription>

        <div className="mt-3 space-y-3">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {problem ? <Alert tone="error">{problem}</Alert> : null}
        </div>

        {kyc.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading documents…
          </p>
        ) : kyc.error || !kyc.data ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the documents.</p>
            <Button variant="secondary" size="sm" onClick={() => void kyc.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            <p className="mt-4 text-sm font-medium" aria-label="KYC status">
              KYC status: {KYC_LABELS[kyc.data.kycStatus]}
            </p>
            {kyc.data.documents.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                No documents have been uploaded yet.
              </p>
            ) : (
              <SimpleTable
                label="KYC documents"
                rows={kyc.data.documents}
                getRowKey={(document) => document.id}
                className="mt-2"
                rowClassName={(document) => (document.isCurrent ? undefined : 'opacity-70')}
                columns={[
                  {
                    header: 'Kind',
                    cell: (document) => (
                      <>
                        {document.docTypeName}
                        {document.isCurrent ? null : ' (earlier upload)'}
                      </>
                    ),
                  },
                  {
                    header: 'File',
                    className: 'break-id',
                    cell: (document) => (
                      <>
                        {document.fileName} · {formatSize(document.sizeBytes)}
                      </>
                    ),
                  },
                  {
                    header: 'Number',
                    className: 'font-mono text-xs',
                    cell: (document) => document.docNumberMasked ?? '—',
                  },
                  {
                    header: 'Status',
                    cell: (document) => (
                      <StatusBadge status={document.status} label={KYC_LABELS[document.status]} />
                    ),
                  },
                  {
                    header: 'Uploaded',
                    cell: (document) => (
                      <>
                        {document.uploadedByName ?? 'Unknown'} · {document.uploadedAt.slice(0, 10)}
                      </>
                    ),
                  },
                  {
                    header: 'Decision',
                    cell: (document) =>
                      document.reviewedAt
                        ? `${document.reviewedByName ?? 'Unknown'} · ${document.reviewedAt.slice(0, 10)}${
                            document.rejectionReason ? ` · ${document.rejectionReason}` : ''
                          }`
                        : '—',
                  },
                  {
                    header: <span className="sr-only">Actions</span>,
                    align: 'right',
                    cell: (document) => (
                      <div className="flex flex-wrap justify-end gap-1">
                        {canView ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`View ${document.docTypeName} ${document.fileName}`}
                            disabled={download.isPending}
                            onClick={() => void view(document)}
                          >
                            View
                          </Button>
                        ) : null}
                        {canVerify && document.status === 'PENDING' ? (
                          <>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Verify ${document.docTypeName} ${document.fileName}`}
                              disabled={verify.isPending}
                              onClick={() => void decide(document)}
                            >
                              Verify
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Reject ${document.docTypeName} ${document.fileName}`}
                              onClick={() => {
                                setRejecting(document);
                                setReason('');
                              }}
                            >
                              Reject
                            </Button>
                          </>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            )}

            {rejecting ? (
              <form
                aria-label="Reject a document"
                className="mt-4 space-y-2 rounded-md border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void confirmReject();
                }}
              >
                <label className="block space-y-1 text-sm font-medium">
                  <span>Reason for rejecting {rejecting.docTypeName}</span>
                  <Input
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    autoComplete="off"
                  />
                </label>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setRejecting(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={reject.isPending}>
                    Reject document
                  </Button>
                </div>
              </form>
            ) : null}

            {canUpload ? (
              <form
                aria-label="Upload a document"
                onSubmit={(event) => void submit(event)}
                noValidate
                className="mt-6 space-y-3 rounded-md border p-3"
              >
                <p className="text-sm font-medium">Upload a document</p>
                {formProblem ? <Alert tone="error">{formProblem}</Alert> : null}
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="space-y-1 text-sm font-medium">
                    <span>Kind of document</span>
                    <Select value={docType} onChange={(event) => setDocType(event.target.value)}>
                      <option value="">Choose a kind</option>
                      {types.data?.map((type) => (
                        <option key={type.code} value={type.code}>
                          {type.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="space-y-1 text-sm font-medium">
                    <span>Document number (optional)</span>
                    <Input
                      value={number}
                      onChange={(event) => setNumber(event.target.value)}
                      autoComplete="off"
                    />
                    <span className="block text-xs font-normal text-muted-foreground">
                      Only the last four characters are kept.
                    </span>
                  </label>
                  <label className="space-y-1 text-sm font-medium sm:col-span-2">
                    <span>File</span>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                      className="block w-full text-sm"
                      onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                    />
                    <span className="block text-xs font-normal text-muted-foreground">
                      PDF, JPEG or PNG, up to 5 MB.
                    </span>
                  </label>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={upload.isPending}>
                    {upload.isPending ? 'Uploading…' : 'Upload document'}
                  </Button>
                </div>
              </form>
            ) : null}
          </>
        )}
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
