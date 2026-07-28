'use client';

// The way in to the split-fleet championship format, on a series that isn't
// one yet. Once enabled, the whole format — fleets, carry, discards,
// non-finisher scores — lives in the Format section of the series' Split
// Fleets tab, beside the ceremonies that use it, and this card disappears.

import { useFeatures } from '@/components/features-provider';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { SplitFleetEditor } from '@/components/split-fleets-editor';
import { useSplitFleetState } from '@/hooks/use-split-fleets';
import { useCompetitorsBySeries } from '@/hooks/use-competitors';

export function SplitFleetsCard({ seriesId }: { seriesId: string }) {
  const { has } = useFeatures();
  const gated = has('split-fleets');
  const { data: state } = useSplitFleetState(seriesId, { enabled: gated });
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const readOnly = useSeriesReadOnly();

  // Nothing to offer without the feature, and nothing to say once the series
  // already carries a configuration (the tab owns it from then on).
  if (!gated || state?.config) return null;

  return (
    <div className="bg-card border rounded-lg p-5 space-y-3" data-testid="split-fleets-card">
      <h2 className="text-sm font-medium">Split-fleet championship</h2>
      <p className="text-sm text-muted-foreground">
        Run this series as a qualifying/final championship: boats race in
        qualifying fleets reassigned by series rank after each day of racing,
        then split by rank for the final series. Enabling adds the Split Fleets
        tab, which runs the event and carries these settings from then on.
      </p>
      <SplitFleetEditor
        seriesId={seriesId}
        config={null}
        competitorCount={competitors?.length ?? 0}
        canEdit={!readOnly}
      />
    </div>
  );
}
