'use client';

import { useId, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { NationalityInput } from '@/components/nationality-input';
import { useUpdateCompetitorsField } from '@/hooks/use-competitors';
import {
  COMPETITOR_FIELD_LABELS,
  subdivisionAxisLabel,
} from '@/lib/competitor-fields';
import type { CompetitorFieldPatch } from '@/lib/repository';
import type { Competitor, CompetitorFieldKey, SubdivisionAxis } from '@/lib/types';

/** One choice in the field dropdown. Subdivision axes contribute one entry
 *  each, so "Division" and "Age category" are picked directly by name. */
export interface BulkEditFieldOption {
  key: string;
  label: string;
  input: 'text' | 'nationality' | 'gender';
  patchFor: (value: string) => CompetitorFieldPatch;
  /** Reads the field off a competitor, feeding the datalist of existing
   *  values — inconsistencies ("HYC" vs "Howth YC") show up right where the
   *  scorer is about to fix them. */
  suggestionFrom?: (c: Competitor) => string | undefined;
}

/**
 * The fields the bulk editor offers: descriptive/grouping fields only,
 * honouring the series' enabled-fields settings. Identity fields (sail
 * number, names) and handicap ratings (served by Update Handicaps, which
 * has freeze-past semantics) are deliberately excluded.
 */
export function bulkEditFieldOptions(
  enabledFields: readonly CompetitorFieldKey[],
  axes: readonly SubdivisionAxis[],
): BulkEditFieldOption[] {
  const options: BulkEditFieldOption[] = [];
  if (enabledFields.includes('club')) {
    options.push({
      key: 'club',
      label: COMPETITOR_FIELD_LABELS.club,
      input: 'text',
      patchFor: (value) => ({ field: 'club', value }),
      suggestionFrom: (c) => c.club,
    });
  }
  if (enabledFields.includes('boatClass')) {
    options.push({
      key: 'boatClass',
      label: COMPETITOR_FIELD_LABELS.boatClass,
      input: 'text',
      patchFor: (value) => ({ field: 'boatClass', value }),
      suggestionFrom: (c) => c.boatClass,
    });
  }
  if (enabledFields.includes('nationality')) {
    options.push({
      key: 'nationality',
      label: COMPETITOR_FIELD_LABELS.nationality,
      input: 'nationality',
      patchFor: (value) => ({ field: 'nationality', value }),
    });
  }
  if (enabledFields.includes('gender')) {
    options.push({
      key: 'gender',
      label: COMPETITOR_FIELD_LABELS.gender,
      input: 'gender',
      patchFor: (value) => ({ field: 'gender', value: value as Competitor['gender'] }),
    });
  }
  if (enabledFields.includes('subdivision')) {
    for (const axis of axes) {
      options.push({
        key: `subdivision:${axis.id}`,
        label: subdivisionAxisLabel(axis),
        input: 'text',
        patchFor: (value) => ({ field: 'subdivision', axisId: axis.id, value }),
        suggestionFrom: (c) => c.subdivisions?.[axis.id],
      });
    }
  }
  return options;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seriesId: string;
  /** The current selection; the write targets exactly these. */
  selected: Competitor[];
  /** Every competitor in the series, for the existing-value suggestions. */
  allCompetitors: Competitor[];
  options: BulkEditFieldOption[];
  /** Result line for the page's status area, e.g. `Set club to "HYC" for 12 competitors.` */
  onApplied: (message: string) => void;
}

/**
 * "Set field…" bulk editor: writes one field to one value across the
 * selected competitors in a single round-trip. An empty value clears the
 * field — the confirm button says so before anything happens.
 */
export function CompetitorBulkEditDialog({
  open,
  onOpenChange,
  seriesId,
  selected,
  allCompetitors,
  options,
  onApplied,
}: Props) {
  const [fieldKey, setFieldKey] = useState<string | null>(null);
  const [value, setValue] = useState('');
  const update = useUpdateCompetitorsField();
  const listId = useId();

  // The last-used field persists across opens (repeat fix-ups target the
  // same column); fall back to the first option until one is chosen.
  const option = options.find((o) => o.key === fieldKey) ?? options[0];

  const suggestions = useMemo(() => {
    if (!option?.suggestionFrom) return [];
    const values = new Set<string>();
    for (const c of allCompetitors) {
      const v = option.suggestionFrom(c)?.trim();
      if (v) values.add(v);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [allCompetitors, option]);

  const n = selected.length;
  const noun = `${n} competitor${n === 1 ? '' : 's'}`;
  const trimmed = value.trim();

  function handleOpenChange(next: boolean) {
    if (!next) setValue('');
    onOpenChange(next);
  }

  async function handleApply() {
    if (!option || n === 0) return;
    await update.mutateAsync({
      seriesId,
      ids: selected.map((c) => c.id),
      patch: option.patchFor(trimmed),
    });
    onApplied(
      trimmed
        ? `Set ${option.label.toLowerCase()} to "${trimmed}" for ${noun}.`
        : `Cleared ${option.label.toLowerCase()} for ${noun}.`,
    );
    handleOpenChange(false);
  }

  if (!option) return null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set a field on {noun}</DialogTitle>
          <DialogDescription>
            Writes one value to every selected competitor. Leave the value
            empty to clear the field instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Field</Label>
            <Select
              value={option.key}
              onValueChange={(k) => {
                setFieldKey(k);
                setValue('');
              }}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((o) => (
                  <SelectItem key={o.key} value={o.key}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bulk-edit-value">Value</Label>
            {option.input === 'text' && (
              <>
                <Input
                  id="bulk-edit-value"
                  list={listId}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder={`New ${option.label.toLowerCase()}…`}
                />
                <datalist id={listId}>
                  {suggestions.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </>
            )}
            {option.input === 'nationality' && (
              <NationalityInput id="bulk-edit-value" value={value} onChange={setValue} />
            )}
            {option.input === 'gender' && (
              // Radix Select items can't carry an empty-string value, so
              // "Not set" maps through a sentinel to the cleared state.
              <Select
                value={value || 'none'}
                onValueChange={(v) => setValue(v === 'none' ? '' : v)}
              >
                <SelectTrigger id="bulk-edit-value">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="M">M</SelectItem>
                  <SelectItem value="F">F</SelectItem>
                  <SelectItem value="none">Not set</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={update.isPending || n === 0}>
            {trimmed ? `Apply to ${noun}` : `Clear for ${noun}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
