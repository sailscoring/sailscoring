'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { queryKeys } from '@/hooks/query-keys';
import { raceRepo, type HandicapUpdateRow } from '@/lib/api-repository';
import type { IrcTccVariant } from '@/lib/rating-match';
import type {
  FleetAdditionCandidate,
  HandicapSystem,
  PreviewRow,
  RatingMatch,
} from '@/lib/source-handicaps';
import type { Competitor, Fleet } from '@/lib/types';

export type HandicapSource = 'series' | 'irish-sailing' | 'irc-rating' | 'vprs-rating' | 'rya-py';

export const SYSTEM_LABEL: Record<HandicapSystem, string> = {
  nhc: 'NHC',
  echo: 'ECHO',
  irc: 'IRC',
  vprs: 'VPRS',
  py: 'PY',
};

/** The TCF field on `Competitor` written for each handicap system. */
export const SYSTEM_FIELD: Record<HandicapSystem, keyof Pick<Competitor, 'nhcStartingTcf' | 'echoStartingTcf' | 'ircTcc' | 'vprsTcc' | 'pyNumber'>> = {
  nhc: 'nhcStartingTcf',
  echo: 'echoStartingTcf',
  irc: 'ircTcc',
  vprs: 'vprsTcc',
  py: 'pyNumber',
};

export function rowKey(r: PreviewRow): string {
  return `${r.competitorId}::${r.targetFleetId}::${r.system}`;
}

export function formatTcf(v: number | null, system: HandicapSystem): string {
  if (v === null) return '—';
  // PY numbers are integers; the three TCFs are decimal, always 3 dp
  // (even when the stored value happens to be a round number).
  return system === 'py' ? String(Math.round(v)) : v.toFixed(3);
}

/** System label for a preview row — IRC rows from Irish Sailing also show
 *  which TCC variant was used, so a mixed spin/non-spin run is auditable. */
export function systemLabel(r: PreviewRow): string {
  if ((r.system === 'irc' || r.system === 'vprs') && r.ircVariant) {
    return `${SYSTEM_LABEL[r.system]} (${r.ircVariant === 'non-spin' ? 'non-spin' : 'spin'})`;
  }
  return SYSTEM_LABEL[r.system];
}

/** Human description of a non-exact Irish Sailing match, for the scorer to
 *  verify the right boat was picked. */
export function describeMatch(m: RatingMatch): string {
  const who = `${m.sail}${m.name ? ` · ${m.name}` : ''}`;
  return m.method === 'name'
    ? `matched by name → ${who}`
    : `matched without country code → ${who}`;
}

export function formatDelta(currentTcf: number | null, newTcf: number, system: HandicapSystem): string {
  if (currentTcf === null) return `+${formatTcf(newTcf, system)}`;
  const d = newTcf - currentTcf;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  if (d === 0) return '0';
  return `${sign}${formatTcf(Math.abs(d), system)}`;
}

// ── The shell ↔ step contract ───────────────────────────────────────────────

/** What a source step hands the shell alongside the planned rows — every
 *  ingredient of the done-step summary except the server's updated count. */
export interface ApplyOutcome {
  bySystem: Partial<Record<HandicapSystem, number>>;
  unchanged: number;
  notFound: number;
  added: number;
  /** RYA PY source: how many boats had their class name normalised. */
  renamed?: number;
}

/**
 * Props every per-source step receives from the shell. A step owns its own
 * state and data fetching, plans its update rows, and emits them via
 * `onApply`; the shell owns nothing about how a source plans. `competitors`
 * and `fleets` are the target series' (undefined while still loading,
 * mirroring the queries the shell holds).
 */
export interface SourceStepProps {
  seriesId: string;
  competitors: Competitor[] | undefined;
  fleets: Fleet[] | undefined;
  /** The shell's mutation is in flight. */
  applying: boolean;
  /** The shell's last apply error (409 conflict or other), shown in-step. */
  errorMsg: string | null;
  onApply: (rows: HandicapUpdateRow[], outcome: ApplyOutcome) => void;
  onCancel: () => void;
}

// ── Row planning shared by the preview-based sources ────────────────────────

export interface PreviewSplit {
  changedRows: PreviewRow[];
  unchangedRows: PreviewRow[];
  notFoundRows: PreviewRow[];
  /** Changed rows the scorer hasn't unticked — the ones an apply writes. */
  appliedChangeRows: PreviewRow[];
}

export function splitPreviewRows(
  previewRows: PreviewRow[],
  excludedRowIds: Set<string>,
): PreviewSplit {
  const changedRows = previewRows.filter((r) => r.status === 'change');
  return {
    changedRows,
    unchangedRows: previewRows.filter((r) => r.status === 'unchanged'),
    notFoundRows: previewRows.filter((r) => r.status === 'not-found'),
    appliedChangeRows: changedRows.filter((r) => !excludedRowIds.has(rowKey(r))),
  };
}

/** Done-step summary for a preview-based apply: per-system counts over the
 *  rows actually applied, plus the unchanged / not-found / added tallies. */
export function previewOutcome(split: PreviewSplit, added: number): ApplyOutcome {
  const bySystem: Partial<Record<HandicapSystem, number>> = {};
  for (const row of split.appliedChangeRows) {
    bySystem[row.system] = (bySystem[row.system] ?? 0) + 1;
  }
  return {
    bySystem,
    unchanged: split.unchangedRows.length,
    notFound: split.notFoundRows.length,
    added,
  };
}

/**
 * Fan applied change rows and checked fleet additions out to per-competitor
 * CAS update rows. A boat with both an update and an addition gets one row
 * (one CAS write), with the addition unioning the target fleet in.
 */
export function buildPreviewUpdateRows(
  changeRows: PreviewRow[],
  additions: FleetAdditionCandidate[],
  competitorById: Map<string, Competitor>,
): HandicapUpdateRow[] {
  const updatesByComp = new Map<string, HandicapUpdateRow>();
  function rowFor(competitorId: string): HandicapUpdateRow | null {
    const comp = competitorById.get(competitorId);
    if (!comp || comp.version === undefined) return null;
    let update = updatesByComp.get(comp.id);
    if (!update) {
      update = { competitorId: comp.id, expectedVersion: comp.version };
      updatesByComp.set(comp.id, update);
    }
    return update;
  }

  for (const row of changeRows) {
    const update = rowFor(row.competitorId);
    if (!update) continue;
    const field = SYSTEM_FIELD[row.system];
    // Mutate via an unknown-cast index access — TS can't see that the
    // field name is statically one of the four optional number fields
    // on `HandicapUpdateRow`. Safe by construction (SYSTEM_FIELD maps
    // each HandicapSystem to the matching field) and the wire schema
    // validates on the server.
    (update as unknown as Record<string, number>)[field] = row.newTcf!;
  }

  for (const c of additions) {
    const update = rowFor(c.competitorId);
    if (!update || !c.targetFleetId || c.proposedTcf === null) continue;
    update.addFleetIds = [...new Set([...(update.addFleetIds ?? []), c.targetFleetId])];
    const field = SYSTEM_FIELD[c.system];
    (update as unknown as Record<string, number>)[field] = c.proposedTcf;
  }

  return [...updatesByComp.values()];
}

// ── State machinery shared by the rating-list sources (IRC, Irish Sailing) ──

/** The selection state a rating-list step holds: the match-by-name toggle,
 *  per-boat certificate overrides, the add-to-fleet ticks and their target
 *  fleets, and the preview rows the scorer has unticked. */
export function useRatingListSelections() {
  const [matchByName, setMatchByName] = useState(false);
  // Per-boat certificate override (boats holding a primary + secondary "(SC)").
  const [certChoiceByCompetitor, setCertChoiceByCompetitor] = useState<Record<string, string>>({});
  // Add-to-fleet (#170): which candidates are ticked, and each one's target fleet.
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addTargetFleetByKey, setAddTargetFleetByKey] = useState<Record<string, string>>({});
  const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set());

  return {
    matchByName,
    setMatchByName,
    certChoiceByCompetitor,
    chooseCert: (competitorId: string, certId: string) =>
      setCertChoiceByCompetitor((prev) => ({ ...prev, [competitorId]: certId })),
    addSelected,
    toggleAddition: (key: string, on: boolean) =>
      setAddSelected((prev) => {
        const next = new Set(prev);
        if (on) next.add(key);
        else next.delete(key);
        return next;
      }),
    addTargetFleetByKey,
    chooseAdditionFleet: (key: string, fleetId: string) =>
      setAddTargetFleetByKey((prev) => ({ ...prev, [key]: fleetId })),
    excludedRowIds,
    toggleRow: (key: string, included: boolean) =>
      setExcludedRowIds((prev) => {
        const next = new Set(prev);
        if (included) next.delete(key);
        else next.add(key);
        return next;
      }),
  };
}

/** Whether the target series has any races — drives the DNC caution shown
 *  on fleet additions. */
export function useSeriesHasRaces(seriesId: string): boolean {
  const targetRaces = useQuery({
    queryKey: queryKeys.races.bySeries(seriesId),
    queryFn: () => raceRepo.listBySeries(seriesId),
  });
  return (targetRaces.data?.length ?? 0) > 0;
}

// ── Small shared UI pieces ──────────────────────────────────────────────────

export function MatchByNameCheckbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer">
      <input
        type="checkbox"
        className="mt-0.5 h-3.5 w-3.5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        Also match by boat name
        <span className="block text-xs text-muted-foreground">
          Helps when a sail number is entered without its country code or doesn&apos;t
          match. Names collide more easily — check the proposed boat before applying.
        </span>
      </span>
    </label>
  );
}

/** Per-fleet spin/non-spin selector for the IRC and VPRS sources. The label
 *  wording differs slightly between the two (IRC says "Non-spinnaker", VPRS
 *  "No-spinnaker"), so the variant strings come in as props. */
export function FleetVariantSelector({
  heading,
  fleets,
  variantByFleet,
  onChange,
  nonSpinLabel,
  hint,
}: {
  heading: string;
  fleets: Fleet[];
  variantByFleet: Record<string, IrcTccVariant>;
  onChange: (fleetId: string, variant: IrcTccVariant) => void;
  nonSpinLabel: string;
  hint: string;
}) {
  if (fleets.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{heading}</div>
      <div className="rounded-md border">
        {fleets.map((f, i) => (
          <div
            key={f.id}
            className={`flex items-center gap-3 p-2 ${i > 0 ? 'border-t' : ''}`}
          >
            <div className="flex-1 text-sm font-medium">{f.name}</div>
            <Select
              value={variantByFleet[f.id] ?? 'spin'}
              onValueChange={(v) => onChange(f.id, v as IrcTccVariant)}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="spin">Spinnaker TCC</SelectItem>
                <SelectItem value="non-spin">{nonSpinLabel}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

/** Every step's footer: Cancel plus an "Apply N" button. */
export function StepFooter({
  onCancel,
  onApply,
  disabled,
  applying,
  count,
}: {
  onCancel: () => void;
  onApply: () => void;
  disabled: boolean;
  applying: boolean;
  count: number;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel}>Cancel</Button>
      <Button onClick={onApply} disabled={disabled}>
        {applying ? 'Applying…' : `Apply ${count}`}
      </Button>
    </DialogFooter>
  );
}
