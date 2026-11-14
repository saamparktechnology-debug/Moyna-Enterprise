//apps/web/src/features/messages/messages-page.tsx
import { useState } from 'react';
import type { MessageCampaign } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { Can } from '@/components/can';
import { SimpleTable } from '@/components/data-table/simple-table';
import { LoadingState } from '@/components/loading-state';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { formatWhen } from '../leads/leads-shared';
import { BulkDialog, CampaignDialog } from './bulk-dialogs';
import { OptOutDialog } from './opt-out-dialog';
import { useCampaigns, useMessagingStatus } from './use-messages';

const KIND_TEXT = { BULK: 'Bulk message', INVOICE: 'Invoice', RECEIPT: 'Receipt' } as const;

/** Messages sent to customers by WhatsApp and email, and a way to send a bulk message. */
export function MessagesPage() {
  const [page, setPage] = useState(1);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [optOutOpen, setOptOutOpen] = useState(false);
  const [opened, setOpened] = useState<MessageCampaign | null>(null);
  const status = useMessagingStatus();
  const query = useCampaigns({ page, pageSize: 15 });

  return (
    <PageContainer>
      <PageHeader
        title="Messages"
        description="Invoices, receipts and bulk messages sent to customers by WhatsApp and email, and how each one went."
        actions={
          <Can permission="messages.bulk">
            <span className="flex gap-2">
              <Button variant="secondary" onClick={() => setOptOutOpen(true)}>
                Opted out
              </Button>
              <Button onClick={() => setBulkOpen(true)}>New bulk message</Button>
            </span>
          </Can>
        }
      />
      {status.data && !status.data.whatsapp.configured ? (
        <Alert tone="warning">
          WhatsApp is not set up. Add WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID to the settings
          file, then restart.
        </Alert>
      ) : null}
      {status.data && !status.data.email.configured ? (
        <Alert tone="warning">
          Email is not set up. Add SMTP_USER and SMTP_PASSWORD (a Google app password) to the
          settings file, then restart.
        </Alert>
      ) : null}
      {query.isPending ? (
        <LoadingState label="Loading the messages…" rows={3} />
      ) : query.isError ? (
        <Alert tone="error">Could not load the messages.</Alert>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
      ) : (
        <SimpleTable
          label="Messages sent"
          rows={query.data?.items ?? []}
          getRowKey={(row) => row.id}
          columns={[
            {
              header: 'When',
              cell: (row) => (
                <>
                  {formatWhen(row.createdAt)}
                  {row.createdByName ? (
                    <span className="block text-xs text-muted-foreground">{row.createdByName}</span>
                  ) : null}
                </>
              ),
            },
            {
              header: 'What',
              cell: (row) => (
                <>
                  <span className="font-medium">{KIND_TEXT[row.kind]}</span>
                  <span className="block text-xs text-muted-foreground">
                    {row.channel === 'WHATSAPP' ? 'WhatsApp' : 'Email'} · {row.audience}
                  </span>
                </>
              ),
            },
            {
              header: 'Message',
              cell: (row) => <span className="line-clamp-2 max-w-72 text-sm">{row.body}</span>,
            },
            {
              header: 'Result',
              cell: (row) => (
                <>
                  {row.sent} sent
                  {row.failed > 0 ? (
                    <span className="text-destructive">, {row.failed} failed</span>
                  ) : null}
                  {row.pending > 0 ? `, ${row.pending} waiting` : null}
                </>
              ),
            },
            {
              header: 'Actions',
              cell: (row) => (
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Open ${KIND_TEXT[row.kind]} of ${formatWhen(row.createdAt)}`}
                  onClick={() => setOpened(row)}
                >
                  Open
                </Button>
              ),
            },
          ]}
        />
      )}
      {(query.data?.totalPages ?? 0) > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {query.data?.page} of {query.data?.totalPages}
          </span>
          <span className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= (query.data?.totalPages ?? 1)}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </span>
        </div>
      ) : null}
      {bulkOpen ? <BulkDialog onClose={() => setBulkOpen(false)} /> : null}
      {optOutOpen ? <OptOutDialog onClose={() => setOptOutOpen(false)} /> : null}
      {opened ? <CampaignDialog campaign={opened} onClose={() => setOpened(null)} /> : null}
    </PageContainer>
  );
}
