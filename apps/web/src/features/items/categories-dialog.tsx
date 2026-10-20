import { SimpleTable } from '@/components/data-table/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { useState } from 'react';
import type { FormEvent } from 'react';
import type { ItemCategory } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { categoryLabel } from './item-form-dialog';
import { useCategories, useCategoryMutations } from './use-items';

type Editing = { kind: 'new' } | { kind: 'edit'; category: ItemCategory } | null;

export function CategoriesDialog({ onClose }: { onClose: () => void }) {
  const categories = useCategories();
  const { create, update } = useCategoryMutations();
  const [editing, setEditing] = useState<Editing>(null);
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const all = categories.data ?? [];

  const begin = (next: Editing) => {
    setEditing(next);
    setProblem(null);
    setNotice(null);
    setName(next?.kind === 'edit' ? next.category.name : '');
    setParentId(next?.kind === 'edit' ? (next.category.parentId ?? '') : '');
  };

  const fail = (error: unknown) =>
    setProblem(
      error instanceof ApiError
        ? [error.message, ...error.details.map((detail) => detail.message)].join('. ')
        : 'Something went wrong. Try again.',
    );

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setProblem(null);
    if (name.trim().length < 2) {
      setProblem('Enter at least 2 characters');
      return;
    }
    try {
      let message: string;
      if (editing.kind === 'new') {
        await create.mutateAsync({
          name: name.trim(),
          parentId: parentId === '' ? null : parentId,
        });
        message = `Category ${name.trim()} created`;
      } else {
        await update.mutateAsync({
          id: editing.category.id,
          values: {
            name: name.trim(),
            parentId: parentId === '' ? null : parentId,
            rowVersion: editing.category.rowVersion,
          },
        });
        message = `Category ${name.trim()} saved`;
      }
      begin(null);
      setNotice(message);
    } catch (error) {
      fail(error);
    }
  };

  const toggle = async (category: ItemCategory) => {
    setProblem(null);
    setNotice(null);
    try {
      await update.mutateAsync({
        id: category.id,
        values: { isActive: !category.isActive, rowVersion: category.rowVersion },
      });
      setNotice(`Category ${category.name} ${category.isActive ? 'deactivated' : 'reactivated'}`);
    } catch (error) {
      fail(error);
    }
  };

  const parentChoices = all
    .filter(
      (category) =>
        category.isActive && (editing?.kind !== 'edit' || category.id !== editing.category.id),
    )
    .map((category) => ({ id: category.id, label: categoryLabel(category, all) }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const saving = create.isPending || update.isPending;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>Item categories</DialogTitle>
        <DialogDescription>
          Categories can sit inside each other, up to three levels.
        </DialogDescription>
        <div className="mt-3 space-y-3">
          {notice ? <Alert tone="success">{notice}</Alert> : null}
          {problem ? <Alert tone="error">{problem}</Alert> : null}
        </div>

        {categories.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading categories…
          </p>
        ) : categories.isError ? (
          <div className="mt-4 flex items-center gap-3 text-destructive" role="alert">
            <p>Could not load the categories.</p>
            <Button variant="secondary" size="sm" onClick={() => void categories.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <SimpleTable
            label="Categories"
            rows={[...all].sort((a, b) =>
              categoryLabel(a, all).localeCompare(categoryLabel(b, all)),
            )}
            getRowKey={(category) => category.id}
            className="mt-4"
            columns={[
              { header: 'Category', cell: (category) => categoryLabel(category, all) },
              { header: 'Items', align: 'right', cell: (category) => category.itemCount },
              {
                header: 'Status',
                cell: (category) => (
                  <StatusBadge
                    status={category.isActive ? 'ACTIVE' : 'INACTIVE'}
                    label={category.isActive ? 'Active' : 'Inactive'}
                  />
                ),
              },
              {
                header: <span className="sr-only">Actions</span>,
                align: 'right',
                cell: (category) => (
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Edit ${category.name}`}
                      onClick={() => begin({ kind: 'edit', category })}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${category.isActive ? 'Deactivate' : 'Reactivate'} ${category.name}`}
                      disabled={saving}
                      onClick={() => void toggle(category)}
                    >
                      {category.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}

        {editing ? (
          <form
            onSubmit={(event) => void save(event)}
            className="mt-4 space-y-3 rounded-md border p-3"
          >
            <label className="block space-y-1 text-sm font-medium">
              <span>Category name</span>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoComplete="off"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium">
              <span>Inside</span>
              <Select value={parentId} onChange={(event) => setParentId(event.target.value)}>
                <option value="">Top level</option>
                {parentChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            </label>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => begin(null)}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? 'Saving…' : editing.kind === 'new' ? 'Add category' : 'Save category'}
              </Button>
            </div>
          </form>
        ) : (
          <div className="mt-4 flex justify-between">
            <Button variant="secondary" onClick={() => begin({ kind: 'new' })}>
              New category
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
