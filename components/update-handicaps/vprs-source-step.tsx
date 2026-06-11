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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { queryKeys } from '@/hooks/query-keys';
import { loadVprsClubRatings, loadVprsClubs } from '@/lib/api-repository';
import { defaultSailCountry, type IrcTccVariant } from '@/lib/rating-match';
import { planVprsUpdates, type PreviewRow } from '@/lib/source-handicaps';

import { PreviewSection } from './preview-section';
import {
  FleetVariantSelector,
  MatchByNameCheckbox,
  StepFooter,
  buildPreviewUpdateRows,
  previewOutcome,
  splitPreviewRows,
  type SourceStepProps,
} from './shared';

/**
 * VPRS source: pick a club, then match each boat by sail number against
 * that club's published VPRS rating list and propose its TCC, with
 * per-fleet spin/no-spin variants.
 */
export function VprsSourceStep({
  competitors,
  fleets,
  applying,
  errorMsg,
  onApply,
  onCancel,
}: SourceStepProps) {
  // VPRS source: which club's listing to pull (a VprsClub id).
  const [vprsClubId, setVprsClubId] = useState<string | null>(null);
  // Spin/no-spin per VPRS fleet; a fleet absent from the map defaults to spin.
  const [variantByFleet, setVariantByFleet] = useState<Record<string, IrcTccVariant>>({});
  const [matchByName, setMatchByName] = useState(false);
  const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set());

  // The club index loads when the step opens; the selected club's listing
  // loads only once a club is picked, matching the server's per-club caching.
  const vprsClubs = useQuery({
    queryKey: queryKeys.vprsClubs.all,
    queryFn: () => loadVprsClubs(),
    staleTime: 60 * 60 * 1000,
  });
  const vprsRatings = useQuery({
    queryKey: queryKeys.vprsClubRatings.byClub(vprsClubId ?? ''),
    queryFn: () => loadVprsClubRatings(vprsClubId!),
    enabled: vprsClubId !== null,
    staleTime: 60 * 60 * 1000,
  });

  const defaultCountry = defaultSailCountry();

  // VPRS clubs, with local clubs surfaced first. As a deployment hint, when the
  // instance's default sail country is Ireland (NEXT_PUBLIC_DEFAULT_SAIL_COUNTRY
  // = "IRL"), Irish clubs lead, then the rest in the site's document order.
  const vprsClubGroups = useMemo(() => {
    const all = vprsClubs.data?.clubs ?? [];
    if (defaultCountry !== 'IRL') return { local: [], rest: all };
    return {
      local: all.filter((c) => c.region.toLowerCase() === 'ireland'),
      rest: all.filter((c) => c.region.toLowerCase() !== 'ireland'),
    };
  }, [vprsClubs.data, defaultCountry]);

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!competitors || !fleets || !vprsRatings.data) return [];
    return planVprsUpdates({
      targetCompetitors: competitors,
      targetFleets: fleets,
      records: vprsRatings.data.records,
      ircVariantByFleet: variantByFleet,
      matchByName,
      defaultCountry,
    });
  }, [competitors, fleets, vprsRatings.data, variantByFleet, matchByName, defaultCountry]);

  const split = splitPreviewRows(previewRows, excludedRowIds);

  // VPRS fleets — each gets its own spin/no-spin selector.
  const vprsFleets = useMemo(
    () => (fleets ?? []).filter((f) => f.scoringSystem === 'vprs'),
    [fleets],
  );

  const targetFleetById = useMemo(() => new Map((fleets ?? []).map((f) => [f.id, f])), [fleets]);
  const targetCompetitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c])),
    [competitors],
  );

  function handleApply() {
    onApply(
      buildPreviewUpdateRows(split.appliedChangeRows, [], targetCompetitorById),
      previewOutcome(split, 0),
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update handicaps from VPRS ratings</DialogTitle>
        <DialogDescription>
          Pick a club, then we match each boat by sail number against that club&apos;s
          published VPRS rating list and propose its TCC.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
        <div className="space-y-1">
          <label className="text-sm font-medium">Club</label>
          <Select value={vprsClubId ?? ''} onValueChange={(v) => setVprsClubId(v || null)}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={vprsClubs.isLoading ? 'Loading clubs…' : 'Pick a club…'} />
            </SelectTrigger>
            <SelectContent>
              {vprsClubGroups.local.length > 0 && (
                <>
                  <SelectGroup>
                    <SelectLabel>Ireland</SelectLabel>
                    {vprsClubGroups.local.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel>Other clubs</SelectLabel>
                    {vprsClubGroups.rest.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </>
              )}
              {vprsClubGroups.local.length === 0 &&
                vprsClubGroups.rest.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>

        {vprsClubs.isError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load the VPRS club list. Please try again later.
          </p>
        )}

        {vprsClubId && (
          <>
            <FleetVariantSelector
              heading="VPRS rating per fleet"
              fleets={vprsFleets}
              variantByFleet={variantByFleet}
              onChange={(fleetId, variant) =>
                setVariantByFleet((prev) => ({ ...prev, [fleetId]: variant }))
              }
              nonSpinLabel="No-spinnaker TCC"
              hint="Set non-spinnaker classes to use their no-spin TCC."
            />

            <MatchByNameCheckbox checked={matchByName} onChange={setMatchByName} />

            {vprsRatings.isLoading && (
              <p className="text-sm text-muted-foreground">Loading club ratings…</p>
            )}

            {vprsRatings.isError && (
              <p className="text-sm text-destructive">
                Couldn&apos;t load that club&apos;s VPRS ratings. Please try again later.
              </p>
            )}

            {vprsRatings.data && (
              <>
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
                  sourceFleetById={new Map()}
                />

                {vprsRatings.data.updatedAt && (
                  <p className="text-xs text-muted-foreground">
                    VPRS ratings as of {vprsRatings.data.updatedAt}.
                  </p>
                )}

                {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
              </>
            )}
          </>
        )}
      </div>

      <StepFooter
        onCancel={onCancel}
        onApply={handleApply}
        disabled={!vprsRatings.data || split.appliedChangeRows.length === 0 || applying}
        applying={applying}
        count={split.appliedChangeRows.length}
      />
    </>
  );
}
