'use client';

import { useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';

import { FinishTab } from '@/components/finish-tab';
import type { FinishSheetImportHandle } from '@/components/finish-sheet-import';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useCompetitorsBySeries } from '@/hooks/use-competitors';
import { useFinishInput } from '@/hooks/use-finish-input';
import { useFinishRowOps } from '@/hooks/use-finish-row-ops';
import {
  useRaceSubmissions,
  useRacesBetween,
  useSubmitFinishSheet,
  useWithdrawFinishSubmission,
} from '@/hooks/use-finish-submissions';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useSeries } from '@/hooks/use-series';
import type { DatedRace } from '@/lib/api-handlers/races';
import { defaultEnabledCompetitorFields } from '@/lib/competitor-fields';
import {
  deriveFinishState,
  deriveNonFinishers,
  finishedCompetitorIds,
  finishRowsFromImport,
} from '@/lib/finish-entry';
import { raceCandidates } from '@/lib/finish-submission';
import { competitorsInRace, raceFleetIds, withRaceSailNumbers } from '@/lib/race-membership';
import { formatRelativeTime } from '@/lib/relative-time';
import { groupRaces, raceWindow, sheetFromSubmission, uploadOf } from '@/lib/record-finishes';
import { todayIsoDate } from '@/lib/race-schedule';
import { normalizeTimeInput } from '@/lib/time-parse';
import type { Finish } from '@/lib/types';

/**
 * The Record finishes page: for whoever records finishes on the committee
 * boat or in the finish hut, on a phone. Pick the race, take the finishing
 * order down on the same Finish tab a scorer enters it on (or import a
 * spreadsheet), and submit it for a scorer to review. Nothing here writes the finish sheet: a scorer applies a
 * submission or dismisses it, and until they apply it the recorder can
 * correct it and submit again.
 */
export function RecordFinishes({ userId }: { userId: string }) {
  const today = todayIsoDate();
  const { from, to } = raceWindow(today);
  const { data: races, isLoading } = useRacesBetween(from, to);
  const router = useRouter();
  const pathname = usePathname();
  const raceId = useSearchParams().get('race');
  const selected = races?.find((r) => r.race.id === raceId);

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading races…</p>;
  if (selected) {
    return <RaceRecording key={selected.race.id} dated={selected} userId={userId} onBack={() => router.push(pathname)} />;
  }

  const groups = groupRaces(races ?? [], today);
  const pick = (id: string) => router.push(`${pathname}?race=${id}`);
  return (
    <div className="space-y-5" data-testid="record-race-picker">
      {(races ?? []).length === 0 && (
        <p className="text-sm text-muted-foreground">
          No races are dated within a week of today. A scorer adds them, with their dates, in the series.
        </p>
      )}
      <RaceGroup title="Today" races={groups.today} onPick={pick} />
      <RaceGroup title="Coming up" races={groups.upcoming} onPick={pick} />
      <RaceGroup title="Earlier" races={groups.earlier} onPick={pick} />
    </div>
  );
}

function raceTitle(d: DatedRace): string {
  return d.race.name ? `Race ${d.race.raceNumber}, ${d.race.name}` : `Race ${d.race.raceNumber}`;
}

function RaceGroup({ title, races, onPick }: { title: string; races: DatedRace[]; onPick: (id: string) => void }) {
  if (races.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <ul className="space-y-2">
        {races.map((d) => (
          <li key={d.race.id}>
            <button
              type="button"
              onClick={() => onPick(d.race.id)}
              className="w-full text-left rounded-lg border bg-card px-4 py-3 hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="font-medium">{raceTitle(d)}</span>
              <span className="text-muted-foreground"> · {d.seriesName}</span>
              <span className="block text-sm text-muted-foreground">
                {d.race.date}
                {d.starts.some((s) => s.startTime) &&
                  ` · first start ${[...d.starts].map((s) => s.startTime).filter(Boolean).sort()[0]}`}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function nowHms(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

// The recording lives in this page's state until it's submitted, so a row
// edit the Finish tab makes has nothing further to save.
const KEPT_IN_THE_DRAFT = { mutate: () => undefined };

interface Draft {
  finishes: Finish[];
  startTimes: Record<string, string>;
  recordedBy: string;
  complete: boolean;
}

function RaceRecording({ dated, userId, onBack }: { dated: DatedRace; userId: string; onBack: () => void }) {
  const { race, starts } = dated;
  const { data: series } = useSeries(race.seriesId);
  const { data: storedCompetitors } = useCompetitorsBySeries(race.seriesId);
  const { data: fleets } = useFleetsBySeries(race.seriesId);
  const { data: submissions } = useRaceSubmissions(race.id, { enabled: true });
  const submit = useSubmitFinishSheet();
  const withdraw = useWithdrawFinishSubmission();
  const finishSheetImportRef = useRef<FinishSheetImportHandle>(null);

  // The recorder's own latest submission for this race, if any: the page
  // picks up where it left off, and a submit revises it.
  const mine = submissions?.find((s) => s.submittedBy?.id === userId);
  const [newId] = useState(() => crypto.randomUUID());
  const submissionId = mine?.id ?? newId;

  const fleetById = useMemo(() => new Map((fleets ?? []).map((f) => [f.id, f])), [fleets]);
  const sailNumberOf = useMemo(() => {
    const m = new Map((storedCompetitors ?? []).map((c) => [c.id, c.sailNumber]));
    return (id: string) => m.get(id);
  }, [storedCompetitors]);
  const candidates = useMemo(
    () => raceCandidates(storedCompetitors ?? [], starts, (id) => fleetById.get(id)?.name),
    [storedCompetitors, starts, fleetById],
  );

  // Edits live in a draft; until the first edit, the page shows the latest
  // submission as sent.
  const sent = useMemo<Draft>(() => ({
    finishes: mine ? sheetFromSubmission(race.id, mine, candidates, sailNumberOf) : [],
    startTimes: Object.fromEntries((mine?.starts ?? []).map((s) => [s.startId, s.startTime])),
    recordedBy: mine?.recordedBy ?? '',
    complete: mine?.complete ?? false,
  }), [mine, race.id, candidates, sailNumberOf]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const shown = draft ?? sent;
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const edit = (change: (d: Draft) => Draft) => {
    setDraft((d) => change(d ?? sent));
    setMessage(null);
  };
  const patchCache = (updater: (rows: Finish[]) => Finish[]) =>
    edit((d) => ({ ...d, finishes: updater(d.finishes) }));

  // The starts as the recorder has them: a start time taken on the water
  // stands in for the one the scorer set, so a handicap fleet asks for
  // finish times as soon as its gun is known.
  const raceStarts = useMemo(
    () => starts.map((s) => {
      const taken = normalizeTimeInput(shown.startTimes[s.id] ?? '');
      return taken ? { ...s, startTime: taken } : s;
    }),
    [starts, shown.startTimes],
  );
  // The boats as this race sees them, each under the number she sails here.
  // An excluded boat is no entrant, and including one is the scorer's call:
  // her sail number goes in as an unknown boat for the scorer to resolve.
  const competitors = useMemo(
    () => withRaceSailNumbers(storedCompetitors ?? [], raceStarts).filter((c) => !c.excluded),
    [storedCompetitors, raceStarts],
  );
  const competitorMap = useMemo(() => new Map(competitors.map((c) => [c.id, c])), [competitors]);
  const inRaceCompetitors = useMemo(() => competitorsInRace(competitors, raceStarts), [competitors, raceStarts]);
  const raceFleets = useMemo(() => raceFleetIds(raceStarts), [raceStarts]);

  const derived = useMemo(() => deriveFinishState(shown.finishes), [shown.finishes]);
  const finishedIds = finishedCompetitorIds(derived.finishingOrder);
  const nonFinishers = deriveNonFinishers(inRaceCompetitors, finishedIds, derived.nonFinisherCodes, shown.finishes);
  const rowOps = useFinishRowOps({
    raceId: race.id,
    derived,
    saveFinish: KEPT_IN_THE_DRAFT,
    deleteFinish: KEPT_IN_THE_DRAFT,
    patchCache,
  });
  const finishInput = useFinishInput({
    raceId: race.id,
    // A handicap fleet whose start has no time yet still has her place taken
    // down: the recorder can't add a start, and the scorer can time it later.
    isHandicapSeries: false,
    finishRecording: race.finishRecording,
    competitors,
    fleetById,
    raceStarts,
    derived,
    nonFinishers,
    finishedIds,
    saveFinish: KEPT_IN_THE_DRAFT,
    patchCache,
    commitOrderChange: rowOps.commitOrderChange,
    flashRow: rowOps.flashRow,
    ready: storedCompetitors !== undefined && series !== undefined,
    stampTime: nowHms,
  });

  const upload = uploadOf({
    finishes: shown.finishes,
    startTimes: shown.startTimes,
    recordedBy: shown.recordedBy,
    complete: shown.complete,
    revision: (mine?.revision ?? 0) + 1,
  });

  async function send() {
    setError(null);
    setMessage(null);
    try {
      const receipt = await submit.mutateAsync({ raceId: race.id, submissionId, input: upload.input });
      setDraft(null);
      const { matched, unknownSailNumbers, skipped } = receipt.match;
      setMessage(
        `Submitted for review: ${matched} boat${matched === 1 ? '' : 's'} matched` +
          (unknownSailNumbers.length ? `, ${unknownSailNumbers.length} sail number${unknownSailNumbers.length === 1 ? '' : 's'} for the scorer to resolve` : '') +
          (skipped.length ? `, ${skipped.length} row${skipped.length === 1 ? '' : 's'} the review will leave out` : '') +
          '.',
      );
    } catch (err) {
      setError(err instanceof Error ? `That didn’t go through (${err.message}). Your list is still here; try again.` : 'That didn’t go through; try again.');
    }
  }

  async function takeBack() {
    if (!mine) return;
    setError(null);
    await withdraw.mutateAsync({ raceId: race.id, submissionId: mine.id });
    setDraft(null);
    setMessage('Withdrawn. Nothing was sent to the finish sheet.');
  }

  const fleetsOf = (fleetIds: string[]) =>
    fleetIds.map((id) => fleetById.get(id)?.name).filter((n): n is string => Boolean(n)).join(', ') || 'Every fleet';
  const enabledCompetitorFields = series?.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const showFleetBadge = (fleets ?? []).length > 1 || (fleets ?? []).some((f) => f.name !== 'Default');

  return (
    <div className="space-y-5" data-testid="record-race">
      <div className="space-y-1">
        <button type="button" onClick={onBack} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Races
        </button>
        <h2 className="text-xl font-semibold">{raceTitle(dated)}</h2>
        <p className="text-sm text-muted-foreground">{dated.seriesName} · {race.date}</p>
      </div>

      {mine && (
        <SubmissionStatus status={mine.status} revision={mine.revision} submittedAt={mine.submittedAt} reviewer={mine.reviewedBy?.name ?? null} />
      )}

      {starts.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium">Starts</h3>
          {starts.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <Label htmlFor={`start-${s.id}`} className="flex-1 text-sm font-normal">
                {fleetsOf(s.fleetIds)}
                <span className="text-muted-foreground">{s.startTime ? `, due ${s.startTime}` : ''}</span>
              </Label>
              <Input
                id={`start-${s.id}`}
                aria-label={`Start time taken for ${fleetsOf(s.fleetIds)}`}
                placeholder="Started at"
                inputMode="numeric"
                className="w-32 font-mono"
                value={shown.startTimes[s.id] ?? ''}
                onChange={(e) => edit((d) => ({ ...d, startTimes: { ...d.startTimes, [s.id]: e.target.value } }))}
              />
            </div>
          ))}
        </section>
      )}

      {storedCompetitors === undefined || series === undefined ? (
        <p className="text-sm text-muted-foreground">Loading the entry list…</p>
      ) : (
        <div className="rounded-lg border bg-card p-3 sm:p-5">
          <FinishTab
            recording
            finishInput={finishInput}
            rowOps={rowOps}
            nonFinishers={nonFinishers}
            competitors={competitors}
            competitorMap={competitorMap}
            fleetById={fleetById}
            raceFleetIds={raceFleets}
            showFleetBadge={showFleetBadge}
            showCrew={enabledCompetitorFields.includes('crewName')}
            enabledCompetitorFields={enabledCompetitorFields}
            finishRecording={race.finishRecording}
            derived={derived}
            savedFinishes={shown.finishes}
            finishSheetImportRef={finishSheetImportRef}
            applyCsvImport={(result) => {
              patchCache(() => finishRowsFromImport(race.id, result.finishes));
              finishInput.reset();
            }}
            patchCache={patchCache}
            saveFinish={KEPT_IN_THE_DRAFT}
            leave={onBack}
          />
        </div>
      )}

      {shown.finishes.length > 0 && (
        <section className="space-y-3 rounded-lg border p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="recorded-by">Recorded by</Label>
              <Input
                id="recorded-by"
                placeholder="e.g. Committee boat"
                value={shown.recordedBy}
                onChange={(e) => edit((d) => ({ ...d, recordedBy: e.target.value }))}
              />
            </div>
            <label className="flex items-center gap-2 text-sm sm:self-end sm:pb-2">
              <Switch checked={shown.complete} onCheckedChange={(complete) => edit((d) => ({ ...d, complete }))} />
              That’s every boat
            </label>
          </div>
          {upload.problems.length > 0 && (
            <ul className="text-sm text-destructive space-y-0.5">
              {upload.problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void send()} disabled={submit.isPending || upload.problems.length > 0}>
              {submit.isPending ? 'Submitting…' : mine ? 'Submit again' : 'Submit for review'}
            </Button>
            {mine && mine.status !== 'applied' && (
              <Button variant="outline" onClick={() => void takeBack()} disabled={withdraw.isPending}>Withdraw</Button>
            )}
          </div>
        </section>
      )}

      {message && <p className="text-sm" role="status" data-testid="record-message">{message}</p>}
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}

function SubmissionStatus({
  status,
  revision,
  submittedAt,
  reviewer,
}: {
  status: 'pending' | 'applied' | 'dismissed';
  revision: number;
  submittedAt: number;
  reviewer: string | null;
}) {
  const label = {
    pending: 'Waiting for the scorer',
    applied: `Applied to the finish sheet${reviewer ? ` by ${reviewer}` : ''}`,
    dismissed: `Dismissed${reviewer ? ` by ${reviewer}` : ''}`,
  }[status];
  return (
    <p className="text-sm" data-testid="submission-status">
      <Badge variant={status === 'pending' ? 'secondary' : 'outline'}>{label}</Badge>
      <span className="text-muted-foreground"> Submitted {formatRelativeTime(submittedAt)}{revision > 1 ? `, revision ${revision}` : ''}. Submitting again replaces it.</span>
    </p>
  );
}

