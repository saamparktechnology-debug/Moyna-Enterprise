//apps/web/src/features/hr/agreements-tab.tsx
import { useState } from 'react';
import type { Agreement } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { Can } from '@/components/can';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { SimpleTable } from '@/components/data-table/simple-table';
import { FilePreview, useFilePreview } from '@/components/file-preview';
import { LoadingState } from '@/components/loading-state';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { describeError } from '../purchasing/purchasing-shared';
import { downloadAgreementPdf, downloadSignedCopy } from './agreements-api';
import {
  AgreementFormDialog,
  ReasonDialog,
  SignedCopyDialog,
  TemplatesDialog,
} from './agreement-dialogs';
import { useAgreements, useMyAgreements } from './use-agreements';
import { useStaffList } from './use-hr';

const STATUS_TEXT: Record<Agreement['status'], string> = {
  DRAFT: 'Draft',
  SIGNED: 'Signed',
  ENDED: 'Ended',
  DISCARDED: 'Discarded',
};

type Target =
  | { kind: 'new' }
  | { kind: 'edit'; agreement: Agreement }
  | { kind: 'sign'; agreement: Agreement }
  | { kind: 'end'; agreement: Agreement }
  | { kind: 'discard'; agreement: Agreement };

/** Reads an agreement as a PDF, or the signed copy that was uploaded, in the page. */
function useViewer() {
  const view = useFilePreview();
  const open = async (kind: 'pdf' | 'copy', agreement: Agreement) => {
    try {
      const blob = await (kind === 'pdf'
        ? downloadAgreementPdf(agreement.id)
        : downloadSignedCopy(agreement.id));
      view.show(
        blob,
        blob.type || 'application/pdf',
        `${kind === 'pdf' ? 'Agreement' : 'Signed copy of'} ${agreement.agreementNo}`,
      );
    } catch (error) {
      toast.error(describeError(error).message ?? 'Could not open the agreement');
    }
  };
  return { view, open };
}

/** The signed agreements of the person signed in: to read and to print. */
export function MyAgreements() {
  const mine = useMyAgreements();
  const { view, open } = useViewer();
  const items = mine.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <section aria-label="My agreement" className="mt-6 space-y-2">
      <h2 className="section-title">My agreement</h2>
      <SimpleTable
        label="My agreements"
        rows={items}
        getRowKey={(row) => row.id}
        columns={[
          { header: 'Agreement', cell: (row) => `${row.title} (${row.agreementNo})` },
          { header: 'Signed on', cell: (row) => row.signedOn ?? '—' },
          {
            header: 'Status',
            cell: (row) => <StatusBadge status={row.status} label={STATUS_TEXT[row.status]} />,
          },
          {
            header: 'Actions',
            cell: (row) => (
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Read ${row.agreementNo}`}
                  onClick={() => void open('pdf', row)}
                >
                  Read or print
                </Button>
                {row.hasSignedCopy ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={`View the signed copy of ${row.agreementNo}`}
                    onClick={() => void open('copy', row)}
                  >
                    Signed copy
                  </Button>
                ) : null}
              </span>
            ),
          },
        ]}
      />
      {view.preview ? (
        <FilePreview
          url={view.preview.url}
          mimeType={view.preview.mimeType}
          title={view.preview.title}
          onClose={view.close}
        />
      ) : null}
    </section>
  );
}

/** Employee agreements, for those who manage HR: make, edit, print, upload the signed copy, end. */
export function AgreementsTab() {
  const [staffId, setStaffId] = useState('');
  const [status, setStatus] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const query = useAgreements({ staffId, status });
  const people = useStaffList({ page: 1, pageSize: 100, search: '', status: '', department: '' });
  const { view, open } = useViewer();
  const done = (message: string) => {
    toast.success(message);
    setTarget(null);
  };

  const columns = [
    {
      header: 'Agreement',
      cell: (row: Agreement) => (
        <>
          <span className="font-medium">{row.title}</span>
          <span className="block text-xs text-muted-foreground">{row.agreementNo}</span>
        </>
      ),
    },
    {
      header: 'Employee',
      cell: (row: Agreement) => (
        <>
          {row.staffName}
          <span className="block text-xs text-muted-foreground">{row.employeeCode}</span>
        </>
      ),
    },
    { header: 'Starts', cell: (row: Agreement) => row.effectiveFrom },
    {
      header: 'Status',
      cell: (row: Agreement) => (
        <>
          <StatusBadge status={row.status} label={STATUS_TEXT[row.status]} />
          {row.status === 'SIGNED' && row.signedOn ? (
            <span className="block text-xs text-muted-foreground">on {row.signedOn}</span>
          ) : null}
          {row.status === 'ENDED' ? (
            <span className="block text-xs text-muted-foreground">
              ended {row.endedOn}
              {row.endReason ? `: ${row.endReason}` : ''}
            </span>
          ) : null}
          {row.status === 'DISCARDED' && row.endReason ? (
            <span className="block text-xs text-muted-foreground">{row.endReason}</span>
          ) : null}
        </>
      ),
    },
    {
      header: 'Actions',
      cell: (row: Agreement) =>
        row.status === 'DISCARDED' ? null : (
          <span className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              aria-label={`${row.status === 'DRAFT' ? 'Print' : 'Read'} ${row.agreementNo}`}
              onClick={() => void open('pdf', row)}
            >
              {row.status === 'DRAFT' ? 'Print' : 'Read'}
            </Button>
            {row.status === 'DRAFT' ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Edit ${row.agreementNo}`}
                  onClick={() => setTarget({ kind: 'edit', agreement: row })}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  aria-label={`Upload the signed copy of ${row.agreementNo}`}
                  onClick={() => setTarget({ kind: 'sign', agreement: row })}
                >
                  Upload signed copy
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Throw away ${row.agreementNo}`}
                  onClick={() => setTarget({ kind: 'discard', agreement: row })}
                >
                  Throw away
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                aria-label={`View the signed copy of ${row.agreementNo}`}
                onClick={() => void open('copy', row)}
              >
                Signed copy
              </Button>
            )}
            {row.status === 'SIGNED' ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`End ${row.agreementNo}`}
                onClick={() => setTarget({ kind: 'end', agreement: row })}
              >
                End
              </Button>
            ) : null}
          </span>
        ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          <Can permission="hr.manage">
            <Button variant="secondary" onClick={() => setTemplatesOpen(true)}>
              Templates
            </Button>
            <Button onClick={() => setTarget({ kind: 'new' })}>New agreement</Button>
          </Can>
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Employee</span>
          <Select
            className="w-full sm:w-56"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
          >
            <option value="">Everyone</option>
            {(people.data?.items ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Status</span>
          <Select
            className="w-full sm:w-40"
            value={status}
            onChange={(event) => setStatus(event.target.value)}
          >
            <option value="">All</option>
            <option value="DRAFT">Draft</option>
            <option value="SIGNED">Signed</option>
            <option value="ENDED">Ended</option>
            <option value="DISCARDED">Discarded</option>
          </Select>
        </label>
      </DataTableToolbar>
      {query.isPending ? (
        <LoadingState label="Loading the agreements…" rows={3} />
      ) : query.isError ? (
        <Alert tone="error">Could not load the agreements.</Alert>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">
          No agreement yet. Press New agreement to make one for an employee.
        </p>
      ) : (
        <SimpleTable
          label="Agreements"
          rows={query.data?.items ?? []}
          getRowKey={(row) => row.id}
          columns={columns}
        />
      )}
      {view.preview ? (
        <FilePreview
          url={view.preview.url}
          mimeType={view.preview.mimeType}
          title={view.preview.title}
          onClose={view.close}
        />
      ) : null}
      {templatesOpen ? <TemplatesDialog onClose={() => setTemplatesOpen(false)} /> : null}
      {target?.kind === 'new' || target?.kind === 'edit' ? (
        <AgreementFormDialog
          agreement={target.kind === 'edit' ? target.agreement : null}
          onClose={() => setTarget(null)}
          onDone={done}
        />
      ) : null}
      {target?.kind === 'sign' ? (
        <SignedCopyDialog
          agreement={target.agreement}
          onClose={() => setTarget(null)}
          onDone={done}
        />
      ) : null}
      {target?.kind === 'end' || target?.kind === 'discard' ? (
        <ReasonDialog
          kind={target.kind}
          agreement={target.agreement}
          onClose={() => setTarget(null)}
          onDone={done}
        />
      ) : null}
    </>
  );
}
