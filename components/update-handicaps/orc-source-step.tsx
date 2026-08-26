'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import {
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { queryKeys } from '@/hooks/query-keys';
import { loadOrcCertificates } from '@/lib/api-repository';
import {
  ORC_FAMILY_LABEL,
  type OrcCertEntry,
  type OrcCertListing,
  type OrcFamily,
} from '@/lib/orc-certificate';
import { defaultSailCountry } from '@/lib/rating-match';
import {
  additionKey,
  orcPlanChecks,
  planOrcFleetAdditions,
  planOrcFleetRemovals,
  planOrcUpdates,
  removalKey,
  type FleetAdditionCandidate,
  type FleetRemovalCandidate,
  type PreviewRow,
} from '@/lib/source-handicaps';
import type { Fleet } from '@/lib/types';

import { AddToFleetSection } from './add-to-fleet-section';
import { RemoveFromFleetSection } from './remove-from-fleet-section';
import { PreviewSection } from './preview-section';
import {
  MatchByNameCheckbox,
  StepFooter,
  buildPreviewUpdateRows,
  previewOutcome,
  splitPreviewRows,
  useCompetitorIdsWithResults,
  useRatingListSelections,
  useSeriesHasRaces,
  type SourceStepProps,
} from './shared';

/**
 * ORC certificate source: pick the issuing country, choose each ORC fleet's
 * certificate family (standard / non-spinnaker / double-handed), then match
 * each boat by sail number against the ORC database's active-certificates
 * listing. An apply writes the whole certificate to the competitor — the
 * certificate is the rating.
 */
export function OrcSourceStep({
  seriesId,
  competitors,
  fleets,
  applying,
  errorMsg,
  onApply,
  onCancel,
}: SourceStepProps) {
  // Issuing country. Certificates from any country are valid at any event
  // (ORC rule 303.2) — visiting boats may need a second pass with theirs.
  const [country, setCountry] = useState(defaultSailCountry() || 'IRL');
  // Certificate family per ORC fleet; absent means standard fully-crewed.
  const [familyByFleet, setFamilyByFleet] = useState<Record<string, OrcFamily>>({});
  const sel = useRatingListSelections();

  // Stable "now" for deterministic planning within the step's lifetime.
  const [now] = useState(() => Date.now());

  const orcFleets = useMemo(
    () => (fleets ?? []).filter((f) => f.scoringSystem === 'orc'),
    [fleets],
  );
  const familiesNeeded = useMemo(() => {
    const set = new Set<OrcFamily>();
    for (const f of orcFleets) set.add(familyByFleet[f.id] ?? 'ORC');
    return set;
  }, [orcFleets, familyByFleet]);

  const countryValid = /^[A-Za-z]{2,3}$/.test(country.trim());
  const countryId = country.trim().toUpperCase();

  // One fixed query per family (hooks can't be dynamic), enabled on demand.
  const familyQueryOptions = (family: OrcFamily) => ({
    queryKey: queryKeys.orcCertificates.byCountryFamily(countryId, family),
    queryFn: () => loadOrcCertificates(countryId, family),
    staleTime: 60 * 60 * 1000,
    enabled: countryValid && familiesNeeded.has(family),
  });
  const standard = useQuery(familyQueryOptions('ORC'));
  const nonSpin = useQuery(familyQueryOptions('NS'));
  const doubleHanded = useQuery(familyQueryOptions('DH'));

  const entriesByFamily = useMemo(() => {
    const out: Partial<Record<OrcFamily, readonly OrcCertEntry[]>> = {};
    if (familiesNeeded.has('ORC') && standard.data) out.ORC = standard.data.records;
    if (familiesNeeded.has('NS') && nonSpin.data) out.NS = nonSpin.data.records;
    if (familiesNeeded.has('DH') && doubleHanded.data) out.DH = doubleHanded.data.records;
    return out;
  }, [familiesNeeded, standard.data, nonSpin.data, doubleHanded.data]);

  const familyStates: Array<{ family: OrcFamily; q: { isLoading: boolean; isError: boolean; data?: OrcCertListing } }> = [
    { family: 'ORC', q: standard },
    { family: 'NS', q: nonSpin },
    { family: 'DH', q: doubleHanded },
  ];
  const needed = familyStates.filter(({ family }) => familiesNeeded.has(family));
  const anyLoading = needed.some(({ q }) => q.isLoading);
  const anyError = needed.some(({ q }) => q.isError);
  const allLoaded = needed.every(({ q }) => q.data != null);

  const defaultCountry = defaultSailCountry();
  const seriesHasRaces = useSeriesHasRaces(seriesId);
  const competitorIdsWithResults = useCompetitorIdsWithResults(seriesId);

  const planInput = useMemo(
    () => ({
      targetCompetitors: competitors ?? [],
      targetFleets: fleets ?? [],
      entriesByFamily,
      familyByFleet,
      matchByName: sel.matchByName,
      defaultCountry,
      now,
    }),
    [competitors, fleets, entriesByFamily, familyByFleet, sel.matchByName, defaultCountry, now],
  );

  const previewRows = useMemo<PreviewRow[]>(
    () => (competitors && fleets ? planOrcUpdates(planInput) : []),
    [competitors, fleets, planInput],
  );
  const additionCandidates = useMemo<FleetAdditionCandidate[]>(
    () =>
      competitors && fleets
        ? planOrcFleetAdditions({ ...planInput, targetFleetByKey: sel.addTargetFleetByKey })
        : [],
    [competitors, fleets, planInput, sel.addTargetFleetByKey],
  );
  const removalCandidates = useMemo<FleetRemovalCandidate[]>(
    () =>
      competitors && fleets
        ? planOrcFleetRemovals({ ...planInput, competitorIdsWithResults })
        : [],
    [competitors, fleets, planInput, competitorIdsWithResults],
  );

  const checkedRemovals = removalCandidates.filter((c) =>
    sel.removeSelected.has(removalKey(c.competitorId, c.fleetId)),
  );
  const checkedAdditions = additionCandidates.filter(
    (c) => sel.addSelected.has(additionKey(c.competitorId, c.system)) && c.targetFleetId && c.proposedTcf !== null,
  );
  const split = splitPreviewRows(previewRows, sel.excludedRowIds);

  // Import-time sanity checks over what an apply would write.
  const checks = useMemo(
    () =>
      orcPlanChecks(
        [
          ...split.appliedChangeRows,
          ...checkedAdditions.map((c) => ({ orcCert: c.orcCert }) as PreviewRow),
        ],
        now,
      ),
    [split.appliedChangeRows, checkedAdditions, now],
  );

  const targetFleetById = useMemo(() => new Map((fleets ?? []).map((f) => [f.id, f])), [fleets]);
  const targetCompetitorById = useMemo(
    () => new Map((competitors ?? []).map((c) => [c.id, c])),
    [competitors],
  );

  function handleApply() {
    onApply(
      buildPreviewUpdateRows(
        split.appliedChangeRows,
        checkedAdditions,
        targetCompetitorById,
        checkedRemovals,
      ),
      previewOutcome(split, checkedAdditions.length),
    );
  }

  const updatedAt = needed.map(({ q }) => q.data?.updatedAt).find((d) => d != null);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Update handicaps from ORC certificates</DialogTitle>
        <DialogDescription>
          We match each boat by sail number against the ORC database&apos;s active
          certificates and import the whole certificate — ratings, class-division
          numbers, and the time-allowance matrix.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
        <div className="space-y-1">
          <label className="text-sm font-medium" htmlFor="orc-country">
            Issuing country
          </label>
          <Input
            id="orc-country"
            className="w-24 uppercase"
            value={country}
            maxLength={3}
            onChange={(e) => setCountry(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            The national rating office that issued the certificates (e.g. IRL). A
            certificate from any country is valid; run this source once per
            country for visiting boats.
          </p>
        </div>

        {orcFleets.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This series has no ORC fleets. Set a fleet&apos;s scoring system to ORC
            on the Settings tab first.
          </p>
        )}

        <OrcFamilySelector
          fleets={orcFleets}
          familyByFleet={familyByFleet}
          onChange={(fleetId, family) =>
            setFamilyByFleet((prev) => ({ ...prev, [fleetId]: family }))
          }
        />

        <MatchByNameCheckbox checked={sel.matchByName} onChange={sel.setMatchByName} />

        {!countryValid && (
          <p className="text-sm text-destructive">Enter a 2–3 letter country code.</p>
        )}
        {anyLoading && (
          <p className="text-sm text-muted-foreground">Loading ORC certificates…</p>
        )}
        {anyError && (
          <p className="text-sm text-destructive">
            Couldn&apos;t load the ORC certificate listing. Check the country code, or
            try again later.
          </p>
        )}

        {allLoaded && orcFleets.length > 0 && (
          <>
            {checks.expiredCount > 0 && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                {checks.expiredCount === 1
                  ? '1 certificate to be imported has expired.'
                  : `${checks.expiredCount} certificates to be imported have expired.`}
              </p>
            )}
            {checks.vppYears.length > 1 && (
              <p className="text-sm text-amber-600 dark:text-amber-500">
                Mixed VPP years ({checks.vppYears.join(', ')}) — ORC requires all
                boats in an event to be rated by the same VPP year.
              </p>
            )}

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
              targetFleetById={targetFleetById}
              seriesHasRaces={seriesHasRaces}
            />

            <RemoveFromFleetSection
              candidates={removalCandidates}
              selected={sel.removeSelected}
              onToggle={sel.toggleRemoval}
              onToggleAll={sel.toggleAllRemovals}
              targetCompetitorById={targetCompetitorById}
            />

            {updatedAt && (
              <p className="text-xs text-muted-foreground">
                ORC certificates as of {updatedAt}.
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
          !allLoaded ||
          split.appliedChangeRows.length + checkedAdditions.length + checkedRemovals.length === 0 ||
          applying
        }
        applying={applying}
        count={split.appliedChangeRows.length + checkedAdditions.length + checkedRemovals.length}
      />
    </>
  );
}

/** Per-fleet certificate-family selector — the ORC analogue of the IRC
 *  spin/non-spin selector. */
function OrcFamilySelector({
  fleets,
  familyByFleet,
  onChange,
}: {
  fleets: Fleet[];
  familyByFleet: Record<string, OrcFamily>;
  onChange: (fleetId: string, family: OrcFamily) => void;
}) {
  if (fleets.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">Certificate family per fleet</div>
      <div className="rounded-md border">
        {fleets.map((f, i) => (
          <div key={f.id} className={`flex items-center gap-3 p-2 ${i > 0 ? 'border-t' : ''}`}>
            <div className="flex-1 text-sm font-medium">{f.name}</div>
            <Select
              value={familyByFleet[f.id] ?? 'ORC'}
              onValueChange={(v) => onChange(f.id, v as OrcFamily)}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(['ORC', 'NS', 'DH'] as const).map((family) => (
                  <SelectItem key={family} value={family}>
                    {ORC_FAMILY_LABEL[family]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        A boat may hold a non-spinnaker or double-handed certificate alongside its
        standard one; it is scored on the family its fleet races under.
      </p>
    </div>
  );
}
