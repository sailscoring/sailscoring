'use client';

// Split-fleet configuration card (series-format card, like scoring mode).
// Visible whenever the series carries a split-fleet config: collapsed
// summary always; expanded, the editable fields per the config-editability
// contract — carry mode and qualifying fleet count freeze once any race has
// finishes (the server enforces it; this card mirrors the rule), everything
// else re-scores live.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useFeatures } from '@/components/features-provider';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { SplitFleetSetup } from '@/components/split-fleets-setup';
import { useSplitFleetState, useSaveSplitFleetConfig } from '@/hooks/use-split-fleets';
import { useFinishesBySeries } from '@/hooks/use-finishes';
import type { SplitFleetConfig } from '@/lib/split-fleets';

export function SplitFleetsCard({ seriesId }: { seriesId: string }) {
  const { has } = useFeatures();
  const gated = has('split-fleets');
  const { data: state } = useSplitFleetState(seriesId, { enabled: gated });
  const config = state?.config;
  // Fetch finishes only for an actual split-fleet series. Fetching them
  // unconditionally seeded the finishes.bySeries cache with an empty list on
  // every Settings visit, and any standings view mounted within the global
  // staleTime then scored over the stale empty cache — blank standings.
  const { data: finishes } = useFinishesBySeries(seriesId, { enabled: gated && !!config });
  const save = useSaveSplitFleetConfig(seriesId);
  const readOnly = useSeriesReadOnly();
  const [expanded, setExpanded] = useState(false);

  if (!gated && !config) return null;
  if (!config) {
    // Not yet a split-fleet series: offer the Format chooser here — enabling
    // makes the Split Fleets tab appear (leading the tab bar).
    return (
      <div className="bg-card border rounded-lg p-5 space-y-3" data-testid="split-fleets-card">
        <h2 className="text-sm font-medium">Split-fleet championship</h2>
        <p className="text-sm text-muted-foreground">
          Run this series as a qualifying/final championship, per the
          class&rsquo;s standard sailing instructions. Enabling adds the Split
          Fleets tab, which runs the event.
        </p>
        <SplitFleetSetup seriesId={seriesId} canManage={!readOnly} />
      </div>
    );
  }

  const locked = (finishes?.length ?? 0) > 0;
  const summary = [
    `${config.qualifyingFleets.length} qualifying fleets (${config.qualifyingFleets.map((f) => f.label).join(', ')})`,
    `→ ${config.finalFleets.map((f) => f.label).join('/')}`,
    config.medal ? `medal race ×${config.medal.multiplier}` : 'no medal race',
  ].join(' · ');

  const patch = (p: Partial<SplitFleetConfig>) => save.mutate({ ...config, ...p });

  return (
    <div className="bg-card border rounded-lg p-5 space-y-4" data-testid="split-fleets-card">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Split-fleet championship</h2>
        {!expanded && !readOnly && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-xs text-muted-foreground">
            {locked
              ? 'Racing has started: the carry mode and qualifying fleet count are frozen; the fields below re-score live.'
              : 'All fields are editable until racing starts.'}
          </p>
          <div className="flex items-center gap-2">
            <span className="w-56 text-muted-foreground">Qualifying fleets (frozen once racing)</span>
            <span>{config.qualifyingFleets.map((f) => f.label).join(', ')}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-56 text-muted-foreground">Carry (frozen once racing)</span>
            <span>{config.carry}</span>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-56 text-muted-foreground" htmlFor="sfc-split">Split rule</label>
            <select
              id="sfc-split"
              className="rounded-md border bg-background px-2 py-1"
              value={config.split.kind}
              onChange={(e) =>
                patch({
                  split:
                    e.target.value === 'fixed-top'
                      ? { kind: 'fixed-top', topSize: config.split.kind === 'fixed-top' ? config.split.topSize : 25 }
                      : { kind: 'equal-blocks' },
                })
              }
            >
              <option value="equal-blocks">Near-equal blocks (Gold largest)</option>
              <option value="fixed-top">Fixed top-fleet size</option>
            </select>
            {config.split.kind === 'fixed-top' && (
              <input
                type="number"
                aria-label="Top fleet size"
                className="w-20 rounded-md border bg-background px-2 py-1"
                value={config.split.topSize}
                min={1}
                onChange={(e) => patch({ split: { kind: 'fixed-top', topSize: Number(e.target.value) } })}
              />
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="w-56 text-muted-foreground" htmlFor="sfc-final-base">Finals score-code base</label>
            <select
              id="sfc-final-base"
              className="rounded-md border bg-background px-2 py-1"
              value={config.codeBasis.final}
              onChange={(e) =>
                patch({ codeBasis: { ...config.codeBasis, final: e.target.value as 'own-fleet' | 'largest-qualifying' } })
              }
            >
              <option value="own-fleet">Own fleet + 1</option>
              <option value="largest-qualifying">Largest qualifying fleet + 1</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">
            Discard rules — including the final-series caps — are edited in the
            Scoring card below.
          </p>
          <div className="flex items-center gap-2">
            <label className="w-56 text-muted-foreground" htmlFor="sfc-tie">Assignment tie order (after A8)</label>
            <select
              id="sfc-tie"
              className="rounded-md border bg-background px-2 py-1"
              value={config.reassignmentTieOrder}
              onChange={(e) =>
                patch({ reassignmentTieOrder: e.target.value as 'a8-then-entry-order' | 'fleet-order' })
              }
            >
              <option value="a8-then-entry-order">Registration/seeding order</option>
              <option value="fleet-order">Fleet-order scatter (LE)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="w-56 text-muted-foreground" htmlFor="sfc-medal-size">Medal race</label>
            {config.medal ? (
              <>
                <span>top</span>
                <input
                  id="sfc-medal-size"
                  type="number"
                  min={2}
                  className="w-16 rounded-md border bg-background px-2 py-1"
                  value={config.medal.size}
                  onChange={(e) => patch({ medal: { ...config.medal!, size: Number(e.target.value) } })}
                />
                <span>× </span>
                <input
                  type="number"
                  aria-label="Medal points multiplier"
                  min={1}
                  className="w-16 rounded-md border bg-background px-2 py-1"
                  value={config.medal.multiplier}
                  onChange={(e) => patch({ medal: { ...config.medal!, multiplier: Number(e.target.value) } })}
                />
                <Button variant="ghost" size="sm" onClick={() => patch({ medal: undefined })}>
                  Remove
                </Button>
              </>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ medal: { size: 10, raceCount: 1, multiplier: 2 } })}
              >
                Add a medal race
              </Button>
            )}
          </div>
          {save.isError && <p className="text-destructive text-xs">{String(save.error)}</p>}
          <div>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
