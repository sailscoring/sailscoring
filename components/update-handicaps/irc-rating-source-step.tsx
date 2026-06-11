'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { queryKeys } from '@/hooks/query-keys';
import { loadIrcRatings } from '@/lib/api-repository';
import { defaultSailCountry, type IrcTccVariant } from '@/lib/rating-match';
import {
  additionKey,
  planIrcFleetAdditions,
  planIrcUpdates,
  type FleetAdditionCandidate,
  type PreviewRow,
} from '@/lib/source-handicaps';

import { AddToFleetSection } from './add-to-fleet-section';
import { PreviewSection } from './preview-section';
import {
  FleetVariantSelector,
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
 * IRC TCC source: match each boat by sail number against the worldwide IRC
 * rating list and propose its TCC, with per-fleet spin/non-spin variants,
 * per-boat certificate choices, and add-to-fleet candidates.
 */
export function IrcRatingSourceStep({
  seriesId,
  competitors,
  fleets,
  applying,
  errorMsg,
  onApply,
  onCancel,
}: SourceStepProps) {
  // Spin/non-spin per IRC fleet; a fleet absent from the map defaults to spin.
  const [ircVariantByFleet, setIrcVariantByFleet] = useState<Record<string, IrcTccVariant>>({});
  const sel = useRatingListSelections();

  const ircRatings = useQuery({
    queryKey: queryKeys.ircRatings.all,
    queryFn: () => loadIrcRatings(),
    staleTime: 60 * 60 * 1000, // worldwide list; fine to reuse within a session
  });

  // Country to assume for a competitor's prefix-less sail number (deployment
  // parameter — IRL by default). Matters most against the worldwide IRC list.
  const defaultCountry = defaultSailCountry();
  const seriesHasRaces = useSeriesHasRaces(seriesId);

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!competitors || !fleets || !ircRatings.data) return [];
    return planIrcUpdates({
      targetCompetitors: competitors,
      targetFleets: fleets,
      records: ircRatings.data.records,
      ircVariantByFleet,
      matchByName: sel.matchByName,
      certChoiceByCompetitor: sel.certChoiceByCompetitor,
      defaultCountry,
    });
  }, [competitors, fleets, ircRatings.data, ircVariantByFleet, sel.matchByName, sel.certChoiceByCompetitor, defaultCountry]);

  const additionCandidates = useMemo<FleetAdditionCandidate[]>(() => {
    if (!competitors || !fleets || !ircRatings.data) return [];
    return planIrcFleetAdditions({
      targetCompetitors: competitors,
      targetFleets: fleets,
      records: ircRatings.data.records,
      ircVariantByFleet,
      matchByName: sel.matchByName,
      certChoiceByCompetitor: sel.certChoiceByCompetitor,
      targetFleetByKey: sel.addTargetFleetByKey,
      defaultCountry,
    });
  }, [competitors, fleets, ircRatings.data, ircVariantByFleet, sel.matchByName, sel.certChoiceByCompetitor, sel.addTargetFleetByKey, defaultCountry]);

  // A candidate can actually be applied once it has a target fleet and a value.
  const checkedAdditions = additionCandidates.filter(
    (c) => sel.addSelected.has(additionKey(c.competitorId, c.system)) && c.targetFleetId && c.proposedTcf !== null,
  );

  const split = splitPreviewRows(previewRows, sel.excludedRowIds);

  // IRC fleets in the target series — each gets its own spin/non-spin selector.
  const ircFleets = useMemo(
    () => (fleets ?? []).filter((f) => f.scoringSystem === 'irc'),
    [fleets],
  );

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
        <DialogTitle>Update handicaps from IRC ratings</DialogTitle>
        <DialogDescription>
          We match each boat by sail number against the worldwide IRC rating list and
          propose its IRC TCC.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
        <FleetVariantSelector
          heading="IRC rating per fleet"
          fleets={ircFleets}
          variantByFleet={ircVariantByFleet}
          onChange={(fleetId, variant) =>
            setIrcVariantByFleet((prev) => ({ ...prev, [fleetId]: variant }))
          }
          nonSpinLabel="Non-spinnaker TCC"
          hint="Set non-spinnaker classes to use their non-spin TCC."
        />

        <MatchByNameCheckbox checked={sel.matchByName} onChange={sel.setMatchByName} />

        {ircRatings.isLoading && (
          <p className="text-sm text-muted-foreground">Loading IRC ratings…</p>
        )}

        {ircRatings.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load the IRC rating list. Please try again later.
          </p>
        )}

        {ircRatings.data && (
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
              onChooseCert={sel.chooseCert}
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

            {ircRatings.data.updatedAt && (
              <p className="text-xs text-muted-foreground">
                IRC ratings as of {ircRatings.data.updatedAt}.
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
          !ircRatings.data ||
          split.appliedChangeRows.length + checkedAdditions.length === 0 ||
          applying
        }
        applying={applying}
        count={split.appliedChangeRows.length + checkedAdditions.length}
      />
    </>
  );
}
