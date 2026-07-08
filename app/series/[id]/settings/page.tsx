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
import { CombinedPagesCard } from '@/components/series-settings/combined-pages-card';
import { DisabledFeatureHint } from '@/components/series-settings/disabled-feature-hint';
import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useSubSeriesBySeries } from '@/hooks/use-sub-series';
import { useFeatures } from '@/components/features-provider';
import { disabledConfigFeatures } from '@/lib/series-feature-hints';

export default function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const { can } = useWorkspacePermissions();
  const { has } = useFeatures();
  const { listSeriesNames } = repos;
  const { data: series, isLoading } = useSeries(seriesId);
  const { data: fleetsData } = useFleetsBySeries(seriesId);
  const { data: subSeriesList } = useSubSeriesBySeries(seriesId);
  const fleets = fleetsData ?? [];
  const updateSeries = useUpdateSeries();

  if (isLoading || series === undefined) return <SeriesTabFallback status="loading" />;
  if (series === null) return <SeriesTabFallback status="missing" />;

  const anyProgressiveFleet = fleets.some((f) => f.scoringSystem === 'nhc' || f.scoringSystem === 'echo');

  // Config the series carries for gated features that are currently off — the
  // gate hides their cards, so surface a hint instead (#280).
  const hints = disabledConfigFeatures(
    {
      'sub-series': (subSeriesList?.length ?? 0) > 0,
      'combined-pages': (series?.publishingGroups?.length ?? 0) > 0,
    },
    has,
  );

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

  // Same shape for roles that can't manage series — the cards auto-save, so
  // rendering them would only bounce every edit off the server's 403.
  if (!can('manage-series')) {
    return (
      <div className="max-w-lg">
        <p className="text-sm text-muted-foreground">
          Your role in this workspace doesn&apos;t allow changing series
          settings. Ask a workspace admin if something here needs to change.
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
      {/* Combined pages are gated (#155): only the authoring UI hides when
          the feature is off — existing group config keeps publishing. */}
      {has('combined-pages') && <CombinedPagesCard seriesId={seriesId} series={series} />}
      {/* A series can carry config for a feature that's since been switched off
          (seeded, imported, or copied). The gate hides the card, so hint at
          what's hidden and how to bring it back (#280). */}
      {hints.map((h) => (
        <DisabledFeatureHint
          key={h.feature}
          label={h.label}
          noun={h.noun}
          canManageWorkspace={can('manage-workspace')}
        />
      ))}
    </div>
  );
}
