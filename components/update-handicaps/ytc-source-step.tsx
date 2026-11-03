'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import {
  DialogBody,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { queryKeys } from '@/hooks/query-keys';
import { loadYtcRatings } from '@/lib/api-repository';
import { fleetTccVariant, ratingVariantFromTcc } from '@/lib/fleet-rating-variant';
import { defaultSailCountry } from '@/lib/rating-match';
import { planYtcUpdates, type PreviewRow } from '@/lib/source-handicaps';

import { PreviewSection } from './preview-section';
import { SourceAsOf } from './refresh-source';
import {
  FleetVariantSelector,
  MatchByNameCheckbox,
  StepFooter,
  buildPreviewUpdateRows,
  previewOutcome,
  splitPreviewRows,
  useExcludedRowIds,
  useFleetRatingChoices,
  type SourceStepProps,
} from './shared';

const YTC_SYSTEMS = ['ytc'] as const;

/**
 * YTC source: match each boat by sail number against the RORC's YTC listing
 * and propose its YTC number — the spinnaker number, or the white-sail one for
 * a fleet set to it.
 */
export function YtcSourceStep({
  competitors,
  fleets,
  applying,
  errorMsg,
  onApply,
  onCancel,
}: SourceStepProps) {
  // Spinnaker or white sail per YTC fleet, starting from what each fleet
  // remembers. The listing's pair is the IRC spin/non-spin split again.
  const choices = useFleetRatingChoices(fleets, YTC_SYSTEMS, fleetTccVariant, ratingVariantFromTcc);
  const variantByFleet = choices.choiceByFleet;
  const [matchByName, setMatchByName] = useState(false);
  const exclusions = useExcludedRowIds();
  const queryClient = useQueryClient();

  const ytcRatings = useQuery({
    queryKey: queryKeys.ytcRatings.all,
    queryFn: () => loadYtcRatings(),
    staleTime: 60 * 60 * 1000, // one national list; fine to reuse within a session
  });

  const defaultCountry = defaultSailCountry();

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!competitors || !fleets || !ytcRatings.data) return [];
    return planYtcUpdates({
      targetCompetitors: competitors,
      targetFleets: fleets,
      records: ytcRatings.data.records,
      ircVariantByFleet: variantByFleet,
      matchByName,
      defaultCountry,
    });
  }, [competitors, fleets, ytcRatings.data, variantByFleet, matchByName, defaultCountry]);

  const split = splitPreviewRows(previewRows, exclusions.rowSelection);

  const targetFleetById = useMemo(() => new Map((fleets ?? []).map((f) => [f.id, f])), [fleets]);
  const targetCompetitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c])),
    [competitors],
  );

  async function handleApply() {
    if (!(await choices.trySave())) return;
    onApply(
      buildPreviewUpdateRows(split.appliedChangeRows, [], targetCompetitorById),
      previewOutcome(split, 0),
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update handicaps from the YTC listing</DialogTitle>
        <DialogDescription>
          We match each boat by sail number against the RORC&apos;s list of current YTC
          certificates and propose its YTC number.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="space-y-4 py-2">
        <FleetVariantSelector
          heading="YTC number per fleet"
          fleets={choices.sourceFleets}
          variantByFleet={variantByFleet}
          onChange={choices.setChoice}
          spinLabel="Spinnaker"
          nonSpinLabel="White sail"
          hint="Set a fleet that races without spinnakers to its white-sail numbers. Each fleet remembers its choice."
        />
        {choices.error && <p className="text-sm text-destructive">{choices.error}</p>}

        <MatchByNameCheckbox checked={matchByName} onChange={setMatchByName} />

        {ytcRatings.isLoading && (
          <p className="text-sm text-muted-foreground">Loading the YTC listing…</p>
        )}

        {ytcRatings.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load the YTC listing. Please try again later.
          </p>
        )}

        {ytcRatings.data && (
          <>
            <PreviewSection
              changedRows={split.changedRows}
              unchangedRows={split.unchangedRows}
              notFoundRows={split.notFoundRows}
              rowSelection={exclusions.rowSelection}
              targetCompetitorById={targetCompetitorById}
              targetFleetById={targetFleetById}
              sourceFleetById={new Map()}
            />

            <SourceAsOf
              label="YTC listing"
              updatedAt={ytcRatings.data.updatedAt}
              fetchedAt={ytcRatings.data.fetchedAt}
              what="the YTC listing"
              onRefresh={async () => {
                const fresh = await loadYtcRatings({ refresh: true });
                queryClient.setQueryData(queryKeys.ytcRatings.all, fresh);
              }}
            />

            {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
          </>
        )}
      </DialogBody>

      <StepFooter
        onCancel={onCancel}
        onApply={handleApply}
        disabled={!ytcRatings.data || split.appliedChangeRows.length === 0 || applying}
        applying={applying}
        count={split.appliedChangeRows.length}
        onSaveChoices={choices.saveChoicesThen(onCancel)}
      />
    </>
  );
}
