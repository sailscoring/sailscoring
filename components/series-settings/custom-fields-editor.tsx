'use client';

import { useState } from 'react';

import { useConfirm } from '@/components/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useCompetitorsBySeries, useSaveCompetitors } from '@/hooks/use-competitors';
import { useUpdateSeries } from '@/hooks/use-series';
import {
  CUSTOM_FIELD_LABEL_MAX_LENGTH,
  customFieldsProblems,
  withCompetitorColumn,
  withoutColumn,
} from '@/lib/results-columns';
import type { CustomField, Series } from '@/lib/types';

/**
 * The series' custom fields, on the Competitor fields card: text fields the
 * scorer adds and names ("Rig", "Sponsor"), each with one value per
 * competitor. Listed after the optional fields, beside the subdivision axes,
 * each with a name that can be changed.
 */
export function CustomFieldsEditor({
  seriesId,
  series,
  canEdit,
}: {
  seriesId: string;
  series: Series;
  /** The `custom-columns` feature is on: fields can be added, renamed and
   *  deleted. Off, a series that already has some lists them read-only. */
  canEdit: boolean;
}) {
  const updateSeries = useUpdateSeries();
  const saveCompetitors = useSaveCompetitors();
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const confirm = useConfirm();
  const fields = series.customFields ?? [];
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<{ id: string | 'new'; message: string } | null>(null);

  function problemFor(next: CustomField[]): string | null {
    return customFieldsProblems(next)[0] ?? null;
  }

  async function persist(next: CustomField[], resultsColumns?: Series['resultsColumns']) {
    await updateSeries.mutateAsync({
      id: seriesId,
      patch: {
        customFields: next,
        ...(resultsColumns !== undefined ? { resultsColumns } : {}),
        // eslint-disable-next-line react-hooks/purity -- Date.now() runs inside an async event handler, not render.
        lastModifiedAt: Date.now(),
      },
    });
  }

  async function add() {
    const label = draft.trim();
    const field: CustomField = { id: crypto.randomUUID(), label };
    const next = [...fields, field];
    const problem = problemFor(next);
    if (problem) {
      setError({ id: 'new', message: problem });
      return;
    }
    setError(null);
    // A series that sets its own columns gets the new field's column at the
    // end of its competitor columns; automatic columns show it anyway.
    await persist(
      next,
      series.resultsColumns ? withCompetitorColumn(series.resultsColumns, `field:${field.id}`) : undefined,
    );
    setDraft('');
    setAdding(false);
  }

  async function rename(id: string, raw: string) {
    const label = raw.trim();
    const current = fields.find((f) => f.id === id);
    if (!current || current.label === label) {
      setError(null);
      return;
    }
    const next = fields.map((f) => (f.id === id ? { ...f, label } : f));
    const problem = problemFor(next);
    if (problem) {
      setError({ id, message: problem });
      return;
    }
    setError(null);
    await persist(next);
  }

  async function remove(field: CustomField) {
    const holders = (competitors ?? []).filter((c) => c.customFields?.[field.id]?.trim());
    if (holders.length > 0) {
      const ok = await confirm({
        title: `Delete ${field.label}?`,
        description: `${field.label} holds values for ${holders.length} ${holders.length === 1 ? 'competitor' : 'competitors'}. Deleting it removes them.`,
        confirmLabel: 'Delete field',
        destructive: true,
      });
      if (!ok) return;
      await saveCompetitors.mutateAsync(
        holders.map((c) => {
          const values = { ...c.customFields };
          delete values[field.id];
          const { customFields: _dropped, ...rest } = c;
          return Object.keys(values).length > 0 ? { ...rest, customFields: values } : rest;
        }),
      );
    }
    await persist(
      fields.filter((f) => f.id !== field.id),
      series.resultsColumns ? withoutColumn(series.resultsColumns, `field:${field.id}`) : undefined,
    );
  }

  if (!canEdit && fields.length === 0) return null;

  return (
    <div className="space-y-2 pt-2 border-t">
      <p className="text-sm font-medium">Custom fields</p>
      <p className="text-xs text-muted-foreground">
        Text the organisers publish that no field above holds. Not used for scoring, prizes or
        grouping. A Division or Category goes in a subdivision instead.
      </p>
      {fields.map((field) => (
        <div key={field.id} className="space-y-1">
          <div className="flex items-center gap-2">
            {canEdit ? (
              <Input
                key={`${field.id}:${field.label}`}
                aria-label={`${field.label} field name`}
                defaultValue={field.label}
                maxLength={CUSTOM_FIELD_LABEL_MAX_LENGTH}
                onBlur={(e) => rename(field.id, e.target.value)}
                className="max-w-xs"
              />
            ) : (
              <span className="text-sm">{field.label}</span>
            )}
            {canEdit && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs text-muted-foreground"
                onClick={() => remove(field)}
              >
                Delete
              </Button>
            )}
          </div>
          {error?.id === field.id && <p className="text-xs text-destructive">{error.message}</p>}
        </div>
      ))}
      {canEdit &&
        (adding ? (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Label htmlFor="new-custom-field" className="sr-only">
                Name of the new field
              </Label>
              <Input
                id="new-custom-field"
                autoFocus
                value={draft}
                maxLength={CUSTOM_FIELD_LABEL_MAX_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void add();
                  }
                }}
                className="max-w-xs"
              />
              <Button type="button" size="sm" className="h-8" onClick={() => void add()}>
                Add
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={() => {
                  setAdding(false);
                  setDraft('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
            {error?.id === 'new' && <p className="text-xs text-destructive">{error.message}</p>}
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setAdding(true)}
          >
            Add a field
          </Button>
        ))}
    </div>
  );
}
