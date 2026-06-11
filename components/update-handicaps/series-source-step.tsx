'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { queryKeys } from '@/hooks/query-keys';
import { useSeriesList } from '@/hooks/use-series';
import {
  competitorRepo,
  fleetRepo,
  listTcfHistoryBySeries,
  raceRepo,
} from '@/lib/api-repository';
import {
  endOfSeriesTcfs,
  planHandicapUpdates,
  proposeFleetMapping,
  type PreviewRow,
} from '@/lib/source-handicaps';

import { FleetMappingTable } from './fleet-mapping-table';
import { PreviewSection } from './preview-section';
import {
  StepFooter,
  buildPreviewUpdateRows,
  previewOutcome,
  splitPreviewRows,
  type SourceStepProps,
} from './shared';

/**
 * "Another series in this workspace" source: pick a prior series, map its
 * fleets onto this one, and propose each boat's end-of-series handicap as
 * its starting handicap here. Covers NHC, ECHO, IRC, and PY.
 */
export function SeriesSourceStep({
  seriesId,
  competitors,
  fleets,
  applying,
  errorMsg,
  onApply,
  onCancel,
  freezeScoredRaces,
  onFreezeScoredRacesChange,
}: SourceStepProps & {
  /** Owned by the shell: it applies to every source's mutation, and its
   *  toggle deliberately survives reopening the dialog. */
  freezeScoredRaces: boolean;
  onFreezeScoredRacesChange: (v: boolean) => void;
}) {
  const allSeries = useSeriesList();
  const [sourceSeriesId, setSourceSeriesId] = useState<string | null>(null);
  const [fleetMapping, setFleetMapping] = useState<Record<string, string | null>>({});
  const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set());

  // ── Source data, loaded only after the source series is picked ─────────────
  // Inline `useQuery` (not the wrapper hooks) so we can gate with `enabled`
  // — otherwise an empty-string seriesId would fire `/api/v1/series//…`,
  // which Next.js collapses to `/api/v1/series/competitors` etc. and 400s
  // on the invalid UUID.
  const sourceEnabled = sourceSeriesId !== null;
  const sourceCompetitors = useQuery({
    queryKey: queryKeys.competitors.bySeries(sourceSeriesId ?? ''),
    queryFn: () => competitorRepo.listBySeries(sourceSeriesId!),
    enabled: sourceEnabled,
  });
  const sourceFleets = useQuery({
    queryKey: queryKeys.fleets.bySeries(sourceSeriesId ?? ''),
    queryFn: () => fleetRepo.listBySeries(sourceSeriesId!),
    enabled: sourceEnabled,
  });
  const sourceRaces = useQuery({
    queryKey: queryKeys.races.bySeries(sourceSeriesId ?? ''),
    queryFn: () => raceRepo.listBySeries(sourceSeriesId!),
    enabled: sourceEnabled,
  });
  const sourceTcfHistory = useQuery({
    queryKey: queryKeys.tcfHistory.bySeries(sourceSeriesId ?? ''),
    queryFn: () => listTcfHistoryBySeries(sourceSeriesId!),
    enabled: sourceEnabled,
  });

  // Seed the fleet mapping the first time the picked source series's
  // fleets are loaded. React 19's "derive state from props" pattern: do
  // the setState in render guarded by a prev-tracking sentinel so the
  // transition only fires once per source-series pick (not on every
  // refetch of the source fleet list, which would clobber the scorer's
  // overrides). See react.dev — "you might not need an effect".
  const [seededForSourceSeriesId, setSeededForSourceSeriesId] = useState<string | null>(null);
  if (
    sourceSeriesId !== null &&
    sourceSeriesId !== seededForSourceSeriesId &&
    sourceFleets.data &&
    fleets
  ) {
    setSeededForSourceSeriesId(sourceSeriesId);
    setFleetMapping(proposeFleetMapping(fleets, sourceFleets.data));
    setExcludedRowIds(new Set());
  }

  const endTcfs = useMemo(() => {
    if (!sourceCompetitors.data || !sourceFleets.data || !sourceRaces.data || !sourceTcfHistory.data) {
      return new Map();
    }
    return endOfSeriesTcfs(
      sourceCompetitors.data,
      sourceFleets.data,
      sourceRaces.data,
      sourceTcfHistory.data,
    );
  }, [sourceCompetitors.data, sourceFleets.data, sourceRaces.data, sourceTcfHistory.data]);

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!competitors || !fleets || !sourceCompetitors.data) return [];
    return planHandicapUpdates({
      targetCompetitors: competitors,
      targetFleets: fleets,
      sourceCompetitors: sourceCompetitors.data,
      endOfSourceTcfs: endTcfs,
      fleetMapping,
    });
  }, [competitors, fleets, sourceCompetitors.data, endTcfs, fleetMapping]);

  const split = splitPreviewRows(previewRows, excludedRowIds);

  const targetFleetById = useMemo(() => new Map((fleets ?? []).map((f) => [f.id, f])), [fleets]);
  const sourceFleetById = useMemo(
    () => new Map((sourceFleets.data ?? []).map((f) => [f.id, f])),
    [sourceFleets.data],
  );
  const targetCompetitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c])),
    [competitors],
  );

  const candidateSourceSeries = useMemo(() => {
    if (!allSeries.data) return [];
    return allSeries.data
      .filter((s) => s.id !== seriesId)
      .sort((a, b) => (b.lastModifiedAt ?? 0) - (a.lastModifiedAt ?? 0));
  }, [allSeries.data, seriesId]);

  const sourceDataLoading = sourceSeriesId !== null &&
    (sourceCompetitors.isLoading || sourceFleets.isLoading || sourceRaces.isLoading || sourceTcfHistory.isLoading);

  function handleApply() {
    onApply(
      buildPreviewUpdateRows(split.appliedChangeRows, [], targetCompetitorById),
      previewOutcome(split, 0),
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update handicaps from another series</DialogTitle>
        <DialogDescription>
          Pick a source series. We&apos;ll pull each boat&apos;s end-of-series handicap
          and propose it as the starting handicap here.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
        <div className="space-y-1">
          <label className="text-sm font-medium">Source series</label>
          <Select
            value={sourceSeriesId ?? ''}
            onValueChange={(v) => setSourceSeriesId(v || null)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Pick a series…" />
            </SelectTrigger>
            <SelectContent>
              {candidateSourceSeries.length === 0 && (
                <SelectItem value="__none__" disabled>
                  No other series in this workspace
                </SelectItem>
              )}
              {candidateSourceSeries.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {sourceSeriesId && sourceDataLoading && (
          <p className="text-sm text-muted-foreground">Loading source series…</p>
        )}

        {sourceSeriesId && !sourceDataLoading && fleets && (
          <>
            <FleetMappingTable
              targetFleets={fleets}
              sourceFleets={sourceFleets.data ?? []}
              fleetMapping={fleetMapping}
              onChange={setFleetMapping}
            />

            <PreviewSection
              changedRows={split.changedRows}
              unchangedRows={split.unchangedRows}
              notFoundRows={split.notFoundRows}
              excludedRowIds={excludedRowIds}
              onToggleRow={(key, included) => {
                setExcludedRowIds((prev) => {
                  const next = new Set(prev);
                  if (included) next.delete(key);
                  else next.add(key);
                  return next;
                });
              }}
              targetCompetitorById={targetCompetitorById}
              targetFleetById={targetFleetById}
              sourceFleetById={sourceFleetById}
            />

            {errorMsg && (
              <p className="text-sm text-destructive">{errorMsg}</p>
            )}
          </>
        )}
      </div>

      {split.appliedChangeRows.some((r) => r.system === 'irc' || r.system === 'py') && (
        <label className="flex items-start gap-2 px-1 pt-1 cursor-pointer text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={freezeScoredRaces}
            onChange={(e) => onFreezeScoredRacesChange(e.target.checked)}
          />
          <span>
            Keep already-scored races on the old rating
            <span className="block text-xs text-muted-foreground">
              For a boat re-rated mid-series (a new certificate): races already sailed stay on
              their old rating; only later races use the new one. Uncheck to re-score every race
              on the new rating (a correction).
            </span>
          </span>
        </label>
      )}

      <StepFooter
        onCancel={onCancel}
        onApply={handleApply}
        disabled={
          !sourceSeriesId ||
          sourceDataLoading ||
          split.appliedChangeRows.length === 0 ||
          applying
        }
        applying={applying}
        count={split.appliedChangeRows.length}
      />
    </>
  );
}
