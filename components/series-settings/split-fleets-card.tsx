'use client';

// Split-fleet configuration card (a series-format card, like scoring mode).
// Shows the same editor a scorer met in the setup wizard: on a series that
// isn't split-fleet yet it offers the format and enables it; on one that is,
// it edits it. The two structural choices — how scores carry, and how many
// qualifying fleets — settle once a race has finishes, because changing them
// would re-deal fleets that have already sailed.

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useFeatures } from '@/components/features-provider';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { SplitFleetEditor } from '@/components/split-fleets-editor';
import { useSplitFleetState } from '@/hooks/use-split-fleets';
import { useCompetitorsBySeries } from '@/hooks/use-competitors';
import { useFinishesBySeries } from '@/hooks/use-finishes';

export function SplitFleetsCard({ seriesId }: { seriesId: string }) {
  const { has } = useFeatures();
  const gated = has('split-fleets');
  const { data: state } = useSplitFleetState(seriesId, { enabled: gated });
  const config = state?.config ?? null;
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  // Only a split-fleet series needs the finish list (to know whether the
  // structural fields have settled); fetching it unconditionally would seed
  // an empty cache for every other series' standings.
  const { data: finishes } = useFinishesBySeries(seriesId, { enabled: gated && !!config });
  const readOnly = useSeriesReadOnly();
  const [expanded, setExpanded] = useState(false);

  if (!gated) return null;

  const competitorCount = competitors?.length ?? 0;

  if (!config) {
    return (
      <div className="bg-card border rounded-lg p-5 space-y-3" data-testid="split-fleets-card">
        <h2 className="text-sm font-medium">Split-fleet championship</h2>
        <p className="text-sm text-muted-foreground">
          Run this series as a qualifying/final championship: boats race in
          qualifying fleets reassigned by series rank after each day of racing,
          then split by rank for the final series. Enabling adds the Split
          Fleets tab, which runs the event.
        </p>
        <SplitFleetEditor
          seriesId={seriesId}
          config={null}
          competitorCount={competitorCount}
          canEdit={!readOnly}
        />
      </div>
    );
  }

  const locked = (finishes?.length ?? 0) > 0;
  const summary = [
    `${config.qualifyingFleets.length} qualifying fleets (${config.qualifyingFleets.map((f) => f.label).join(', ')})`,
    `→ ${config.finalFleets.map((f) => f.label).join('/')}`,
    config.medal ? `medal race ×${config.medal.multiplier}` : 'no medal race',
  ].join(' · ');

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
        <>
          <SplitFleetEditor
            seriesId={seriesId}
            config={config}
            competitorCount={competitorCount}
            canEdit={!readOnly}
            locked={locked}
          />
          {locked && (
            <p className="text-xs text-muted-foreground">
              The fleet count and the way scores carry are settled now that
              racing has started — changing them would re-deal fleets that have
              already sailed. Everything else re-scores as you change it.
            </p>
          )}
          <div>
            <Button variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
