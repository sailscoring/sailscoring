'use client';

import { forwardRef, useImperativeHandle, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCompetitorsBySeries, useUpdateHandicaps } from '@/hooks/use-competitors';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { queryKeys } from '@/hooks/query-keys';
import { useSeriesList } from '@/hooks/use-series';
import { useFeatures } from '@/components/features-provider';
import { ConflictApiError } from '@/lib/api-client';
import {
  competitorRepo,
  fleetRepo,
  listTcfHistoryBySeries,
  loadIrcRatings,
  loadIrishSailingRatings,
  raceRepo,
  type HandicapUpdateRow,
} from '@/lib/api-repository';
import { defaultSailCountry, type IrcTccVariant } from '@/lib/rating-match';
import {
  endOfSeriesTcfs,
  planHandicapUpdates,
  planRyaPyUpdates,
  additionKey,
  planEchoFleetAdditions,
  planEchoUpdates,
  planIrcFleetAdditions,
  planIrcUpdates,
  proposeFleetMapping,
  type FleetAdditionCandidate,
  type HandicapSystem,
  type PreviewRow,
  type PyClassProposal,
  type RatingMatch,
} from '@/lib/source-handicaps';
import { classKey, ryaPyMatcher } from '@/lib/rya-py/class-match';
import { RYA_PY_VERSION } from '@/lib/rya-py/generated/py-list';
import type { RyaPyClass } from '@/lib/rya-py/types';
import type { Competitor, Fleet } from '@/lib/types';

type HandicapSource = 'series' | 'irish-sailing' | 'irc-rating' | 'rya-py';

export interface UpdateHandicapsHandle {
  open: () => void;
}

const SYSTEM_LABEL: Record<HandicapSystem, string> = {
  nhc: 'NHC',
  echo: 'ECHO',
  irc: 'IRC',
  py: 'PY',
};

/** The TCF field on `Competitor` written for each handicap system. */
const SYSTEM_FIELD: Record<HandicapSystem, keyof Pick<Competitor, 'nhcStartingTcf' | 'echoStartingTcf' | 'ircTcc' | 'pyNumber'>> = {
  nhc: 'nhcStartingTcf',
  echo: 'echoStartingTcf',
  irc: 'ircTcc',
  py: 'pyNumber',
};

function rowKey(r: PreviewRow): string {
  return `${r.competitorId}::${r.targetFleetId}::${r.system}`;
}

function formatTcf(v: number | null, system: HandicapSystem): string {
  if (v === null) return '—';
  // PY numbers are integers; the three TCFs are decimal, always 3 dp
  // (even when the stored value happens to be a round number).
  return system === 'py' ? String(Math.round(v)) : v.toFixed(3);
}

/** System label for a preview row — IRC rows from Irish Sailing also show
 *  which TCC variant was used, so a mixed spin/non-spin run is auditable. */
function systemLabel(r: PreviewRow): string {
  if (r.system === 'irc' && r.ircVariant) {
    return `IRC (${r.ircVariant === 'non-spin' ? 'non-spin' : 'spin'})`;
  }
  return SYSTEM_LABEL[r.system];
}

/** Human description of a non-exact Irish Sailing match, for the scorer to
 *  verify the right boat was picked. */
function describeMatch(m: RatingMatch): string {
  const who = `${m.sail}${m.name ? ` · ${m.name}` : ''}`;
  return m.method === 'name'
    ? `matched by name → ${who}`
    : `matched without country code → ${who}`;
}

function formatDelta(currentTcf: number | null, newTcf: number, system: HandicapSystem): string {
  if (currentTcf === null) return `+${formatTcf(newTcf, system)}`;
  const d = newTcf - currentTcf;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  if (d === 0) return '0';
  return `${sign}${formatTcf(Math.abs(d), system)}`;
}

const TIER_LABEL: Partial<Record<RyaPyClass['tier'], string>> = {
  experimental: 'experimental',
  'limited-data': 'limited data',
};

/** Whether a resolved proposal can rename any of its boats (their stored class
 *  differs from the canonical name) and/or change any PY number. */
function ryaPyChanges(
  p: PyClassProposal,
  competitorById: Map<string, Competitor>,
): { canRename: boolean; canSetNumber: boolean } {
  const r = p.resolved;
  if (!r) return { canRename: false, canSetNumber: false };
  return {
    canRename: p.affected.some((a) => competitorById.get(a.competitorId)?.boatClass !== r.name),
    canSetNumber: p.affected.some((a) => a.currentNumber !== r.number),
  };
}

/** Fan resolved PY proposals out to per-competitor update rows, honouring the
 *  per-class rename/number toggles (a key in the `off` sets is switched off).
 *  Only boats with a real change are included. */
function buildRyaPyUpdates(
  proposals: PyClassProposal[],
  competitorById: Map<string, Competitor>,
  renameOff: Set<string>,
  numberOff: Set<string>,
): HandicapUpdateRow[] {
  const rows: HandicapUpdateRow[] = [];
  for (const p of proposals) {
    const r = p.resolved;
    if (!r) continue;
    const { canRename, canSetNumber } = ryaPyChanges(p, competitorById);
    const renameApplied = canRename && !renameOff.has(p.enteredKey);
    const numberApplied = canSetNumber && !numberOff.has(p.enteredKey);
    if (!renameApplied && !numberApplied) continue;

    for (const a of p.affected) {
      const comp = competitorById.get(a.competitorId);
      if (!comp || comp.version === undefined) continue;
      const needNumber = numberApplied && a.currentNumber !== r.number;
      const needRename = renameApplied && comp.boatClass !== r.name;
      if (!needNumber && !needRename) continue;
      const row: HandicapUpdateRow = { competitorId: comp.id, expectedVersion: comp.version };
      if (needNumber) row.pyNumber = r.number;
      if (needRename) row.boatClass = r.name;
      rows.push(row);
    }
  }
  return rows;
}

export const UpdateHandicaps = forwardRef<UpdateHandicapsHandle, {
  seriesId: string;
}>(function UpdateHandicaps({ seriesId }, ref) {
  const { has } = useFeatures();
  // ECHO is the single Irish/ECHO gate — it covers both the scoring system
  // and this Irish Sailing ECHO source. IRC TCC is gated separately (on by
  // default).
  const irishSailingEnabled = has('echo');
  const ircRatingEnabled = has('irc-rating');
  const ryaPyEnabled = has('rya-py');

  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<
    | 'source-picker'
    | 'source-series'
    | 'source-irish-sailing'
    | 'source-irc-rating'
    | 'source-rya-py'
    | 'done'
  >('source-picker');
  const [source, setSource] = useState<HandicapSource>('series');
  const [sourceSeriesId, setSourceSeriesId] = useState<string | null>(null);
  // Spin/non-spin per IRC fleet; a fleet absent from the map defaults to spin.
  const [ircVariantByFleet, setIrcVariantByFleet] = useState<Record<string, IrcTccVariant>>({});
  const [matchByName, setMatchByName] = useState(false);
  // Per-boat certificate override (boats holding a primary + secondary "(SC)").
  const [certChoiceByCompetitor, setCertChoiceByCompetitor] = useState<Record<string, string>>({});
  // Add-to-fleet (#170): which candidates are ticked, and each one's target fleet.
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addTargetFleetByKey, setAddTargetFleetByKey] = useState<Record<string, string>>({});
  const [fleetMapping, setFleetMapping] = useState<Record<string, string | null>>({});
  const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set());
  // RYA PY source: manual class resolution (enteredKey → classKey | '__skip__'),
  // and per-class opt-outs of the rename / set-number halves of a proposal.
  const [chosenByClass, setChosenByClass] = useState<Record<string, string>>({});
  const [renameOff, setRenameOff] = useState<Set<string>>(new Set());
  const [numberOff, setNumberOff] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{
    updatedCount: number;
    bySystem: Partial<Record<HandicapSystem, number>>;
    unchanged: number;
    notFound: number;
    added: number;
    /** RYA PY source: how many boats had their class name normalised. */
    renamed?: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    open: () => {
      setStep('source-picker');
      setSource('series');
      setSourceSeriesId(null);
      setIrcVariantByFleet({});
      setMatchByName(false);
      setCertChoiceByCompetitor({});
      setAddSelected(new Set());
      setAddTargetFleetByKey({});
      setFleetMapping({});
      setExcludedRowIds(new Set());
      setChosenByClass({});
      setRenameOff(new Set());
      setNumberOff(new Set());
      setResult(null);
      setErrorMsg(null);
      setOpen(true);
    },
  }));

  // ── Target data (the active series) ────────────────────────────────────────
  const targetCompetitors = useCompetitorsBySeries(seriesId);
  const targetFleets = useFleetsBySeries(seriesId);
  const allSeries = useSeriesList();

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

  const updateMut = useUpdateHandicaps(seriesId);

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
    targetFleets.data
  ) {
    setSeededForSourceSeriesId(sourceSeriesId);
    setFleetMapping(proposeFleetMapping(targetFleets.data, sourceFleets.data));
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

  const seriesPreviewRows = useMemo<PreviewRow[]>(() => {
    if (!targetCompetitors.data || !targetFleets.data || !sourceCompetitors.data) return [];
    return planHandicapUpdates({
      targetCompetitors: targetCompetitors.data,
      targetFleets: targetFleets.data,
      sourceCompetitors: sourceCompetitors.data,
      endOfSourceTcfs: endTcfs,
      fleetMapping,
    });
  }, [targetCompetitors.data, targetFleets.data, sourceCompetitors.data, endTcfs, fleetMapping]);

  // ── Rating-list sources, loaded only when their step is active ─────────────
  // Irish Sailing → ECHO; the worldwide IRC ClubListing → IRC. Two separate
  // authorities, two separate fetches.
  const irishRatings = useQuery({
    queryKey: queryKeys.irishSailingRatings.all,
    queryFn: () => loadIrishSailingRatings(),
    enabled: step === 'source-irish-sailing',
    staleTime: 60 * 60 * 1000, // national list; fine to reuse within a session
  });
  const ircRatings = useQuery({
    queryKey: queryKeys.ircRatings.all,
    queryFn: () => loadIrcRatings(),
    enabled: step === 'source-irc-rating',
    staleTime: 60 * 60 * 1000, // worldwide list; fine to reuse within a session
  });

  // Country to assume for a competitor's prefix-less sail number (deployment
  // parameter — IRL by default). Matters most against the worldwide IRC list.
  const defaultCountry = defaultSailCountry();

  const echoPreviewRows = useMemo<PreviewRow[]>(() => {
    if (!targetCompetitors.data || !targetFleets.data || !irishRatings.data) return [];
    return planEchoUpdates({
      targetCompetitors: targetCompetitors.data,
      targetFleets: targetFleets.data,
      records: irishRatings.data.records,
      matchByName,
      defaultCountry,
    });
  }, [targetCompetitors.data, targetFleets.data, irishRatings.data, matchByName, defaultCountry]);

  const ircPreviewRows = useMemo<PreviewRow[]>(() => {
    if (!targetCompetitors.data || !targetFleets.data || !ircRatings.data) return [];
    return planIrcUpdates({
      targetCompetitors: targetCompetitors.data,
      targetFleets: targetFleets.data,
      records: ircRatings.data.records,
      ircVariantByFleet,
      matchByName,
      certChoiceByCompetitor,
      defaultCountry,
    });
  }, [targetCompetitors.data, targetFleets.data, ircRatings.data, ircVariantByFleet, matchByName, certChoiceByCompetitor, defaultCountry]);

  // IRC fleets in the target series — each gets its own spin/non-spin selector
  // (IRC source only).
  const ircFleets = useMemo(
    () => (targetFleets.data ?? []).filter((f) => f.scoringSystem === 'irc'),
    [targetFleets.data],
  );

  // Races in the target series — drives the DNC caution on fleet additions.
  const targetRaces = useQuery({
    queryKey: queryKeys.races.bySeries(seriesId),
    queryFn: () => raceRepo.listBySeries(seriesId),
    enabled: step === 'source-irish-sailing' || step === 'source-irc-rating',
  });
  const seriesHasRaces = (targetRaces.data?.length ?? 0) > 0;

  // Add-to-fleet candidates (#170): rated boats not yet in the matching fleet.
  // ECHO additions come from Irish Sailing, IRC additions from the IRC list.
  const echoAdditions = useMemo<FleetAdditionCandidate[]>(() => {
    if (!targetCompetitors.data || !targetFleets.data || !irishRatings.data) return [];
    return planEchoFleetAdditions({
      targetCompetitors: targetCompetitors.data,
      targetFleets: targetFleets.data,
      records: irishRatings.data.records,
      matchByName,
      targetFleetByKey: addTargetFleetByKey,
      defaultCountry,
    });
  }, [targetCompetitors.data, targetFleets.data, irishRatings.data, matchByName, addTargetFleetByKey, defaultCountry]);

  const ircAdditions = useMemo<FleetAdditionCandidate[]>(() => {
    if (!targetCompetitors.data || !targetFleets.data || !ircRatings.data) return [];
    return planIrcFleetAdditions({
      targetCompetitors: targetCompetitors.data,
      targetFleets: targetFleets.data,
      records: ircRatings.data.records,
      ircVariantByFleet,
      matchByName,
      certChoiceByCompetitor,
      targetFleetByKey: addTargetFleetByKey,
      defaultCountry,
    });
  }, [targetCompetitors.data, targetFleets.data, ircRatings.data, ircVariantByFleet, matchByName, certChoiceByCompetitor, addTargetFleetByKey, defaultCountry]);

  // RYA PY proposals — pure over the bundled dataset (no fetch); one per
  // distinct class across the series' PY fleets.
  const ryaPyProposals = useMemo<PyClassProposal[]>(() => {
    if (step !== 'source-rya-py' || !targetCompetitors.data || !targetFleets.data) return [];
    return planRyaPyUpdates({
      targetCompetitors: targetCompetitors.data,
      targetFleets: targetFleets.data,
      chosenByClass,
    });
  }, [step, targetCompetitors.data, targetFleets.data, chosenByClass]);

  const ryaPyUpdateRows = useMemo(() => {
    const byId = new Map((targetCompetitors.data ?? []).map((c) => [c.id, c]));
    return buildRyaPyUpdates(ryaPyProposals, byId, renameOff, numberOff);
  }, [ryaPyProposals, targetCompetitors.data, renameOff, numberOff]);

  const additionCandidates = step === 'source-irc-rating' ? ircAdditions : echoAdditions;

  // A candidate can actually be applied once it has a target fleet and a value.
  const checkedAdditions = additionCandidates.filter(
    (c) => addSelected.has(additionKey(c.competitorId, c.system)) && c.targetFleetId && c.proposedTcf !== null,
  );

  const previewRows =
    step === 'source-irc-rating'
      ? ircPreviewRows
      : step === 'source-irish-sailing'
        ? echoPreviewRows
        : seriesPreviewRows;

  // ── Apply ──────────────────────────────────────────────────────────────────
  async function handleApplyRyaPy() {
    setErrorMsg(null);
    if (ryaPyUpdateRows.length === 0) return;
    try {
      const response = await updateMut.mutateAsync(ryaPyUpdateRows);
      const renamed = ryaPyUpdateRows.filter((r) => r.boatClass !== undefined).length;
      const numberChanged = ryaPyUpdateRows.filter((r) => r.pyNumber !== undefined).length;
      const resolvedKeys = new Set(
        ryaPyProposals.filter((p) => p.resolved).map((p) => p.enteredKey),
      );
      const notFound = ryaPyProposals
        .filter((p) => !resolvedKeys.has(p.enteredKey))
        .reduce((n, p) => n + p.affected.length, 0);
      setResult({
        updatedCount: response.updated.length,
        bySystem: { py: numberChanged },
        unchanged: 0,
        notFound,
        added: 0,
        renamed,
      });
      setStep('done');
    } catch (err) {
      if (err instanceof ConflictApiError) {
        setErrorMsg(
          'A boat was modified elsewhere since you opened this dialog. Close and reopen to refresh, then try again.',
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Update failed');
      }
    }
  }

  async function handleApply() {
    if (step === 'source-rya-py') return handleApplyRyaPy();
    setErrorMsg(null);
    const changeRows = previewRows.filter((r) => r.status === 'change' && !excludedRowIds.has(rowKey(r)));
    if (changeRows.length === 0 && checkedAdditions.length === 0) return;

    const compById = new Map((targetCompetitors.data ?? []).map((c) => [c.id, c]));
    const updatesByComp = new Map<string, HandicapUpdateRow>();
    function rowFor(competitorId: string): HandicapUpdateRow | null {
      const comp = compById.get(competitorId);
      if (!comp || comp.version === undefined) return null;
      let update = updatesByComp.get(comp.id);
      if (!update) {
        update = { competitorId: comp.id, expectedVersion: comp.version };
        updatesByComp.set(comp.id, update);
      }
      return update;
    }

    for (const row of changeRows) {
      const update = rowFor(row.competitorId);
      if (!update) continue;
      const field = SYSTEM_FIELD[row.system];
      // Mutate via an unknown-cast index access — TS can't see that the
      // field name is statically one of the four optional number fields
      // on `HandicapUpdateRow`. Safe by construction (SYSTEM_FIELD maps
      // each HandicapSystem to the matching field) and the wire schema
      // validates on the server.
      (update as unknown as Record<string, number>)[field] = row.newTcf!;
    }

    // Fleet additions: union the target fleet and seed the rating in the same
    // per-competitor row (one CAS write even if the boat also has an update).
    for (const c of checkedAdditions) {
      const update = rowFor(c.competitorId);
      if (!update || !c.targetFleetId || c.proposedTcf === null) continue;
      update.addFleetIds = [...new Set([...(update.addFleetIds ?? []), c.targetFleetId])];
      const field = SYSTEM_FIELD[c.system];
      (update as unknown as Record<string, number>)[field] = c.proposedTcf;
    }

    if (updatesByComp.size === 0) return;

    try {
      const response = await updateMut.mutateAsync([...updatesByComp.values()]);
      const bySystem: Partial<Record<HandicapSystem, number>> = {};
      for (const row of changeRows) {
        bySystem[row.system] = (bySystem[row.system] ?? 0) + 1;
      }
      setResult({
        updatedCount: response.updated.length,
        bySystem,
        unchanged: previewRows.filter((r) => r.status === 'unchanged').length,
        notFound: previewRows.filter((r) => r.status === 'not-found').length,
        added: checkedAdditions.length,
      });
      setStep('done');
    } catch (err) {
      if (err instanceof ConflictApiError) {
        setErrorMsg(
          'A boat was modified elsewhere since you opened this dialog. Close and reopen to refresh, then try again.',
        );
      } else {
        setErrorMsg(err instanceof Error ? err.message : 'Update failed');
      }
    }
  }

  // ── Render helpers ─────────────────────────────────────────────────────────
  const targetFleetById = useMemo(
    () => new Map((targetFleets.data ?? []).map((f) => [f.id, f])),
    [targetFleets.data],
  );
  const sourceFleetById = useMemo(
    () => new Map((sourceFleets.data ?? []).map((f) => [f.id, f])),
    [sourceFleets.data],
  );
  const targetCompetitorById = useMemo(
    () => new Map((targetCompetitors.data ?? []).map((c) => [c.id, c])),
    [targetCompetitors.data],
  );

  const candidateSourceSeries = useMemo(() => {
    if (!allSeries.data) return [];
    return allSeries.data
      .filter((s) => s.id !== seriesId)
      .sort((a, b) => (b.lastModifiedAt ?? 0) - (a.lastModifiedAt ?? 0));
  }, [allSeries.data, seriesId]);

  const changedRows = previewRows.filter((r) => r.status === 'change');
  const unchangedRows = previewRows.filter((r) => r.status === 'unchanged');
  const notFoundRows = previewRows.filter((r) => r.status === 'not-found');
  const checkedChangedCount = changedRows.filter((r) => !excludedRowIds.has(rowKey(r))).length;
  const sourceDataLoading = sourceSeriesId !== null &&
    (sourceCompetitors.isLoading || sourceFleets.isLoading || sourceRaces.isLoading || sourceTcfHistory.isLoading);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] max-h-[90vh] w-[95vw] max-w-5xl sm:max-w-5xl">
        {step === 'source-picker' && (
          <>
            <DialogHeader>
              <DialogTitle>Update handicaps</DialogTitle>
              <DialogDescription>
                Where should we pull handicaps from?
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2 min-h-0 overflow-y-auto">
              <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                <input
                  type="radio"
                  name="source"
                  className="mt-1"
                  checked={source === 'series'}
                  onChange={() => setSource('series')}
                />
                <div>
                  <div className="font-medium">Another series in this workspace</div>
                  <div className="text-sm text-muted-foreground">
                    Use the boat&apos;s handicap at the end of a prior series as its starting
                    handicap here. Covers NHC, ECHO, IRC, and PY.
                  </div>
                </div>
              </label>

              {ircRatingEnabled && (
                <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="source"
                    className="mt-1"
                    checked={source === 'irc-rating'}
                    onChange={() => setSource('irc-rating')}
                  />
                  <div>
                    <div className="font-medium">IRC TCC (international)</div>
                    <div className="text-sm text-muted-foreground">
                      Pull each boat&apos;s current IRC TCC from the worldwide IRC rating list,
                      matched by sail number.
                    </div>
                  </div>
                </label>
              )}

              {irishSailingEnabled && (
                <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="source"
                    className="mt-1"
                    checked={source === 'irish-sailing'}
                    onChange={() => setSource('irish-sailing')}
                  />
                  <div>
                    <div className="font-medium">Irish Sailing ECHO</div>
                    <div className="text-sm text-muted-foreground">
                      Pull each boat&apos;s current ECHO handicap from the national Irish Sailing
                      ratings list, matched by sail number.
                    </div>
                  </div>
                </label>
              )}

              {ryaPyEnabled && (
                <label className="flex items-start gap-3 rounded-md border p-3 cursor-pointer">
                  <input
                    type="radio"
                    name="source"
                    className="mt-1"
                    checked={source === 'rya-py'}
                    onChange={() => setSource('rya-py')}
                  />
                  <div>
                    <div className="font-medium">RYA Portsmouth Yardstick</div>
                    <div className="text-sm text-muted-foreground">
                      Set each class&apos;s PY number from the RYA&apos;s published list, and tidy
                      class names to match. Matched by boat class, not sail number.
                    </div>
                  </div>
                </label>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={() =>
                  setStep(
                    source === 'irc-rating'
                      ? 'source-irc-rating'
                      : source === 'irish-sailing'
                        ? 'source-irish-sailing'
                        : source === 'rya-py'
                          ? 'source-rya-py'
                          : 'source-series',
                  )
                }
              >
                Next
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'source-series' && (
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

              {sourceSeriesId && !sourceDataLoading && targetFleets.data && (
                <>
                  <FleetMappingTable
                    targetFleets={targetFleets.data}
                    sourceFleets={sourceFleets.data ?? []}
                    fleetMapping={fleetMapping}
                    onChange={setFleetMapping}
                  />

                  <PreviewSection
                    changedRows={changedRows}
                    unchangedRows={unchangedRows}
                    notFoundRows={notFoundRows}
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

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={handleApply}
                disabled={
                  !sourceSeriesId ||
                  sourceDataLoading ||
                  checkedChangedCount === 0 ||
                  updateMut.isPending
                }
              >
                {updateMut.isPending ? 'Applying…' : `Apply ${checkedChangedCount}`}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'source-irc-rating' && (
          <>
            <DialogHeader>
              <DialogTitle>Update handicaps from IRC ratings</DialogTitle>
              <DialogDescription>
                We match each boat by sail number against the worldwide IRC rating list and
                propose its IRC TCC.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
              {ircFleets.length > 0 && (
                <div className="space-y-1">
                  <div className="text-sm font-medium">IRC rating per fleet</div>
                  <div className="rounded-md border">
                    {ircFleets.map((f, i) => (
                      <div
                        key={f.id}
                        className={`flex items-center gap-3 p-2 ${i > 0 ? 'border-t' : ''}`}
                      >
                        <div className="flex-1 text-sm font-medium">{f.name}</div>
                        <Select
                          value={ircVariantByFleet[f.id] ?? 'spin'}
                          onValueChange={(v) =>
                            setIrcVariantByFleet((prev) => ({ ...prev, [f.id]: v as IrcTccVariant }))
                          }
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="spin">Spinnaker TCC</SelectItem>
                            <SelectItem value="non-spin">Non-spinnaker TCC</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Set non-spinnaker classes to use their non-spin TCC.
                  </p>
                </div>
              )}

              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5"
                  checked={matchByName}
                  onChange={(e) => setMatchByName(e.target.checked)}
                />
                <span>
                  Also match by boat name
                  <span className="block text-xs text-muted-foreground">
                    Helps when a sail number is entered without its country code or doesn&apos;t
                    match. Names collide more easily — check the proposed boat before applying.
                  </span>
                </span>
              </label>

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
                    changedRows={changedRows}
                    unchangedRows={unchangedRows}
                    notFoundRows={notFoundRows}
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
                    onChooseCert={(competitorId, certId) =>
                      setCertChoiceByCompetitor((prev) => ({ ...prev, [competitorId]: certId }))
                    }
                  />

                  <AddToFleetSection
                    candidates={additionCandidates}
                    selected={addSelected}
                    onToggle={(key, on) =>
                      setAddSelected((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                    onChooseFleet={(key, fleetId) =>
                      setAddTargetFleetByKey((prev) => ({ ...prev, [key]: fleetId }))
                    }
                    onChooseCert={(competitorId, certId) =>
                      setCertChoiceByCompetitor((prev) => ({ ...prev, [competitorId]: certId }))
                    }
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

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={handleApply}
                disabled={
                  !ircRatings.data ||
                  checkedChangedCount + checkedAdditions.length === 0 ||
                  updateMut.isPending
                }
              >
                {updateMut.isPending
                  ? 'Applying…'
                  : `Apply ${checkedChangedCount + checkedAdditions.length}`}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'source-irish-sailing' && (
          <>
            <DialogHeader>
              <DialogTitle>Update handicaps from Irish Sailing ECHO</DialogTitle>
              <DialogDescription>
                We match each boat by sail number against the national Irish Sailing ratings
                list and propose its ECHO handicap.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
              <label className="flex items-start gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 h-3.5 w-3.5"
                  checked={matchByName}
                  onChange={(e) => setMatchByName(e.target.checked)}
                />
                <span>
                  Also match by boat name
                  <span className="block text-xs text-muted-foreground">
                    Helps when a sail number is entered without its country code or doesn&apos;t
                    match. Names collide more easily — check the proposed boat before applying.
                  </span>
                </span>
              </label>

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
                    changedRows={changedRows}
                    unchangedRows={unchangedRows}
                    notFoundRows={notFoundRows}
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

                  <AddToFleetSection
                    candidates={additionCandidates}
                    selected={addSelected}
                    onToggle={(key, on) =>
                      setAddSelected((prev) => {
                        const next = new Set(prev);
                        if (on) next.add(key);
                        else next.delete(key);
                        return next;
                      })
                    }
                    onChooseFleet={(key, fleetId) =>
                      setAddTargetFleetByKey((prev) => ({ ...prev, [key]: fleetId }))
                    }
                    onChooseCert={(competitorId, certId) =>
                      setCertChoiceByCompetitor((prev) => ({ ...prev, [competitorId]: certId }))
                    }
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

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={handleApply}
                disabled={
                  !irishRatings.data ||
                  checkedChangedCount + checkedAdditions.length === 0 ||
                  updateMut.isPending
                }
              >
                {updateMut.isPending
                  ? 'Applying…'
                  : `Apply ${checkedChangedCount + checkedAdditions.length}`}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'source-rya-py' && (
          <>
            <DialogHeader>
              <DialogTitle>Update handicaps from the RYA PY list</DialogTitle>
              <DialogDescription>
                We match each boat&apos;s class against the RYA Portsmouth Yardstick list and
                propose its PY number. Tick whether to also normalise the class name.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2 min-h-0 min-w-0 overflow-y-auto">
              <RyaPyPreview
                proposals={ryaPyProposals}
                targetCompetitorById={targetCompetitorById}
                renameOff={renameOff}
                numberOff={numberOff}
                onToggleRename={(key, on) =>
                  setRenameOff((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                onToggleNumber={(key, on) =>
                  setNumberOff((prev) => {
                    const next = new Set(prev);
                    if (on) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
                onChoose={(key, value) =>
                  setChosenByClass((prev) => ({ ...prev, [key]: value }))
                }
              />

              <p className="text-xs text-muted-foreground">
                RYA Portsmouth Number List {RYA_PY_VERSION.year} (base v{RYA_PY_VERSION.base},
                limited-data v{RYA_PY_VERSION.limitedData}).
              </p>

              {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                onClick={handleApply}
                disabled={ryaPyUpdateRows.length === 0 || updateMut.isPending}
              >
                {updateMut.isPending ? 'Applying…' : `Apply ${ryaPyUpdateRows.length}`}
              </Button>
            </DialogFooter>
          </>
        )}

        {step === 'done' && result && (
          <>
            <DialogHeader>
              <DialogTitle>Handicaps updated</DialogTitle>
            </DialogHeader>
            <div className="space-y-2 py-2 text-sm min-h-0 overflow-y-auto">
              <p>
                Updated <strong>{result.updatedCount}</strong> starting handicap
                {result.updatedCount === 1 ? '' : 's'}.
              </p>
              <ul className="ml-5 list-disc text-muted-foreground">
                {(Object.entries(result.bySystem) as [HandicapSystem, number][]).map(
                  ([system, count]) => (
                    <li key={system}>
                      {count} {SYSTEM_LABEL[system]}
                    </li>
                  ),
                )}
                {result.added > 0 && (
                  <li>{result.added} added to a handicap fleet</li>
                )}
                {result.renamed != null && result.renamed > 0 && (
                  <li>{result.renamed} class name{result.renamed === 1 ? '' : 's'} normalised</li>
                )}
                <li>{result.unchanged} unchanged</li>
                {result.notFound > 0 && (
                  <li>{result.notFound} not found — left at their current value</li>
                )}
              </ul>
            </div>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
});

// ── Sub-components ──────────────────────────────────────────────────────────

function FleetMappingTable({
  targetFleets,
  sourceFleets,
  fleetMapping,
  onChange,
}: {
  targetFleets: Fleet[];
  sourceFleets: Fleet[];
  fleetMapping: Record<string, string | null>;
  onChange: (next: Record<string, string | null>) => void;
}) {
  const handicapTargets = targetFleets.filter((f) => f.scoringSystem !== 'scratch');
  if (handicapTargets.length === 0) return null;

  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">Fleet mapping</div>
      <div className="rounded-md border">
        {handicapTargets.map((tf, i) => {
          const candidates = sourceFleets.filter((sf) => sf.scoringSystem === tf.scoringSystem);
          const value = fleetMapping[tf.id] ?? '__skip__';
          return (
            <div
              key={tf.id}
              className={`flex items-center gap-3 p-2 ${i > 0 ? 'border-t' : ''}`}
            >
              <div className="flex-1 text-sm">
                <span className="font-medium">{tf.name}</span>{' '}
                <span className="text-muted-foreground">
                  ({tf.scoringSystem.toUpperCase()})
                </span>
              </div>
              <div className="text-muted-foreground text-sm">←</div>
              <Select
                value={value}
                onValueChange={(v) =>
                  onChange({ ...fleetMapping, [tf.id]: v === '__skip__' ? null : v })
                }
              >
                <SelectTrigger className="w-64">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__skip__">— skip —</SelectItem>
                  {candidates.length === 0 && (
                    <SelectItem value="__none__" disabled>
                      No matching {tf.scoringSystem.toUpperCase()} fleet
                    </SelectItem>
                  )}
                  {candidates.map((sf) => (
                    <SelectItem key={sf.id} value={sf.id}>
                      {sf.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewSection({
  changedRows,
  unchangedRows,
  notFoundRows,
  excludedRowIds,
  onToggleRow,
  targetCompetitorById,
  targetFleetById,
  sourceFleetById,
  onChooseCert,
}: {
  changedRows: PreviewRow[];
  unchangedRows: PreviewRow[];
  notFoundRows: PreviewRow[];
  excludedRowIds: Set<string>;
  onToggleRow: (key: string, included: boolean) => void;
  targetCompetitorById: Map<string, Competitor>;
  targetFleetById: Map<string, Fleet>;
  sourceFleetById: Map<string, Fleet>;
  /** Switch which certificate a boat uses (Irish Sailing primary/secondary). */
  onChooseCert?: (competitorId: string, certId: string) => void;
}) {
  // Suppress the unused-prop warning — kept for future "source fleet" column.
  void sourceFleetById;

  const summary = `Preview: ${changedRows.length} change${changedRows.length === 1 ? '' : 's'}, ${unchangedRows.length} unchanged, ${notFoundRows.length} not found`;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{summary}</div>

      {changedRows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8"></TableHead>
              <TableHead>Sail no.</TableHead>
              <TableHead>Boat</TableHead>
              <TableHead>Fleet</TableHead>
              <TableHead>System</TableHead>
              <TableHead className="text-right">Current → New</TableHead>
              <TableHead className="text-right">Δ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changedRows.map((r) => {
              const comp = targetCompetitorById.get(r.competitorId);
              const fleet = targetFleetById.get(r.targetFleetId);
              const key = rowKey(r);
              const included = !excludedRowIds.has(key);
              return (
                <TableRow key={key}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={(e) => onToggleRow(key, e.target.checked)}
                      className="h-3.5 w-3.5"
                    />
                  </TableCell>
                  <TableCell>{comp?.sailNumber}</TableCell>
                  <TableCell>
                    {comp?.boatName ?? comp?.name}
                    {r.match && (
                      <span className="block text-xs text-amber-600 dark:text-amber-500">
                        {describeMatch(r.match)}
                      </span>
                    )}
                    {r.certChoice && onChooseCert && (
                      <select
                        aria-label="Certificate"
                        value={r.certChoice.chosen}
                        onChange={(e) => onChooseCert(r.competitorId, e.target.value)}
                        className="mt-1 block rounded border bg-background px-1 py-0.5 text-xs"
                      >
                        {r.certChoice.options.map((o) => (
                          <option key={o.certId} value={o.certId}>
                            {o.label}
                            {o.tcc !== null ? ` — ${o.tcc.toFixed(3)}` : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </TableCell>
                  <TableCell>{fleet?.name}</TableCell>
                  <TableCell>{systemLabel(r)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatTcf(r.currentTcf, r.system)} → {formatTcf(r.newTcf, r.system)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {r.newTcf !== null ? formatDelta(r.currentTcf, r.newTcf, r.system) : '—'}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      {(unchangedRows.length > 0 || notFoundRows.length > 0) && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            {unchangedRows.length} unchanged
            {notFoundRows.length > 0 && `, ${notFoundRows.length} not found`}
          </summary>
          <div className="mt-2 space-y-2">
            {notFoundRows.length > 0 && (
              <div>
                <div className="text-muted-foreground">
                  Not found in source — will keep current handicap:
                </div>
                <ul className="ml-5 list-disc">
                  {notFoundRows.map((r) => {
                    const comp = targetCompetitorById.get(r.competitorId);
                    const fleet = targetFleetById.get(r.targetFleetId);
                    return (
                      <li key={rowKey(r)} className="text-muted-foreground">
                        {comp?.sailNumber} {comp?.boatName ?? comp?.name} ({fleet?.name},{' '}
                        {SYSTEM_LABEL[r.system]}) — {r.notFoundReason?.replaceAll('-', ' ')}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function AddToFleetSection({
  candidates,
  selected,
  onToggle,
  onChooseFleet,
  onChooseCert,
  targetCompetitorById,
  seriesHasRaces,
}: {
  candidates: FleetAdditionCandidate[];
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  onChooseFleet: (key: string, fleetId: string) => void;
  onChooseCert: (competitorId: string, certId: string) => void;
  targetCompetitorById: Map<string, Competitor>;
  seriesHasRaces: boolean;
}) {
  if (candidates.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">Add to handicap fleet</div>
      <p className="text-xs text-muted-foreground">
        These boats have an Irish Sailing certificate but aren&apos;t in a fleet that uses it — tick
        to add them and seed the rating.
      </p>
      {seriesHasRaces && (
        <p className="text-xs text-amber-600 dark:text-amber-500">
          Boats added here are scored DNC for races already sailed in that fleet.
        </p>
      )}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>Sail no.</TableHead>
            <TableHead>Boat</TableHead>
            <TableHead>Add to</TableHead>
            <TableHead className="text-right">Rating</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {candidates.map((c) => {
            const key = additionKey(c.competitorId, c.system);
            const comp = targetCompetitorById.get(c.competitorId);
            const checked = selected.has(key);
            const canApply = c.targetFleetId !== null && c.proposedTcf !== null;
            return (
              <TableRow key={key}>
                <TableCell>
                  <input
                    type="checkbox"
                    checked={checked && canApply}
                    disabled={!canApply}
                    onChange={(e) => onToggle(key, e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                </TableCell>
                <TableCell>{comp?.sailNumber}</TableCell>
                <TableCell>
                  {comp?.boatName ?? comp?.name}{' '}
                  <span className="text-muted-foreground">({SYSTEM_LABEL[c.system]})</span>
                  {c.match && (
                    <span className="block text-xs text-amber-600 dark:text-amber-500">
                      {describeMatch(c.match)}
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <select
                    aria-label="Target fleet"
                    value={c.targetFleetId ?? ''}
                    onChange={(e) => onChooseFleet(key, e.target.value)}
                    className="rounded border bg-background px-1 py-0.5 text-xs"
                  >
                    {c.targetFleetId === null && <option value="">Select fleet…</option>}
                    {c.fleetOptions.map((f) => (
                      <option key={f.fleetId} value={f.fleetId}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.certChoice && (
                    <select
                      aria-label="Certificate"
                      value={c.certChoice.chosen}
                      onChange={(e) => onChooseCert(c.competitorId, e.target.value)}
                      className="mb-1 block rounded border bg-background px-1 py-0.5 text-xs"
                    >
                      {c.certChoice.options.map((o) => (
                        <option key={o.certId} value={o.certId}>
                          {o.label}
                          {o.tcc !== null ? ` — ${o.tcc.toFixed(3)}` : ''}
                        </option>
                      ))}
                    </select>
                  )}
                  {c.proposedTcf !== null ? formatTcf(c.proposedTcf, c.system) : '—'}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** The current PY number shared across a proposal's boats, or a marker when
 *  they disagree / are unset. */
function currentNumberDisplay(p: PyClassProposal): string {
  const distinct = new Set(p.affected.map((a) => a.currentNumber));
  if (distinct.size === 1) {
    const [only] = distinct;
    return only === null ? '—' : String(only);
  }
  return 'varies';
}

function RyaPyPreview({
  proposals,
  targetCompetitorById,
  renameOff,
  numberOff,
  onToggleRename,
  onToggleNumber,
  onChoose,
}: {
  proposals: PyClassProposal[];
  targetCompetitorById: Map<string, Competitor>;
  renameOff: Set<string>;
  numberOff: Set<string>;
  /** `on` = apply this half (remove the class from the off-set). */
  onToggleRename: (key: string, on: boolean) => void;
  onToggleNumber: (key: string, on: boolean) => void;
  /** Resolve an ambiguous/unmatched class: value is a class key, or `'__skip__'`. */
  onChoose: (key: string, value: string) => void;
}) {
  if (proposals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No PY fleets with classed boats in this series.
      </p>
    );
  }

  const resolvedCount = proposals.filter((p) => p.resolved).length;
  const unresolved = proposals.length - resolvedCount;
  const summary = `${proposals.length} class${proposals.length === 1 ? '' : 'es'} in PY fleets${
    unresolved > 0 ? `, ${unresolved} needing a match` : ''
  }`;

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{summary}</div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Class (entered)</TableHead>
            <TableHead>RYA class</TableHead>
            <TableHead className="text-right">PY number</TableHead>
            <TableHead>Apply</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {proposals.map((p) => {
            const r = p.resolved;
            const { canRename, canSetNumber } = ryaPyChanges(p, targetCompetitorById);
            const renameApplied = canRename && !renameOff.has(p.enteredKey);
            const numberApplied = canSetNumber && !numberOff.has(p.enteredKey);
            const showPicker = p.matchStatus !== 'matched';
            const options = p.matchStatus === 'ambiguous' ? p.candidates : ryaPyMatcher.all();

            return (
              <TableRow key={p.enteredKey}>
                <TableCell>
                  {p.enteredClass}
                  <span className="block text-xs text-muted-foreground">
                    {p.affected.length} boat{p.affected.length === 1 ? '' : 's'}
                  </span>
                </TableCell>
                <TableCell>
                  {showPicker ? (
                    <select
                      aria-label={`RYA class for ${p.enteredClass}`}
                      value={r ? classKey(r) : ''}
                      onChange={(e) => onChoose(p.enteredKey, e.target.value)}
                      className="block max-w-[16rem] rounded border bg-background px-1 py-0.5 text-xs"
                    >
                      <option value="">
                        {p.matchStatus === 'ambiguous' ? 'Pick a class…' : 'No match — pick…'}
                      </option>
                      {options.map((c) => (
                        <option key={classKey(c)} value={classKey(c)}>
                          {c.name} ({c.number})
                          {TIER_LABEL[c.tier] ? ` · ${TIER_LABEL[c.tier]}` : ''}
                        </option>
                      ))}
                      <option value="__skip__">— skip —</option>
                    </select>
                  ) : (
                    <span>{r?.name}</span>
                  )}
                  {r && (
                    <span className="block text-xs text-muted-foreground">
                      {p.via === 'alias' && 'matched by alias'}
                      {TIER_LABEL[r.tier] && (
                        <span className="text-amber-600 dark:text-amber-500">
                          {p.via === 'alias' ? ' · ' : ''}
                          {TIER_LABEL[r.tier]} — guide only
                        </span>
                      )}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {r ? `${currentNumberDisplay(p)} → ${r.number}` : '—'}
                </TableCell>
                <TableCell>
                  {r && (canRename || canSetNumber) ? (
                    <div className="flex flex-col gap-0.5 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={renameApplied}
                          disabled={!canRename}
                          onChange={(e) => onToggleRename(p.enteredKey, e.target.checked)}
                        />
                        Name
                      </label>
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          className="h-3.5 w-3.5"
                          checked={numberApplied}
                          disabled={!canSetNumber}
                          onChange={(e) => onToggleNumber(p.enteredKey, e.target.checked)}
                        />
                        Number
                      </label>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {r ? 'no change' : '—'}
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
