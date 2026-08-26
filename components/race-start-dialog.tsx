'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ORC_STANDARD_OPTIONS, orcOptionKind, orcSelectableOptions } from '@/lib/orc-certificate';
import { normalizeTimeInput } from '@/lib/time-parse';
import type { Competitor, Fleet, OrcCourseLeg, RaceStart } from '@/lib/types';

export type RaceStartDialogMode =
  | { kind: 'add' }
  | { kind: 'edit'; start: RaceStart };

export interface RaceStartDraft {
  editingId: string | null;
  startTime?: string;  // omitted for a membership-only start (fleets, no gun time)
  fleetIds: string[];
  /** Course length in NM — a scoring input for time-on-distance fleets. */
  distanceNm?: number;
  /** RC PCS scoring-wind override in kt (ORC rule 402.12). */
  orcScoringWind?: number;
  /** Constructed-course legs (ORC rule 402.5), in sailing order. */
  courseLegs?: OrcCourseLeg[];
  /** The ORC scoring option for this start's races — overrides the fleet
   *  default, and decides the method (single number, band, or PCS). */
  orcOption?: string;
}

export interface RaceStartDialogProps {
  /** When non-null, the dialog is open. */
  mode: RaceStartDialogMode | null;
  raceStarts: RaceStart[];
  fleets: Fleet[];
  /** The series' competitors, when the caller has them — the ORC
   *  scoring-option picker offers the certificate-derived rating fields
   *  alongside the standard set. */
  competitors?: Competitor[];
  onSave: (draft: RaceStartDraft) => void | Promise<void>;
  onCancel: () => void;
}

export function RaceStartDialog(props: RaceStartDialogProps) {
  // Remount per open so form state is fresh; no seed effect needed.
  if (!props.mode) return null;
  return (
    <RaceStartDialogInner
      key={props.mode.kind === 'edit' ? props.mode.start.id : 'add'}
      {...props}
      mode={props.mode}
    />
  );
}

function RaceStartDialogInner({
  mode,
  raceStarts,
  fleets,
  competitors,
  onSave,
  onCancel,
}: RaceStartDialogProps & { mode: RaceStartDialogMode }) {
  const seed = mode.kind === 'edit' ? mode.start : null;
  const [startTimeInput, setStartTimeInput] = useState(seed?.startTime ?? '');
  const [fleetIds, setFleetIds] = useState<string[]>(seed?.fleetIds ?? []);
  const [distanceInput, setDistanceInput] = useState(
    seed?.distanceNm != null ? String(seed.distanceNm) : '',
  );
  const [scoringWindInput, setScoringWindInput] = useState(
    seed?.orcScoringWind != null ? String(seed.orcScoringWind) : '',
  );
  const [error, setError] = useState('');

  // The scoring-option picker: the start's option decides how its races are
  // scored, overriding each ORC fleet's default. Offered whenever the series
  // scores ORC at all; the catalog is the international standard set plus
  // the single-number fields the stored certificates carry.
  const hasOrcFleet = fleets.some((f) => f.scoringSystem === 'orc');
  const certificateOptions = hasOrcFleet ? orcSelectableOptions(competitors ?? []) : [];
  const [orcOptionValue, setOrcOptionValue] = useState(seed?.orcOption ?? '');
  const offerOption = hasOrcFleet || Boolean(seed?.orcOption);
  const selectedKind = orcOptionValue ? orcOptionKind(orcOptionValue) : null;
  // Course distance is a scoring input for ORC time-on-distance (and shown
  // whenever the series scores ORC at all, so the habit forms before the
  // first ToD race rather than during it). The scoring-wind override only
  // applies to Performance Curve Scoring, so it appears when this start or
  // some fleet's default resolves to PCS — or when a value is stored.
  const offerDistance = hasOrcFleet;
  const offerScoringWind =
    selectedKind === 'pcs' ||
    fleets.some((f) => f.scoringSystem === 'orc' && f.orcProfile?.kind === 'pcs') ||
    seed?.orcScoringWind != null;
  // Constructed-course legs, for races scored PCS over the actual course.
  const offerLegs =
    orcOptionValue === 'CC' ||
    fleets.some(
      (f) => f.scoringSystem === 'orc' && f.orcProfile?.kind === 'pcs' && f.orcProfile.option === 'CC',
    ) || Boolean(seed?.courseLegs?.length);
  interface LegRow { distance: string; bearing: string; wind: string }
  const [legRows, setLegRows] = useState<LegRow[]>(
    (seed?.courseLegs ?? []).map((leg) => ({
      distance: String(leg.distanceNm),
      bearing: String(leg.bearingDeg),
      wind: String(leg.windDirectionDeg),
    })),
  );
  const legsTotal = legRows.reduce((sum, r) => sum + (Number(r.distance) || 0), 0);
  // A gentle nudge when the chosen option needs course data the start lacks;
  // saving is still allowed — the race falls back to scratch until the
  // course is recorded, matching how the engine scores it.
  const optionHint =
    orcOptionValue === 'CC' && legsTotal === 0
      ? 'Constructed-course scoring needs the course legs below.'
      : (selectedKind === 'tod' || (selectedKind === 'pcs' && orcOptionValue !== 'CC')) && !distanceInput.trim()
        ? 'This option needs the course length below to score.'
        : null;
  function setLegRow(i: number, field: keyof LegRow, value: string) {
    setLegRows((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
    setError('');
  }

  function handleSave() {
    // A blank time is allowed: a membership-only start declares which fleets
    // are in the race (scoping #226) without a gun time. A non-blank time must
    // still parse.
    let normalizedStart: string | undefined;
    if (startTimeInput.trim()) {
      const parsed = normalizeTimeInput(startTimeInput);
      if (!parsed) {
        setError('Enter a valid time, e.g. 14:05:00 or 140500 — or leave blank for fleets only.');
        return;
      }
      normalizedStart = parsed;
    }
    if (fleetIds.length === 0) {
      setError('Select at least one fleet.');
      return;
    }
    let distanceNm: number | undefined;
    if (distanceInput.trim()) {
      const parsed = Number(distanceInput.trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Enter the course length as a positive number of nautical miles, e.g. 3.24.');
        return;
      }
      distanceNm = parsed;
    }
    let courseLegs: OrcCourseLeg[] | undefined;
    const nonEmptyLegs = legRows.filter((r) => r.distance.trim() || r.bearing.trim() || r.wind.trim());
    if (nonEmptyLegs.length > 0) {
      courseLegs = [];
      for (const row of nonEmptyLegs) {
        const distance = Number(row.distance.trim());
        const bearing = Number(row.bearing.trim());
        const wind = Number(row.wind.trim());
        if (
          !Number.isFinite(distance) || distance <= 0 ||
          !Number.isFinite(bearing) || bearing < 0 || bearing > 360 ||
          !Number.isFinite(wind) || wind < 0 || wind > 360
        ) {
          setError('Each course leg needs a distance in NM and bearings in degrees (0–360).');
          return;
        }
        courseLegs.push({ distanceNm: distance, bearingDeg: bearing, windDirectionDeg: wind });
      }
    }
    let orcScoringWind: number | undefined;
    if (scoringWindInput.trim()) {
      const parsed = Number(scoringWindInput.trim());
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
        setError('Enter the scoring wind as knots, e.g. 14 — or leave blank to use the implied wind.');
        return;
      }
      orcScoringWind = parsed;
    }
    const editingId = mode.kind === 'edit' ? mode.start.id : null;
    const otherStarts = raceStarts.filter((s) => s.id !== editingId);
    const usedFleetIds = new Set(otherStarts.flatMap((s) => s.fleetIds));
    const conflict = fleetIds.find((id) => usedFleetIds.has(id));
    if (conflict) {
      const name = fleets.find((f) => f.id === conflict)?.name ?? conflict;
      setError(`Fleet "${name}" is already in another start group.`);
      return;
    }
    void onSave({
      editingId,
      startTime: normalizedStart,
      fleetIds,
      ...(distanceNm != null ? { distanceNm } : {}),
      ...(orcScoringWind != null ? { orcScoringWind } : {}),
      ...(courseLegs ? { courseLegs } : {}),
      ...(orcOptionValue ? { orcOption: orcOptionValue } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>{mode.kind === 'edit' ? 'Edit start' : 'Add start'}</DialogTitle>
          <DialogDescription>
            Record the gun time for a group of fleets, or leave it blank to just
            declare which fleets are in this race.
          </DialogDescription>
        </DialogHeader>
        {/* The body scrolls: a constructed-course legs list can outgrow the
            viewport, and Save must stay reachable. */}
        <div className="space-y-4 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Gun time <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
              value={startTimeInput}
              onChange={(e) => { setStartTimeInput(e.target.value); setError(''); }}
              placeholder="14:05:00"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>
          {offerOption && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Scoring option <span className="font-normal text-muted-foreground">(this start)</span>
              </label>
              <Select
                value={orcOptionValue || '__default__'}
                onValueChange={(v) => { setOrcOptionValue(v === '__default__' ? '' : v); setError(''); }}
              >
                <SelectTrigger className="w-full" data-testid="start-orc-option">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Fleet default</SelectItem>
                  {ORC_STANDARD_OPTIONS.map((o) => (
                    <SelectItem key={o.option} value={o.option}>
                      {o.label}
                    </SelectItem>
                  ))}
                  {certificateOptions.map((o) => (
                    <SelectItem key={o.option} value={o.option}>
                      <span className="font-mono text-xs">{o.option}</span>
                    </SelectItem>
                  ))}
                  {orcOptionValue
                    && !ORC_STANDARD_OPTIONS.some((o) => o.option === orcOptionValue)
                    && !certificateOptions.some((o) => o.option === orcOptionValue) && (
                    <SelectItem value={orcOptionValue}>
                      <span className="font-mono text-xs">{orcOptionValue}</span>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How this start&apos;s races are scored — the option the race
                committee announced: a certificate single number, a wind band,
                or performance curves. Overrides the fleet&apos;s default;
                changing it later re-scores without re-entering finishes.
              </p>
              {optionHint && <p className="text-xs text-amber-600 dark:text-amber-500">{optionHint}</p>}
            </div>
          )}
          {offerDistance && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="start-distance-nm">
                Course length <span className="font-normal text-muted-foreground">(NM, optional)</span>
              </label>
              <input
                id="start-distance-nm"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
                value={distanceInput}
                onChange={(e) => { setDistanceInput(e.target.value); setError(''); }}
                placeholder="3.24"
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              <p className="text-xs text-muted-foreground">
                Required to score a time-on-distance fleet; record it to 0.01 NM.
              </p>
            </div>
          )}
          {offerLegs && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Course legs</label>
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-xs text-muted-foreground">
                  <span>Distance (NM)</span>
                  <span>Bearing (°)</span>
                  <span>Wind dir (°)</span>
                  <span />
                </div>
                {legRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
                    <input
                      aria-label={`Leg ${i + 1} distance`}
                      className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                      value={row.distance}
                      inputMode="decimal"
                      onChange={(e) => setLegRow(i, 'distance', e.target.value)}
                    />
                    <input
                      aria-label={`Leg ${i + 1} bearing`}
                      className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                      value={row.bearing}
                      inputMode="decimal"
                      onChange={(e) => setLegRow(i, 'bearing', e.target.value)}
                    />
                    <input
                      aria-label={`Leg ${i + 1} wind direction`}
                      className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                      value={row.wind}
                      inputMode="decimal"
                      onChange={(e) => setLegRow(i, 'wind', e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      aria-label={`Remove leg ${i + 1}`}
                      onClick={() => setLegRows((rows) => rows.filter((_, j) => j !== i))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setLegRows((rows) => [...rows, { distance: '', bearing: '', wind: '' }])}
                  >
                    Add leg
                  </Button>
                  {legsTotal > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {legsTotal.toFixed(2)} NM total
                    </span>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                One row per leg, in sailing order; split a leg into two rows when
                the wind shifts along it. The course distance is the total.
              </p>
            </div>
          )}
          {offerScoringWind && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="start-scoring-wind">
                Scoring wind <span className="font-normal text-muted-foreground">(kt, optional)</span>
              </label>
              <input
                id="start-scoring-wind"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
                value={scoringWindInput}
                onChange={(e) => { setScoringWindInput(e.target.value); setError(''); }}
                placeholder="14"
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              <p className="text-xs text-muted-foreground">
                Overrides the winner&apos;s implied wind for performance-curve scoring
                — set only when the implied wind doesn&apos;t fairly represent the race.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Fleets in this start</label>
            <div className="space-y-1.5">
              {/* Round-owned fleets are managed by the split-fleet ceremonies;
                  offer them only when this start already includes one. */}
              {fleets.filter((f) => !f.splitRoundId || fleetIds.includes(f.id)).map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fleetIds.includes(f.id)}
                    onChange={(e) => {
                      setFleetIds((prev) =>
                        e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                      );
                      setError('');
                    }}
                    className="h-4 w-4 rounded border"
                  />
                  {f.name}
                  {f.scoringSystem !== 'scratch' && (
                    <span className="text-xs text-muted-foreground">({f.scoringSystem.toUpperCase()})</span>
                  )}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
