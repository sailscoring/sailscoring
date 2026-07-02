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
import type { Competitor, CompetitorFieldKey, Fleet, SubdivisionAxis } from '@/lib/types';

/** One choice in the field dropdown. Subdivision axes contribute one entry
 *  each, so "Division" and "Age category" are picked directly by name.
 *  Fleet is its own kind: membership is a set, so instead of a value box it
 *  offers a fleet picker with an add/remove choice. */
export type BulkEditFieldOption =
  | {
      key: string;
      label: string;
      input: 'text' | 'nationality' | 'gender';
      patchFor: (value: string) => CompetitorFieldPatch;
      /** Reads the field off a competitor, feeding the datalist of existing
       *  values — inconsistencies ("HYC" vs "Howth YC") show up right where
       *  the scorer is about to fix them. */
      suggestionFrom?: (c: Competitor) => string | undefined;
    }
  | { key: 'fleet'; label: string; input: 'fleet'; fleets: Fleet[] };

/**
 * The fields the bulk editor offers: descriptive/grouping fields only,
 * honouring the series' enabled-fields settings. Identity fields (sail
 * number, names) and handicap ratings (served by Update Handicaps, which
 * has freeze-past semantics) are deliberately excluded. Fleet appears only
 * when the series has more than one fleet — single-fleet series never show
 * fleets anywhere.
 */
export function bulkEditFieldOptions(
  enabledFields: readonly CompetitorFieldKey[],
  axes: readonly SubdivisionAxis[],
  fleets: readonly Fleet[],
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
  if (fleets.length > 1) {
    options.push({ key: 'fleet', label: 'Fleet', input: 'fleet', fleets: [...fleets] });
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
  const [fleetId, setFleetId] = useState('');
  const [fleetOp, setFleetOp] = useState<'add' | 'remove'>('add');
  const update = useUpdateCompetitorsField();
  const listId = useId();

  // The last-used field persists across opens (repeat fix-ups target the
  // same column); fall back to the first option until one is chosen.
  const option = options.find((o) => o.key === fieldKey) ?? options[0];

  const suggestions = useMemo(() => {
    if (option?.input === 'fleet' || !option?.suggestionFrom) return [];
    const values = new Set<string>();
    for (const c of allCompetitors) {
      const v = option.suggestionFrom(c)?.trim();
      if (v) values.add(v);
    }
    return [...values].sort((a, b) => a.localeCompare(b));
  }, [allCompetitors, option]);

  // Fleet mode: work out, from the rows in front of the scorer, what the op
  // would actually change — boats already in (or not in) the fleet don't
  // count, a remove keeps boats whose only fleet is the target, and an add
  // that would duplicate a sail number within the fleet is blocked. The
  // server re-derives all of this; the client's copy powers the button
  // label, the hint line, and the status message.
  const fleetPlan = useMemo(() => {
    if (option?.input !== 'fleet') return null;
    const fleet = option.fleets.find((f) => f.id === fleetId) ?? option.fleets[0];
    if (!fleet) return null;
    if (fleetOp === 'add') {
      const eligible = selected.filter((c) => !c.fleetIds.includes(fleet.id));
      const sailsInFleet = new Set(
        allCompetitors
          .filter((c) => c.fleetIds.includes(fleet.id))
          .map((c) => c.sailNumber.trim().toUpperCase()),
      );
      const collisions = new Set<string>();
      for (const c of eligible) {
        const sail = c.sailNumber.trim().toUpperCase();
        if (sailsInFleet.has(sail)) collisions.add(sail);
        sailsInFleet.add(sail);
      }
      return { fleet, count: eligible.length, kept: 0, collisions: [...collisions].sort() };
    }
    const members = selected.filter((c) => c.fleetIds.includes(fleet.id));
    const eligible = members.filter((c) => c.fleetIds.length > 1);
    return {
      fleet,
      count: eligible.length,
      kept: members.length - eligible.length,
      collisions: [] as string[],
    };
  }, [option, fleetId, fleetOp, selected, allCompetitors]);

  const n = selected.length;
  const noun = `${n} competitor${n === 1 ? '' : 's'}`;
  const trimmed = value.trim();

  function handleOpenChange(next: boolean) {
    if (!next) {
      setValue('');
      setFleetOp('add');
    }
    onOpenChange(next);
  }

  async function handleApply() {
    if (!option || n === 0) return;
    if (option.input === 'fleet') {
      if (!fleetPlan || fleetPlan.count === 0 || fleetPlan.collisions.length > 0) return;
      await update.mutateAsync({
        seriesId,
        ids: selected.map((c) => c.id),
        patch: { field: 'fleet', fleetId: fleetPlan.fleet.id, op: fleetOp },
      });
      const changedNoun = `${fleetPlan.count} competitor${fleetPlan.count === 1 ? '' : 's'}`;
      onApplied(
        fleetOp === 'add'
          ? `Added ${changedNoun} to ${fleetPlan.fleet.name}.`
          : `Removed ${changedNoun} from ${fleetPlan.fleet.name}.` +
              (fleetPlan.kept > 0
                ? ` ${fleetPlan.kept} kept — a competitor must belong to at least one fleet.`
                : ''),
      );
      handleOpenChange(false);
      return;
    }
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
            {option.input === 'fleet'
              ? 'Adds or removes every selected competitor from a fleet.'
              : 'Writes one value to every selected competitor. Leave the value empty to clear the field instead.'}
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
          {option.input === 'fleet' && fleetPlan && (
            <>
              <div className="space-y-1.5">
                <Label>Action</Label>
                <Select
                  value={fleetOp}
                  onValueChange={(v) => setFleetOp(v as 'add' | 'remove')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="add">Add to fleet</SelectItem>
                    <SelectItem value="remove">Remove from fleet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bulk-edit-value">Fleet</Label>
                <Select value={fleetPlan.fleet.id} onValueChange={setFleetId}>
                  <SelectTrigger id="bulk-edit-value">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {option.fleets.map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {fleetPlan.collisions.length > 0 && (
                <p className="text-sm text-destructive">
                  Adding would duplicate sail number
                  {fleetPlan.collisions.length === 1 ? '' : 's'} in{' '}
                  {fleetPlan.fleet.name}: {fleetPlan.collisions.join(', ')}.
                </p>
              )}
              {fleetOp === 'add' &&
                fleetPlan.collisions.length === 0 &&
                fleetPlan.count < n && (
                  <p className="text-sm text-muted-foreground">
                    {fleetPlan.count === 0
                      ? `All selected competitors are already in ${fleetPlan.fleet.name}.`
                      : `${n - fleetPlan.count} of the selection ${n - fleetPlan.count === 1 ? 'is' : 'are'} already in ${fleetPlan.fleet.name}.`}
                  </p>
                )}
              {fleetOp === 'remove' && fleetPlan.kept > 0 && (
                <p className="text-sm text-muted-foreground">
                  {fleetPlan.kept} of the selection will be kept — a competitor
                  must belong to at least one fleet.
                </p>
              )}
              {fleetOp === 'remove' &&
                fleetPlan.count === 0 &&
                fleetPlan.kept === 0 && (
                  <p className="text-sm text-muted-foreground">
                    None of the selected competitors are in {fleetPlan.fleet.name}.
                  </p>
                )}
            </>
          )}
          {option.input !== 'fleet' && (
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
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          {option.input === 'fleet' ? (
            <Button
              onClick={handleApply}
              disabled={
                update.isPending ||
                n === 0 ||
                !fleetPlan ||
                fleetPlan.count === 0 ||
                fleetPlan.collisions.length > 0
              }
            >
              {fleetPlan
                ? fleetOp === 'add'
                  ? `Add to ${fleetPlan.fleet.name}`
                  : `Remove from ${fleetPlan.fleet.name}`
                : 'Apply'}
            </Button>
          ) : (
            <Button onClick={handleApply} disabled={update.isPending || n === 0}>
              {trimmed ? `Apply to ${noun}` : `Clear for ${noun}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
