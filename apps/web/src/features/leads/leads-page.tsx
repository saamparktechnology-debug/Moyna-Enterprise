import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { LEAD_STAGES } from '@erp/contracts';
import type { Lead, LeadSummary } from '@erp/contracts';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { SectionPanel, SectionTabs } from '@/components/section-tabs';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { FollowupsTab } from './followups-tab';
import { LeadSourcesTab } from './lead-sources-tab';
import { LeadDetailDialog } from './lead-detail-dialog';
import { LeadFormDialog } from './lead-form-dialog';
import { STAGE_TEXT, formatWhen } from './leads-shared';
import { useLeads } from './use-leads';

const SECTIONS = [
  { id: 'leads', label: 'Leads' },
  { id: 'followups', label: 'Follow-ups' },
  { id: 'sources', label: 'Lead sources' },
] as const;

type Dialogs = { kind: 'form'; lead: Lead | undefined } | { kind: 'detail'; id: string } | null;

export function LeadsPage() {
  const { can } = useAuth();
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('leads');
  const [dialog, setDialog] = useState<Dialogs>(null);
  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
  };
  const tabs = SECTIONS.filter((item) => item.id !== 'sources' || can('leads.manage_sources'));

  return (
    <PageContainer>
      <PageHeader
        title="Leads"
        description="People who may buy, their stage and the follow-ups still to make."
        actions={
          <Can permission="leads.manage">
            <Button onClick={() => setDialog({ kind: 'form', lead: undefined })}>New lead</Button>
          </Can>
        }
      />

      <SectionTabs
        label="Lead sections"
        idPrefix="leads"
        tabs={tabs}
        value={section}
        onChange={setSection}
      />

      <SectionPanel idPrefix="leads" id={section}>
        {section === 'followups' ? (
          <FollowupsTab onOpenLead={(id) => setDialog({ kind: 'detail', id })} />
        ) : section === 'sources' ? (
          <LeadSourcesTab />
        ) : (
          <LeadsTab onOpen={(id) => setDialog({ kind: 'detail', id })} />
        )}
      </SectionPanel>

      {dialog?.kind === 'form' ? (
        <LeadFormDialog lead={dialog.lead} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog?.kind === 'detail' ? (
        <LeadDetailDialog
          key={dialog.id}
          leadId={dialog.id}
          onClose={() => setDialog(null)}
          onEdit={(lead) => setDialog({ kind: 'form', lead })}
          onConverted={done}
        />
      ) : null}
    </PageContainer>
  );
}

const DEFAULTS = { pageSize: 10, filters: { stage: 'open', assigned: '', late: '' } };
const ASSIGNED_TEXT: Record<string, string> = { me: 'Me', unassigned: 'Nobody yet' };

function LeadsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [params, set] = useListParams(DEFAULTS, 'leads');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const stage = params.filters['stage'] ?? 'open';
  const assignedTo = params.filters['assigned'] ?? '';
  const overdue = params.filters['late'] === '1';
  const query = useLeads({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    stage,
    assignedTo,
    overdue,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<LeadSummary, unknown>[] = [
    {
      id: 'lead',
      header: 'Lead',
      meta: { sortKey: 'name', alwaysVisible: true, className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.name}
          <span className="block text-xs font-normal text-muted-foreground">
            {row.original.phone}
          </span>
        </>
      ),
    },
    {
      id: 'stage',
      header: 'Stage',
      meta: { sortKey: 'stage' },
      cell: ({ row }) => (
        <StatusBadge status={row.original.stage} label={STAGE_TEXT[row.original.stage]} />
      ),
    },
    { accessorKey: 'sourceName', header: 'Came from' },
    {
      id: 'assigned',
      header: 'Looked after by',
      cell: ({ row }) => row.original.assignedToName ?? '—',
    },
    {
      id: 'next',
      header: 'Next follow-up',
      cell: ({ row }) => (
        <>
          {row.original.nextFollowupAt ? formatWhen(row.original.nextFollowupAt) : '—'}
          {row.original.overdueFollowups > 0 ? (
            <span className="block text-xs text-destructive">
              {row.original.overdueFollowups} overdue
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open lead ${row.original.name}`}
            onClick={() => onOpen(row.original.id)}
          >
            Open
          </Button>
        </RowActions>
      ),
    },
  ];

  const chips = [
    ...(stage !== 'open'
      ? [
          {
            label: `Stage: ${stage === 'all' ? 'All' : (STAGE_TEXT[stage as keyof typeof STAGE_TEXT] ?? stage)}`,
            onRemove: () => set.setFilter('stage', 'open'),
          },
        ]
      : []),
    ...(assignedTo !== ''
      ? [
          {
            label: `Looked after by: ${ASSIGNED_TEXT[assignedTo] ?? assignedTo}`,
            onRemove: () => set.setFilter('assigned', ''),
          },
        ]
      : []),
    ...(overdue
      ? [{ label: 'Only with a late follow-up', onRemove: () => set.setFilter('late', '') }]
      : []),
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search leads"
        searchPlaceholder="Name, phone or interest"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Stage</span>
          <Select
            className="w-full sm:w-44"
            value={stage}
            onChange={(event) => set.setFilter('stage', event.target.value)}
          >
            <option value="open">Still open</option>
            <option value="all">All</option>
            {LEAD_STAGES.map((value) => (
              <option key={value} value={value}>
                {STAGE_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Looked after by</span>
          <Select
            className="w-full sm:w-44"
            value={assignedTo}
            onChange={(event) => set.setFilter('assigned', event.target.value)}
          >
            <option value="">Anyone</option>
            <option value="me">Me</option>
            <option value="unassigned">Nobody yet</option>
          </Select>
        </label>
        <label className="flex min-h-control items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={overdue}
            onChange={(event) => set.setFilter('late', event.target.checked ? '1' : '')}
          />
          Only with a late follow-up
        </label>
      </DataTableToolbar>
      <DataTable
        label="Leads"
        noun="leads"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="There are no leads yet."
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />
    </>
  );
}
