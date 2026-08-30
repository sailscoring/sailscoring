'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  useRaceRatingOverridesByRace,
  useSaveRaceRatingOverride,
  useDeleteRaceRatingOverride,
} from '@/hooks/use-race-rating-overrides';
import { useTcfHistoryBySeries } from '@/hooks/use-tcf-history';
import type { Competitor, Fleet, RaceRatingOverride, RatingField } from '@/lib/types';
import { formatPrimaryNames } from '@/lib/competitor-fields';
import { formatRatingValue, type RatingSystemCode } from '@/lib/competitor-ratings';
import { orcTotRating } from '@/lib/orc-certificate';
import { bySailNumber } from '@/lib/sail-number-sort';

export interface RatingsTabProps {
  /** Show which rating scored each boat without offering to override it —
   *  the series is read-only, so a save would only bounce (#486). */
  readOnly?: boolean;
  seriesId: string;
  raceId: string;
  competitors: Competitor[];
  fleets: Fleet[];
}

const STATIC_FIELD: Record<'irc' | 'py', RatingField> = { irc: 'ircTcc', py: 'pyNumber' };

interface Row {
  key: string;
  competitor: Competitor;
  fleet: Fleet;
  /** Scratch fleets carry no rating, so they never make a row. */
  system: RatingSystemCode;
  /** Static fleets only — the field an override edits. */
  field: RatingField | null;
  /** The boat's current/base rating: competitor value (static) or seed (progressive). */
  base: number | null;
  /** Rating used to score this race. */
  applied: number | null;
  /** Static override for this race, if set. */
  override: RaceRatingOverride | null;
}

export function RatingsTab({ seriesId, raceId, competitors, fleets, readOnly = false }: RatingsTabProps) {
  const { data: overrides } = useRaceRatingOverridesByRace(raceId);
  const { data: tcfHistory } = useTcfHistoryBySeries(seriesId);
  const saveOverride = useSaveRaceRatingOverride();
  const deleteOverride = useDeleteRaceRatingOverride();

  // editing key (`${competitorId}:${field}`) → input string
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const fleetById = new Map(fleets.map((f) => [f.id, f]));
  const overrideFor = (competitorId: string, field: RatingField) =>
    (overrides ?? []).find((o) => o.competitorId === competitorId && o.field === field) ?? null;
  const appliedTcf = (competitorId: string, fleetId: string): number | null => {
    const rec = (tcfHistory ?? []).find(
      (t) => t.raceId === raceId && t.competitorId === competitorId && t.fleetId === fleetId,
    );
    return rec ? rec.tcfApplied : null;
  };

  const rows: Row[] = [];
  for (const c of [...competitors].sort(bySailNumber)) {
    for (const fleetId of c.fleetIds) {
      const fleet = fleetById.get(fleetId);
      if (!fleet || fleet.scoringSystem === 'scratch') continue;
      if (fleet.scoringSystem === 'irc' || fleet.scoringSystem === 'py') {
        const field = STATIC_FIELD[fleet.scoringSystem];
        const base = c[field] ?? null;
        const override = overrideFor(c.id, field);
        rows.push({
          key: `${c.id}:${fleetId}`,
          competitor: c, fleet, system: fleet.scoringSystem, field,
          base, applied: override?.value ?? base, override,
        });
      } else {
        // Read-only rows: progressive systems (nhc/echo) evolve per race, and
        // an ORC rating is the certificate — changed by re-import, not edits.
        const base = (fleet.scoringSystem === 'echo'
          ? c.echoStartingTcf
          : fleet.scoringSystem === 'orc'
            ? orcTotRating(c, fleet)
            : c.nhcStartingTcf) ?? null;
        rows.push({
          key: `${c.id}:${fleetId}`,
          competitor: c, fleet, system: fleet.scoringSystem, field: null,
          base, applied: appliedTcf(c.id, fleetId), override: null,
        });
      }
    }
  }

  const staticRows = rows.filter((r) => r.field !== null);
  const progressiveRows = rows.filter((r) => r.field === null);

  function editKey(r: Row): string {
    return `${r.competitor.id}:${r.field}`;
  }

  async function handleSave(r: Row) {
    const k = editKey(r);
    const raw = editing[k];
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      setErrorKey(k);
      return;
    }
    await saveOverride.mutateAsync({
      id: r.override?.id ?? crypto.randomUUID(),
      raceId,
      competitorId: r.competitor.id,
      field: r.field as RatingField,
      value,
    });
    setEditing((e) => { const n = { ...e }; delete n[k]; return n; });
    setErrorKey(null);
  }

  async function handleClear(r: Row) {
    if (!r.override) return;
    await deleteOverride.mutateAsync({ id: r.override.id, raceId });
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Ratings for this race</h3>
        <p className="text-xs text-muted-foreground">
          The rating each boat is scored on in this race, per fleet. Override an IRC or PY rating to
          record a mid-series rating change (a new certificate) without disturbing other races.
        </p>
      </div>

      {staticRows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="py-1 pr-3">Sail</th>
                <th className="py-1 pr-3">Boat</th>
                <th className="py-1 pr-3">Fleet</th>
                <th className="py-1 pr-3 text-right">Rating used</th>
                <th className="py-1 pr-3">Current</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {staticRows.map((r) => {
                const k = editKey(r);
                const isEditing = k in editing;
                const overridden = r.override != null;
                return (
                  <tr key={r.key} className="border-t">
                    <td className="py-1.5 pr-3 font-mono">{r.competitor.sailNumber}</td>
                    <td className="py-1.5 pr-3">{r.competitor.boatName ?? formatPrimaryNames(r.competitor.names)}</td>
                    <td className="py-1.5 pr-3">{r.fleet.name}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">
                      {isEditing && !readOnly ? (
                        <input
                          type="number"
                          step="0.001"
                          autoFocus
                          value={editing[k]}
                          onChange={(e) => setEditing((s) => ({ ...s, [k]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === 'Enter') void handleSave(r); if (e.key === 'Escape') setEditing((s) => { const n = { ...s }; delete n[k]; return n; }); }}
                          className={`w-24 rounded border px-1.5 py-0.5 text-right ${errorKey === k ? 'border-destructive' : ''}`}
                        />
                      ) : (
                        <span className={overridden ? 'font-medium' : ''}>
                          {formatRatingValue(r.applied, r.system)}
                          {overridden && <span className="ml-1 text-xs text-amber-600" title="Per-race override">●</span>}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">
                      {overridden ? formatRatingValue(r.base, r.system) : ''}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {readOnly ? null : isEditing ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => void handleSave(r)}>Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing((s) => { const n = { ...s }; delete n[k]; return n; })}>Cancel</Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setEditing((s) => ({ ...s, [k]: String(r.applied ?? r.base ?? '') }))}>
                            {overridden ? 'Edit' : 'Override'}
                          </Button>
                          {overridden && (
                            <Button size="sm" variant="ghost" onClick={() => void handleClear(r)}>Clear</Button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {progressiveRows.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">
            Progressive handicaps (computed each race — not editable)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="py-1 pr-3">Sail</th>
                  <th className="py-1 pr-3">Boat</th>
                  <th className="py-1 pr-3">Fleet</th>
                  <th className="py-1 pr-3 text-right">Applied</th>
                  <th className="py-1 pr-3 text-right">Seed</th>
                  <th className="py-1 pr-3 text-right">Drift</th>
                </tr>
              </thead>
              <tbody>
                {progressiveRows.map((r) => {
                  const drift = r.applied != null && r.base != null ? r.applied - r.base : null;
                  return (
                    <tr key={r.key} className="border-t">
                      <td className="py-1.5 pr-3 font-mono">{r.competitor.sailNumber}</td>
                      <td className="py-1.5 pr-3">{r.competitor.boatName ?? formatPrimaryNames(r.competitor.names)}</td>
                      <td className="py-1.5 pr-3">{r.fleet.name}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatRatingValue(r.applied, r.system)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{formatRatingValue(r.base, r.system)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {drift == null ? '—' : `${drift >= 0 ? '+' : ''}${drift.toFixed(3)}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {rows.length === 0 && (
        <p className="text-sm text-muted-foreground">No rated fleets in this series.</p>
      )}
    </div>
  );
}
