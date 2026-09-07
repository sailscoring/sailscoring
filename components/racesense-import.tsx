'use client';

import { forwardRef, Fragment, useImperativeHandle, useMemo, useRef, useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ImportFileErrorDialog } from '@/components/import-file-dialogs';
import { ApiError, UpstreamApiError, ValidationApiError } from '@/lib/api-client';
import { loadRaceSenseRegatta } from '@/lib/api-repository';
import { parseWorkbookFile } from '@/lib/import-table';
import type { Candidate } from '@/lib/finish-sheet-csv';
import {
  planRaceSenseImport,
  type PlannedRace,
  type RaceMatchState,
  type SeriesRace,
} from '@/lib/racesense-plan';
import {
  parseRaceSensePlayerRef,
  pickDivision,
  regattaToWorkbook,
  type RaceSenseRegatta,
} from '@/lib/racesense-regatta';
import {
  groupAnomalies,
  parseRaceSenseWorkbook,
  type RaceSenseWorkbook,
} from '@/lib/racesense-workbook';
import type { Finish, Fleet } from '@/lib/types';

const ACCEPT =
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const NOT_RACESENSE =
  "This workbook has no RaceSense race sheets in it. A regatta export has a sheet per race, named “Race 1”, “Race 2” and so on.";

const NOT_A_PLAYER_URL =
  'That isn’t a RaceSense player URL. It looks like https://player.vakaros.com/watch/<regatta id>/<division> — the address bar of the replay, or the Regatta ID printed on the committee’s export.';

/** Where the last player URL read into a series is kept, per series, so
 *  that reading again after the next race is one click. Browser-local: a
 *  convenience, not a record. */
const playerUrlKey = (seriesId: string) => `racesense-player-url:${seriesId}`;

function rememberedPlayerUrl(seriesId: string): string {
  try {
    return window.localStorage.getItem(playerUrlKey(seriesId)) ?? '';
  } catch {
    return '';
  }
}

function rememberPlayerUrl(seriesId: string, url: string): void {
  try {
    window.localStorage.setItem(playerUrlKey(seriesId), url);
  } catch {
    // Nothing to do: the scorer pastes it again next time.
  }
}

/** What to tell the scorer when the player read fails. The server writes
 *  the sentence for a refused or missing regatta; the rest is ours. */
function describeReadFailure(err: unknown): string {
  if (err instanceof UpstreamApiError) return err.message;
  if (err instanceof ValidationApiError) return NOT_A_PLAYER_URL;
  if (err instanceof ApiError && err.status === 403) {
    return 'Reading from the RaceSense player isn’t enabled for this workspace.';
  }
  return `Couldn’t read the regatta: ${err instanceof Error ? err.message : String(err)}.`;
}

/** Which fleet the workbook's division sailed in. `''` means the series has
 *  no fleets to choose between, or the scorer wants every race considered. */
const EVERY_RACE = '';

const STATE_LABEL: Record<RaceMatchState, string> = {
  new: 'New',
  unchanged: 'Unchanged',
  differs: 'Differs',
  unmatched: 'No race',
};

const STATE_VARIANT: Record<RaceMatchState, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  new: 'default',
  unchanged: 'secondary',
  differs: 'destructive',
  unmatched: 'outline',
};

/** Where the workbook came from. A player read keeps the regatta so the
 *  scorer can switch division without reading again, and the URL so they
 *  can read again without pasting it. */
type PlayerSource = { kind: 'player'; ref: string; regatta: RaceSenseRegatta; division: string };

type Source = { kind: 'file' } | PlayerSource;

type Flow =
  | { step: 'idle' }
  | { step: 'fileError'; message: string }
  | { step: 'player'; ref: string; error: string | null; reading: boolean }
  | { step: 'plan'; workbook: RaceSenseWorkbook; source: Source };

export interface RaceSenseImportHandle {
  /** Programmatically open the file picker. */
  trigger: () => void;
  /** Programmatically open the player-URL prompt. */
  triggerPlayer: () => void;
}

/**
 * Import a RaceSense regatta export into the races of a series.
 *
 * The dialog is the whole point of the feature. A RaceSense export holds the
 * entire regatta — the file taken on the last day still contains the first
 * day's races — and importing is destructive, so this shows what each sheet
 * would do to the race it lands in and lets the scorer choose race by race.
 * New races come ticked; races that differ from what's stored come unticked,
 * with the boats they'd change spelled out. Races already entered read back
 * "Unchanged", which is a free confirmation that the app and the committee's
 * device agree about them.
 *
 * The workbook can come from the committee's export or straight from the
 * regatta document behind its replay on the RaceSense player — the same
 * plan either way, which is what lets a race read from the player the
 * moment it finishes be confirmed `unchanged` by the export at the end of
 * the day.
 *
 * `planRaceSenseImport` does the thinking; this renders it.
 */
export const RaceSenseImport = forwardRef<RaceSenseImportHandle, {
  seriesId: string;
  races: SeriesRace[];
  fleets: Fleet[];
  competitors: Candidate[];
  finishes: Finish[] | undefined;
  onConfirm: (races: PlannedRace[]) => Promise<void> | void;
  trigger?: React.ReactNode;
}>(function RaceSenseImport(
  { seriesId, races, fleets, competitors, finishes, onConfirm, trigger },
  ref,
) {
  const [flow, setFlow] = useState<Flow>({ step: 'idle' });
  const [fleetId, setFleetId] = useState<string>(EVERY_RACE);
  const [offset, setOffset] = useState(0);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  /** `null` while the scorer hasn't overruled the recommendation. */
  const [ticked, setTicked] = useState<Set<string> | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    trigger: () => fileInputRef.current?.click(),
    triggerPlayer: () =>
      setFlow({ step: 'player', ref: rememberedPlayerUrl(seriesId), error: null, reading: false }),
  }));

  function reset() {
    setFlow({ step: 'idle' });
    setFleetId(EVERY_RACE);
    setOffset(0);
    setOverrides({});
    setTicked(null);
    setExpanded(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /** Any change to how sheets are matched invalidates the ticks: they were
   *  chosen against a different set of target races. */
  function rematch(apply: () => void) {
    apply();
    setTicked(null);
    setExpanded(null);
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const parsed = await parseWorkbookFile(file);
    if (parsed.kind === 'error') {
      setFlow({ step: 'fileError', message: parsed.message });
      return;
    }
    const workbook = parseRaceSenseWorkbook(parsed.sheets);
    if (workbook.races.length === 0) {
      setFlow({ step: 'fileError', message: NOT_RACESENSE });
      return;
    }
    setFlow({ step: 'plan', workbook, source: { kind: 'file' } });
  }

  /** Read the regatta behind a player URL and open the plan on it. */
  async function readPlayer(ref: string) {
    const parsedRef = parseRaceSensePlayerRef(ref);
    if (!parsedRef) {
      setFlow({ step: 'player', ref, error: NOT_A_PLAYER_URL, reading: false });
      return;
    }
    setFlow({ step: 'player', ref, error: null, reading: true });
    let regatta: RaceSenseRegatta;
    try {
      regatta = await loadRaceSenseRegatta(ref);
    } catch (err) {
      setFlow({ step: 'player', ref, error: describeReadFailure(err), reading: false });
      return;
    }
    const division = pickDivision(regatta, parsedRef.division) ?? regatta.divisions[0];
    if (!division) {
      setFlow({
        step: 'player', ref, reading: false,
        error: `${regatta.name ?? 'That regatta'} has no divisions on the player yet, so there is nothing to read.`,
      });
      return;
    }
    rememberPlayerUrl(seriesId, ref);
    openPlayerPlan({ kind: 'player', ref, regatta, division: division.name });
  }

  /** Open the plan on a player read, or re-open it on another division. A
   *  change of division re-derives the workbook, so the ticks go with it. */
  function openPlayerPlan(source: PlayerSource) {
    const division = pickDivision(source.regatta, source.division) ?? source.regatta.divisions[0];
    rematch(() => {
      setFlow({
        step: 'plan',
        workbook: regattaToWorkbook(source.regatta, division),
        source: { ...source, division: division.name },
      });
      setOverrides({});
    });
  }

  const plan = useMemo(() => {
    if (flow.step !== 'plan') return null;
    return planRaceSenseImport({
      workbook: flow.workbook,
      fleetId: fleetId === EVERY_RACE ? null : fleetId,
      races,
      competitors,
      finishes: finishes ?? [],
      offset,
      overrides,
    });
  }, [flow, fleetId, offset, overrides, races, competitors, finishes]);

  const selected = useMemo(() => {
    if (!plan) return [] as PlannedRace[];
    return plan.races.filter((r) =>
      r.result !== null && (ticked ? ticked.has(r.sheetName) : r.recommended),
    );
  }, [plan, ticked]);

  function toggle(race: PlannedRace) {
    const next = new Set(
      ticked ?? (plan?.races.filter((r) => r.recommended).map((r) => r.sheetName) ?? []),
    );
    if (next.has(race.sheetName)) next.delete(race.sheetName);
    else next.add(race.sheetName);
    setTicked(next);
  }

  const isTicked = (race: PlannedRace) =>
    ticked ? ticked.has(race.sheetName) : race.recommended;

  async function confirm() {
    setImporting(true);
    try {
      await onConfirm(selected);
      reset();
    } finally {
      setImporting(false);
    }
  }

  const candidateRaces = useMemo(() => {
    const ordered = [...races].sort((a, b) => a.raceNumber - b.raceNumber);
    if (fleetId === EVERY_RACE) return ordered;
    return ordered.filter((r) => r.starts.some((s) => s.fleetIds.includes(fleetId)));
  }, [races, fleetId]);

  const workbookGroups = plan ? groupAnomalies(plan.workbookNotes) : [];

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept={ACCEPT}
        onChange={handleFileSelected}
        className="hidden"
        data-testid="racesense-input"
      />
      {trigger}

      <ImportFileErrorDialog
        open={flow.step === 'fileError'}
        message={flow.step === 'fileError' ? flow.message : ''}
        onClose={reset}
      />

      <Dialog open={flow.step === 'player'} onOpenChange={(open) => { if (!open) reset(); }}>
        <DialogContent data-testid="racesense-player">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (flow.step === 'player' && !flow.reading) void readPlayer(flow.ref);
            }}
          >
            <DialogHeader>
              <DialogTitle>Read from the RaceSense player</DialogTitle>
              <DialogDescription>
                Paste the address of the regatta’s replay on player.vakaros.com. The app reads
                the race committee’s record behind it — the same starts, OCS calls and finishes
                their export carries — and shows what each finished race would do here before
                anything is written.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="racesense-player-url">Player URL</Label>
              <Input
                id="racesense-player-url"
                type="text"
                inputMode="url"
                autoFocus
                placeholder="https://player.vakaros.com/watch/…"
                value={flow.step === 'player' ? flow.ref : ''}
                onChange={(e) =>
                  setFlow({ step: 'player', ref: e.target.value, error: null, reading: false })
                }
                disabled={flow.step === 'player' && flow.reading}
              />
              {flow.step === 'player' && flow.error && (
                <p className="text-sm text-destructive" data-testid="racesense-player-error">
                  {flow.error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={reset}>Cancel</Button>
              <Button
                type="submit"
                disabled={flow.step !== 'player' || flow.reading || flow.ref.trim() === ''}
                data-testid="racesense-player-read"
              >
                {flow.step === 'player' && flow.reading ? 'Reading…' : 'Read'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={flow.step === 'plan'} onOpenChange={(open) => { if (!open) reset(); }}>
        <DialogContent
          className="w-[95vw] max-w-5xl sm:max-w-5xl"
          data-testid="racesense-plan"
        >
          <DialogHeader>
            <DialogTitle>Import from RaceSense</DialogTitle>
            <DialogDescription>
              {plan?.regatta ?? 'This export'}
              {plan?.division ? ` — ${plan.division}` : ''}, {plan?.races.length ?? 0} race
              {plan?.races.length === 1 ? '' : 's'}. Only the races you tick are written;
              everything else is left alone.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap items-end gap-4">
            {fleets.length > 0 && (
              <label className="text-sm space-y-1">
                <span className="font-medium block">This export is</span>
                <select
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  value={fleetId}
                  onChange={(e) => rematch(() => { setFleetId(e.target.value); setOverrides({}); })}
                  data-testid="racesense-fleet"
                >
                  <option value={EVERY_RACE}>every race in the series</option>
                  {fleets.map((f) => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </label>
            )}
            {flow.step === 'plan' && flow.source.kind === 'player' && flow.source.regatta.divisions.length > 1 && (
              <label className="text-sm space-y-1">
                <span className="font-medium block">Division</span>
                <select
                  className="rounded-md border bg-background px-2 py-1 text-sm"
                  value={flow.source.division}
                  onChange={(e) => openPlayerPlan({ ...(flow.source as PlayerSource), division: e.target.value })}
                  data-testid="racesense-division"
                >
                  {flow.source.regatta.divisions.map((d) => (
                    <option key={d.name} value={d.name}>{d.name}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="text-sm space-y-1">
              <span className="font-medium block">Shift by</span>
              <input
                type="number"
                className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
                value={offset}
                onChange={(e) => rematch(() => { setOffset(Number(e.target.value) || 0); setOverrides({}); })}
                data-testid="racesense-offset"
              />
            </label>
            <p className="text-xs text-muted-foreground max-w-md">
              RaceSense’s race 1 is the first race on this list. If a race was abandoned
              and resailed, the two numberings part company — shift them back into line,
              or point a single sheet at a race yourself.
            </p>
          </div>

          {workbookGroups.length > 0 && (
            <div className="rounded-md border p-3 space-y-1" data-testid="racesense-workbook-notes">
              {workbookGroups.map((g) => (
                <p key={g.kind} className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {g.severity === 'warning' ? 'Check' : 'Note'}
                  </span>{' '}
                  {g.message}
                  {g.count > 1 && ` (×${g.count})`}
                </p>
              ))}
            </div>
          )}

          <div className="overflow-y-auto max-h-[50vh] rounded-md border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/60">
                <tr className="text-left">
                  <th className="w-8 p-2" />
                  <th className="p-2 font-medium">Sheet</th>
                  <th className="p-2 font-medium">Race</th>
                  <th className="p-2 font-medium">State</th>
                  <th className="p-2 font-medium">What it says</th>
                </tr>
              </thead>
              <tbody>
                {plan?.races.map((race) => {
                  const warnings = race.notes.filter((n) => n.severity === 'warning');
                  const open = expanded === race.sheetName;
                  return (
                    <Fragment key={race.sheetName}>
                      <tr className="border-t align-top" data-testid={`racesense-row-${race.raceNumber}`}>
                        <td className="p-2">
                          <input
                            type="checkbox"
                            className="h-3.5 w-3.5"
                            disabled={race.result === null}
                            checked={race.result !== null && isTicked(race)}
                            onChange={() => toggle(race)}
                            aria-label={`Import ${race.sheetName}`}
                          />
                        </td>
                        <td className="p-2 whitespace-nowrap">{race.sheetName}</td>
                        <td className="p-2">
                          <select
                            className="max-w-[14rem] rounded-md border bg-background px-1.5 py-0.5 text-sm"
                            value={race.race?.id ?? ''}
                            onChange={(e) =>
                              rematch(() =>
                                setOverrides((o) => ({ ...o, [race.sheetName]: e.target.value })),
                              )
                            }
                            aria-label={`Race for ${race.sheetName}`}
                          >
                            <option value="">— no race —</option>
                            {candidateRaces.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name || `Race ${r.raceNumber}`}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="p-2">
                          <Badge variant={STATE_VARIANT[race.state]}>
                            {STATE_LABEL[race.state]}
                          </Badge>
                        </td>
                        <td className="p-2 space-y-1">
                          {race.result && (
                            <p>
                              {[
                                `${race.result.summary.finishers} finished`,
                                race.result.summary.coded > 0 && `${race.result.summary.coded} coded`,
                                race.result.summary.unresolved > 0 &&
                                  `${race.result.summary.unresolved} unresolved`,
                              ].filter(Boolean).join(', ')}
                              {race.trackData > 0 && ` \u00b7 track data for ${race.trackData}`}
                            </p>
                          )}
                          {warnings.map((note, i) => (
                            <p key={i} className="text-xs text-muted-foreground">{note.message}</p>
                          ))}
                          {race.state === 'differs' && (
                            <button
                              type="button"
                              className="text-xs underline"
                              onClick={() => setExpanded(open ? null : race.sheetName)}
                            >
                              {open ? 'Hide' : `Show ${race.changes.length} change${race.changes.length === 1 ? '' : 's'}`}
                            </button>
                          )}
                        </td>
                      </tr>
                      {open && (
                        <tr className="border-t bg-muted/30">
                          <td />
                          <td colSpan={4} className="p-2">
                            <table className="text-xs">
                              <thead>
                                <tr className="text-left text-muted-foreground">
                                  <th className="pr-4 font-medium">Boat</th>
                                  <th className="pr-4 font-medium">Stored now</th>
                                  <th className="font-medium">Would become</th>
                                </tr>
                              </thead>
                              <tbody>
                                {race.changes.map((c) => (
                                  <tr key={c.sailNumber}>
                                    <td className="pr-4 py-0.5">{c.sailNumber}</td>
                                    <td className="pr-4 py-0.5">{c.stored}</td>
                                    <td className="py-0.5">{c.incoming}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <DialogFooter>
            {flow.step === 'plan' && flow.source.kind === 'player' && (
              <Button
                variant="outline"
                className="sm:mr-auto"
                onClick={() => readPlayer((flow.source as PlayerSource).ref)}
                data-testid="racesense-read-again"
              >
                Read again
              </Button>
            )}
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button
              onClick={confirm}
              disabled={selected.length === 0 || importing}
              data-testid="racesense-confirm"
            >
              {importing
                ? 'Importing…'
                : `Import ${selected.length} race${selected.length === 1 ? '' : 's'}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});
