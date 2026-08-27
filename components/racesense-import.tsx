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
import { ImportFileErrorDialog } from '@/components/import-file-dialogs';
import { parseWorkbookFile } from '@/lib/import-table';
import type { Candidate } from '@/lib/finish-sheet-csv';
import {
  planRaceSenseImport,
  type PlannedRace,
  type RaceMatchState,
  type SeriesRace,
} from '@/lib/racesense-plan';
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

type Flow =
  | { step: 'idle' }
  | { step: 'fileError'; message: string }
  | { step: 'plan'; workbook: RaceSenseWorkbook };

export interface RaceSenseImportHandle {
  /** Programmatically open the file picker. */
  trigger: () => void;
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
 * `planRaceSenseImport` does the thinking; this renders it.
 */
export const RaceSenseImport = forwardRef<RaceSenseImportHandle, {
  races: SeriesRace[];
  fleets: Fleet[];
  competitors: Candidate[];
  finishes: Finish[] | undefined;
  onConfirm: (races: PlannedRace[]) => Promise<void> | void;
  trigger?: React.ReactNode;
}>(function RaceSenseImport(
  { races, fleets, competitors, finishes, onConfirm, trigger },
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
    setFlow({ step: 'plan', workbook });
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
