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
import { staticRatingField } from '@/lib/scoring';
import { overrideRatingValue } from '@/lib/race-ratings';
import { bySailNumber } from '@/lib/sail-number-sort';

export interface RatingsTabProps {
  /** Show which rating scored each boat without offering to override it —
   *  the series is read-only, so a save would only bounce (#486). */
  readOnly?: boolean;
  seriesId: string;
  raceId: string;
  competitors: Competitor[];
  fleets: Fleet[];
  /** Offer each IRC row its primary, its secondary, or a typed number — the
   *  certificate a boat declared for this race. */
  declareCertificates?: boolean;
}

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

export function RatingsTab({ seriesId, raceId, competitors, fleets, readOnly = false, declareCertificates = false }: RatingsTabProps) {
  const { data: overrides } = useRaceRatingOverridesByRace(raceId);
  const { data: tcfHistory } = useTcfHistoryBySeries(seriesId);
  const saveOverride = useSaveRaceRatingOverride();
  const deleteOverride = useDeleteRaceRatingOverride();

  // editing key (`${competitorId}:${field}`) → input string
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [errorKey, setErrorKey] = useState<string | null>(null);
  // The Declarations… panel: open, and the boats ticked as on their secondary.
  const [declaring, setDeclaring] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState(false);

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
      const field = staticRatingField(fleet.scoringSystem);
      if (field) {
        const base = c[field] ?? null;
        const override = overrideFor(c.id, field);
        rows.push({
          key: `${c.id}:${fleetId}`,
          competitor: c, fleet, system: fleet.scoringSystem, field,
          base, applied: override ? overrideRatingValue(override, c) : base, override,
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

  /** Score a boat on its primary (no override) or declare it on its
   *  secondary for this race. A typed number gives way to either. */
  async function declare(c: Competitor, secondary: boolean) {
    const existing = overrideFor(c.id, 'ircTcc');
    if (!secondary) {
      if (existing) await deleteOverride.mutateAsync({ id: existing.id, raceId });
      return;
    }
    if (c.ircSecondaryTcc == null || existing?.certificate === 'secondary') return;
    await saveOverride.mutateAsync({
      id: existing?.id ?? crypto.randomUUID(),
      raceId,
      competitorId: c.id,
      field: 'ircTcc',
      value: c.ircSecondaryTcc,
      certificate: 'secondary',
    });
  }

  // The boats that can declare: in an IRC fleet in this race, holding a
  // secondary certificate. One entry each, however many IRC fleets they're in.
  const declarable = [...new Map(
    staticRows
      .filter((r) => r.field === 'ircTcc' && r.competitor.ircSecondaryTcc != null)
      .map((r) => [r.competitor.id, r.competitor] as const),
  ).values()];
  const declaredSecondary = (id: string) => overrideFor(id, 'ircTcc')?.certificate === 'secondary';

  async function saveDeclarations(ticked: Set<string>) {
    setBusy(true);
    try {
      for (const c of declarable) {
        const on = ticked.has(c.id);
        if (on !== declaredSecondary(c.id)) await declare(c, on);
      }
      setDeclaring(null);
    } finally {
      setBusy(false);
    }
  }

  /** Primary · Secondary · Other… for one IRC row. */
  function certificateControl(r: Row) {
    const c = r.competitor;
    const current = !r.override ? 'primary' : r.override.certificate === 'secondary' ? 'secondary' : 'other';
    const k = editKey(r);
    const button = (key: 'primary' | 'secondary' | 'other', label: string, onClick: () => void) => (
      <button
        type="button"
        aria-pressed={current === key}
        disabled={readOnly || busy}
        onClick={onClick}
        className={`rounded px-2 py-0.5 text-xs ${current === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
      >
        {label}
      </button>
    );
    return (
      <span role="group" aria-label={`${c.sailNumber} certificate`} className="inline-flex flex-wrap gap-0.5 rounded border p-0.5">
        {button('primary', `Primary ${formatRatingValue(c.ircTcc ?? null, 'irc')}`, () => void declare(c, false))}
        {c.ircSecondaryTcc != null &&
          button('secondary', `Secondary ${formatRatingValue(c.ircSecondaryTcc, 'irc')}`, () => void declare(c, true))}
        {button('other', 'Other…', () => setEditing((s) => ({ ...s, [k]: String(r.applied ?? r.base ?? '') })))}
      </span>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">Ratings for this race</h3>
        <p className="text-xs text-muted-foreground">
          The rating each boat is scored on in this race, per fleet. Override a fixed rating to
          record a mid-series rating change (a new certificate) without disturbing other races.
        </p>
      </div>

      {declareCertificates && declarable.length > 0 && !readOnly && (
        <div className="space-y-2">
          {declaring === null ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeclaring(new Set(declarable.filter((c) => declaredSecondary(c.id)).map((c) => c.id)))}
            >
              Declarations…
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border p-3" data-testid="certificate-declarations">
              <p className="text-xs text-muted-foreground">
                Tick the boats that declared their secondary certificate for this race. The rest race on
                their primary.
              </p>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {declarable.map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={declaring.has(c.id)}
                      onChange={(e) =>
                        setDeclaring((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(c.id);
                          else next.delete(c.id);
                          return next;
                        })
                      }
                    />
                    <span className="font-mono">{c.sailNumber}</span>
                    {c.boatName}
                    <span className="text-xs text-muted-foreground">
                      {formatRatingValue(c.ircSecondaryTcc ?? null, 'irc')}
                    </span>
                  </label>
                ))}
              </div>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy} onClick={() => void saveDeclarations(declaring)}>
                  Save declarations
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDeclaring(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

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
                          {overridden && r.override?.certificate === 'secondary' ? (
                            <span className="ml-1 text-xs text-muted-foreground" title="Declared on the secondary certificate">S</span>
                          ) : overridden && (
                            <span className="ml-1 text-xs text-amber-600" title="Per-race override">●</span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground tabular-nums">
                      {overridden ? formatRatingValue(r.base, r.system) : ''}
                    </td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      {declareCertificates && r.field === 'ircTcc' && !isEditing ? (
                        <>
                          {certificateControl(r)}
                          {r.override?.certificate === 'secondary' && r.competitor.ircSecondaryTcc == null && (
                            <span className="ml-2 text-xs text-amber-600" title="The boat holds no secondary certificate now">
                              no secondary held
                            </span>
                          )}
                        </>
                      ) : readOnly ? null : isEditing ? (
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
