'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { queryKeys } from '@/hooks/query-keys';
import { loadIrishSailingRatings } from '@/lib/api-repository';
import { defaultSailCountry } from '@/lib/rating-match';
import {
  additionKey,
  planEchoFleetAdditions,
  planEchoUpdates,
  type FleetAdditionCandidate,
  type PreviewRow,
} from '@/lib/source-handicaps';

import { AddToFleetSection } from './add-to-fleet-section';
import { PreviewSection } from './preview-section';
import {
  MatchByNameCheckbox,
  StepFooter,
  buildPreviewUpdateRows,
  previewOutcome,
  splitPreviewRows,
  useRatingListSelections,
  useSeriesHasRaces,
  type SourceStepProps,
} from './shared';

/**
 * Irish Sailing ECHO source: match each boat by sail number against the
 * national Irish Sailing ratings list and propose its ECHO handicap, with
 * add-to-fleet candidates for rated boats not yet in an ECHO fleet.
 */
export function IrishSailingSourceStep({
  seriesId,
  competitors,
  fleets,
  applying,
  errorMsg,
  onApply,
  onCancel,
}: SourceStepProps) {
  const sel = useRatingListSelections();

  const irishRatings = useQuery({
    queryKey: queryKeys.irishSailingRatings.all,
    queryFn: () => loadIrishSailingRatings(),
    staleTime: 60 * 60 * 1000, // national list; fine to reuse within a session
  });

  const defaultCountry = defaultSailCountry();
  const seriesHasRaces = useSeriesHasRaces(seriesId);

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!competitors || !fleets || !irishRatings.data) return [];
    return planEchoUpdates({
      targetCompetitors: competitors,
      targetFleets: fleets,
      records: irishRatings.data.records,
      matchByName: sel.matchByName,
      defaultCountry,
    });
  }, [competitors, fleets, irishRatings.data, sel.matchByName, defaultCountry]);

  const additionCandidates = useMemo<FleetAdditionCandidate[]>(() => {
    if (!competitors || !fleets || !irishRatings.data) return [];
    return planEchoFleetAdditions({
      targetCompetitors: competitors,
      targetFleets: fleets,
      records: irishRatings.data.records,
      matchByName: sel.matchByName,
      targetFleetByKey: sel.addTargetFleetByKey,
      defaultCountry,
    });
  }, [competitors, fleets, irishRatings.data, sel.matchByName, sel.addTargetFleetByKey, defaultCountry]);

  // A candidate can actually be applied once it has a target fleet and a value.
  const checkedAdditions = additionCandidates.filter(
    (c) => sel.addSelected.has(additionKey(c.competitorId, c.system)) && c.targetFleetId && c.proposedTcf !== null,
  );

  const split = splitPreviewRows(previewRows, sel.excludedRowIds);

  const targetFleetById = useMemo(() => new Map((fleets ?? []).map((f) => [f.id, f])), [fleets]);
  const targetCompetitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c])),
    [competitors],
  );

  function handleApply() {
    onApply(
      buildPreviewUpdateRows(split.appliedChangeRows, checkedAdditions, targetCompetitorById),
      previewOutcome(split, checkedAdditions.length),
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update handicaps from Irish Sailing ECHO</DialogTitle>
        <DialogDescription>
          We match each boat by sail number against the national Irish Sailing ratings
          list and propose its ECHO handicap.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
        <MatchByNameCheckbox checked={sel.matchByName} onChange={sel.setMatchByName} />

        {irishRatings.isLoading && (
          <p className="text-sm text-muted-foreground">Loading Irish Sailing ratings…</p>
        )}

        {irishRatings.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load the Irish Sailing ratings list. Please try again later.
          </p>
        )}

        {irishRatings.data && (
          <>
            <PreviewSection
              changedRows={split.changedRows}
              unchangedRows={split.unchangedRows}
              notFoundRows={split.notFoundRows}
              excludedRowIds={sel.excludedRowIds}
              onToggleRow={sel.toggleRow}
              targetCompetitorById={targetCompetitorById}
              targetFleetById={targetFleetById}
              sourceFleetById={new Map()}
            />

            <AddToFleetSection
              candidates={additionCandidates}
              selected={sel.addSelected}
              onToggle={sel.toggleAddition}
              onChooseFleet={sel.chooseAdditionFleet}
              onChooseCert={sel.chooseCert}
              targetCompetitorById={targetCompetitorById}
              seriesHasRaces={seriesHasRaces}
            />

            {irishRatings.data.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Irish Sailing ratings as of {irishRatings.data.updatedAt}.
              </p>
            )}

            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
          </>
        )}
      </div>

      <StepFooter
        onCancel={onCancel}
        onApply={handleApply}
        disabled={
          !irishRatings.data ||
          split.appliedChangeRows.length + checkedAdditions.length === 0 ||
          applying
        }
        applying={applying}
        count={split.appliedChangeRows.length + checkedAdditions.length}
      />
    </>
  );
}
