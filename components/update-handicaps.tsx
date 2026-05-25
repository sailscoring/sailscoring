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
import { ConflictApiError } from '@/lib/api-client';
import {
  competitorRepo,
  fleetRepo,
  listTcfHistoryBySeries,
  raceRepo,
  type HandicapUpdateRow,
} from '@/lib/api-repository';
import {
  endOfSeriesTcfs,
  planHandicapUpdates,
  proposeFleetMapping,
  type HandicapSystem,
  type PreviewRow,
} from '@/lib/source-handicaps';
import type { Competitor, Fleet } from '@/lib/types';

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

function formatDelta(currentTcf: number | null, newTcf: number, system: HandicapSystem): string {
  if (currentTcf === null) return `+${formatTcf(newTcf, system)}`;
  const d = newTcf - currentTcf;
  const sign = d > 0 ? '+' : d < 0 ? '−' : '';
  if (d === 0) return '0';
  return `${sign}${formatTcf(Math.abs(d), system)}`;
}

export const UpdateHandicaps = forwardRef<UpdateHandicapsHandle, {
  seriesId: string;
}>(function UpdateHandicaps({ seriesId }, ref) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<'source-picker' | 'source-series' | 'done'>('source-picker');
  const [sourceSeriesId, setSourceSeriesId] = useState<string | null>(null);
  const [fleetMapping, setFleetMapping] = useState<Record<string, string | null>>({});
  const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{
    updatedCount: number;
    bySystem: Partial<Record<HandicapSystem, number>>;
    unchanged: number;
    notFound: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({
    open: () => {
      setStep('source-picker');
      setSourceSeriesId(null);
      setFleetMapping({});
      setExcludedRowIds(new Set());
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

  const previewRows = useMemo<PreviewRow[]>(() => {
    if (!targetCompetitors.data || !targetFleets.data || !sourceCompetitors.data) return [];
    return planHandicapUpdates({
      targetCompetitors: targetCompetitors.data,
      targetFleets: targetFleets.data,
      sourceCompetitors: sourceCompetitors.data,
      endOfSourceTcfs: endTcfs,
      fleetMapping,
    });
  }, [targetCompetitors.data, targetFleets.data, sourceCompetitors.data, endTcfs, fleetMapping]);

  // ── Apply ──────────────────────────────────────────────────────────────────
  async function handleApply() {
    setErrorMsg(null);
    const changeRows = previewRows.filter((r) => r.status === 'change' && !excludedRowIds.has(rowKey(r)));
    if (changeRows.length === 0) return;

    const compById = new Map((targetCompetitors.data ?? []).map((c) => [c.id, c]));
    const updatesByComp = new Map<string, HandicapUpdateRow>();
    for (const row of changeRows) {
      const comp = compById.get(row.competitorId);
      if (!comp || comp.version === undefined) continue;
      let update = updatesByComp.get(comp.id);
      if (!update) {
        update = { competitorId: comp.id, expectedVersion: comp.version };
        updatesByComp.set(comp.id, update);
      }
      const field = SYSTEM_FIELD[row.system];
      // Mutate via an unknown-cast index access — TS can't see that the
      // field name is statically one of the four optional number fields
      // on `HandicapUpdateRow`. Safe by construction (SYSTEM_FIELD maps
      // each HandicapSystem to the matching field) and the wire schema
      // validates on the server.
      (update as unknown as Record<string, number>)[field] = row.newTcf!;
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
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)_auto] max-h-[90vh] max-w-3xl">
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
                <input type="radio" name="source" defaultChecked className="mt-1" />
                <div>
                  <div className="font-medium">Another series in this workspace</div>
                  <div className="text-sm text-muted-foreground">
                    Use the boat&apos;s handicap at the end of a prior series as its starting
                    handicap here. Covers NHC, ECHO, IRC, and PY.
                  </div>
                </div>
              </label>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={() => setStep('source-series')}>Next</Button>
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
}: {
  changedRows: PreviewRow[];
  unchangedRows: PreviewRow[];
  notFoundRows: PreviewRow[];
  excludedRowIds: Set<string>;
  onToggleRow: (key: string, included: boolean) => void;
  targetCompetitorById: Map<string, Competitor>;
  targetFleetById: Map<string, Fleet>;
  sourceFleetById: Map<string, Fleet>;
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
                  <TableCell>{comp?.boatName ?? comp?.name}</TableCell>
                  <TableCell>{fleet?.name}</TableCell>
                  <TableCell>{SYSTEM_LABEL[r.system]}</TableCell>
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
