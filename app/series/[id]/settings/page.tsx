'use client';

import { use } from 'react';
import * as repos from '@/lib/api-repository';
import { useSeries, useUpdateSeries } from '@/hooks/use-series';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { isDuplicateSeriesName } from '@/lib/series-name';
import { BasicsCard } from '@/components/series-settings/basics-card';
import { ScoringCard } from '@/components/series-settings/scoring-card';
import { FleetsCard } from '@/components/series-settings/fleets-card';
import { ScoringModeCard } from '@/components/series-settings/scoring-mode-card';
import { CompetitorFieldsCard } from '@/components/series-settings/competitor-fields-card';
import { PublishingCard } from '@/components/series-settings/publishing-card';
import { SeriesTabFallback } from '@/components/series-tab-fallback';

export default function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const { listSeriesNames } = repos;
  const { data: series, isLoading } = useSeries(seriesId);
  const { data: fleetsData } = useFleetsBySeries(seriesId);
  const fleets = fleetsData ?? [];
  const updateSeries = useUpdateSeries();

  if (isLoading || series === undefined) return <SeriesTabFallback status="loading" />;
  if (series === null) return <SeriesTabFallback status="missing" />;

  const anyProgressiveFleet = fleets.some((f) => f.scoringSystem === 'nhc' || f.scoringSystem === 'echo');

  // The settings cards auto-save (which the server would reject for an
  // archived, read-only series), so they're replaced with a notice while
  // archived. Unarchive from the banner above to edit.
  if (series.archived) {
    return (
      <div className="max-w-lg">
        <p className="text-sm text-muted-foreground">
          Archived series are read-only. Unarchive this series from the banner
          above to change its settings.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-lg">
      <BasicsCard
        value={series}
        includeName
        validateName={async (name) => {
          const trimmed = name.trim();
          if (!trimmed) return 'Series name is required.';
          const existing = await listSeriesNames({ excludeId: seriesId });
          return isDuplicateSeriesName(trimmed, existing)
            ? 'A series with this name already exists.'
            : null;
        }}
        onChange={async (patch) => {
          await updateSeries.mutateAsync({
            id: seriesId,
            patch: { ...patch, lastModifiedAt: Date.now() },
          });
        }}
      />
      <ScoringModeCard seriesId={seriesId} series={series} />
      <FleetsCard seriesId={seriesId} series={series} />
      <ScoringCard
        value={series}
        onChange={async (patch) => {
          await updateSeries.mutateAsync({
            id: seriesId,
            patch: { ...patch, lastModifiedAt: Date.now() },
          });
        }}
      />
      <CompetitorFieldsCard seriesId={seriesId} series={series} />
      <PublishingCard seriesId={seriesId} series={series} anyProgressiveFleet={anyProgressiveFleet} />
    </div>
  );
}
