'use client';

import { use, useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { raceRepo } from '@/lib/api-repository';
import { useSeries } from '@/hooks/use-series';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { useFeatures } from '@/components/features-provider';
import {
  useDeleteRace,
  useRacesBySeries,
  useReorderRaces,
  useSaveRace,
} from '@/hooks/use-races';
import { useFleetsBySeries } from '@/hooks/use-fleets';
import { useFinishesByRace } from '@/hooks/use-finishes';
import { useSaveRaceStarts } from '@/hooks/use-race-starts';
import {
  useCreateSubSeries,
  useDeleteSubSeries,
  useSaveSubSeries,
  useSubSeriesBySeries,
} from '@/hooks/use-sub-series';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ChevronsUpDown, Pencil, Trash2 } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SortableList, DragHandle } from '@/components/ui/sortable-list';
import type { CSSProperties, HTMLAttributes } from 'react';
import type { Race, SubSeries } from '@/lib/types';
import { log } from '@/lib/debug';
import { useShortcutHelp, useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { generateStarts } from '@/lib/start-sequence';
import { groupRacesBySubSeries } from '@/lib/scoring';

function RaceRow({
  race,
  seriesId,
  rowRef,
  rowStyle,
  dragHandle,
  onNudge,
  onInsert,
}: {
  race: Race;
  seriesId: string;
  rowRef?: (node: HTMLElement | null) => void;
  rowStyle?: CSSProperties;
  dragHandle?: HTMLAttributes<HTMLElement> | null;
  onNudge?: (direction: -1 | 1) => void;
  onInsert?: (position: 'above' | 'below') => void;
}) {
  const router = useRouter();
  const { can } = useWorkspacePermissions();
  const readOnly = useSeriesReadOnly() || !can('score');
  const { data: finishes } = useFinishesByRace(race.id);
  const deleteRace = useDeleteRace();
  const finisherCount = finishes?.filter((f) => f.sortOrder !== null).length;

  async function handleDelete() {
    if (!confirm(`Delete Race ${race.raceNumber}? This will also delete all results for this race.`)) return;
    // Finishes / race-starts cascade with the race row in Postgres.
    await deleteRace.mutateAsync({ id: race.id, seriesId });
  }

  return (
    <div
      ref={rowRef}
      style={rowStyle}
      data-testid="race-row"
      className="flex items-center justify-between bg-card border rounded-lg px-5 py-4 cursor-pointer hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      onClick={() => router.push(`/series/${seriesId}/races/${race.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          router.push(`/series/${seriesId}/races/${race.id}`);
        } else if ((e.key === 'd' || e.key === 'Delete') && !readOnly) {
          e.preventDefault();
          handleDelete();
        } else if (e.altKey && e.key === 'ArrowDown' && onNudge) {
          // Alt+↓/↑ nudges the race one place later/earlier (Sailwave's
          // "move race right/left"); plain arrows just move focus.
          e.preventDefault();
          onNudge(1);
        } else if (e.altKey && e.key === 'ArrowUp' && onNudge) {
          e.preventDefault();
          onNudge(-1);
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
        }
      }}
    >
      <div className="flex items-center gap-2">
        {dragHandle && <DragHandle {...dragHandle} aria-label={`Reorder Race ${race.raceNumber}`} />}
        <div>
          <span className="font-medium">Race {race.raceNumber}</span>
          {race.name && <span className="ml-2">{race.name}</span>}
          {race.date && (
            <span className="text-sm text-muted-foreground ml-2">{race.date}</span>
          )}
          {finisherCount !== undefined && (
            <span className="text-sm text-muted-foreground ml-2">
              {finisherCount} {finisherCount === 1 ? 'finisher' : 'finishers'}
            </span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!readOnly && onInsert && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Insert a race near Race ${race.raceNumber}`}
                onClick={(e) => e.stopPropagation()}
              >
                <ChevronsUpDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
              <DropdownMenuItem onClick={() => onInsert('above')}>
                Insert race above
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInsert('below')}>
                Insert race below
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!readOnly && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete Race ${race.raceNumber}`}
            onClick={(e) => { e.stopPropagation(); handleDelete(); }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}

/** Normalize a time input like "140500" or "14:05:00" to "HH:MM:SS". */
function normalizeTimeInput(input: string): string | null {
  const trimmed = input.trim();
  if (/^\d{2}:\d{2}:\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{6}$/.test(trimmed)) {
    const p = trimmed.padStart(6, '0');
    return `${p.slice(0, 2)}:${p.slice(2, 4)}:${p.slice(4, 6)}`;
  }
  return null;
}

export default function RacesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const { can } = useWorkspacePermissions();
  const { has } = useFeatures();
  // Race-day operations: archived series and roles without score view-only.
  const readOnly = useSeriesReadOnly() || !can('score');
  // Sub-series gestures restructure the series, so they follow the
  // series-configuration permission, not the race-day one.
  const canManageBlocks = !useSeriesReadOnly() && can('manage-series');
  const subSeriesEnabled = has('sub-series');
  const { data: races } = useRacesBySeries(seriesId);
  const { data: series } = useSeries(seriesId);
  const { data: fleets } = useFleetsBySeries(seriesId);
  const { data: subSeriesList } = useSubSeriesBySeries(seriesId);
  const saveRace = useSaveRace();
  const reorderRaces = useReorderRaces(seriesId);
  const saveRaceStarts = useSaveRaceStarts();
  const createSubSeries = useCreateSubSeries();
  const saveSubSeries = useSaveSubSeries();
  const deleteSubSeries = useDeleteSubSeries();
  const raceListRef = useRef<HTMLDivElement>(null);
  const didAutoFocus = useRef(false);

  // Handicap race creation dialog state
  const [showNewRaceDialog, setShowNewRaceDialog] = useState(false);
  const [firstStartTime, setFirstStartTime] = useState('');
  const [newRaceError, setNewRaceError] = useState('');
  // Local in-flight guard for Add race. Covers the `listBySeries` →
  // `saveRace.mutateAsync` window where `saveRace.isPending` is still
  // false but a second click would compute the same raceNumber and
  // 500 on the (series_id, race_number) unique index.
  const [addingRace, setAddingRace] = useState(false);

  // Sub-series editor dialog. `editingSubSeries` null while open = create;
  // a SubSeries = edit that one. A sub-series is a named selection of races.
  const [showSubSeriesDialog, setShowSubSeriesDialog] = useState(false);
  const [editingSubSeries, setEditingSubSeries] = useState<SubSeries | null>(null);
  const [subSeriesName, setSubSeriesName] = useState('');
  const [selectedRaceIds, setSelectedRaceIds] = useState<Set<string>>(new Set());
  // Fleet scoping (default: all fleets). Per-fleet exclusions are keyed
  // `${raceId}::${fleetId}` — a race struck for one fleet within this block.
  const [selectedFleetIds, setSelectedFleetIds] = useState<Set<string>>(new Set());
  const [excludedPairs, setExcludedPairs] = useState<Set<string>>(new Set());
  const [carryFromId, setCarryFromId] = useState('');
  const [subSeriesError, setSubSeriesError] = useState('');

  const isHandicap = series?.scoringMode === 'handicap';
  const startSequence = series?.defaultStartSequence;
  const hasStartSequence = startSequence && startSequence.length > 0;

  // Sub-series (named selections of races), with their resolved race lists for
  // the count display. Shown whenever any exist, even if the feature is later
  // switched off; the gate controls creation/editing.
  const blocks =
    subSeriesList && subSeriesList.length > 0 && races
      ? groupRacesBySubSeries(subSeriesList, races)
      : null;

  // Preview of starts based on the entered first start time
  const previewStarts = (firstStartTime && hasStartSequence)
    ? (() => {
        const normalized = normalizeTimeInput(firstStartTime);
        if (!normalized) return null;
        return generateStarts(startSequence!, normalized);
      })()
    : null;

  const fleetNameById = new Map((fleets ?? []).map((f) => [f.id, f.name]));

  // Move a race one place earlier (-1) or later (+1) in the series, renumbering
  // to match. Backs the Alt+↑/↓ row shortcut and reuses the drag reorder path.
  function nudgeRace(raceId: string, direction: -1 | 1) {
    if (!races) return;
    const ids = races.map((r) => r.id);
    const idx = ids.indexOf(raceId);
    const target = idx + direction;
    if (idx < 0 || target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[idx], next[target]] = [next[target], next[idx]];
    reorderRaces.mutate(next);
  }

  // Insert a new (unnamed, today-dated) race at a position: create it appended,
  // then reorder with its id spliced into place so the tail renumbers. Starts
  // can be added on the new race's page.
  async function insertRaceAt(index: number) {
    if (!races || addingRace) return;
    setAddingRace(true);
    try {
      const newId = crypto.randomUUID();
      await saveRace.mutateAsync({
        id: newId,
        seriesId,
        raceNumber: races.length + 1,
        name: null,
        date: new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
      });
      const ids = races.map((r) => r.id);
      ids.splice(index, 0, newId);
      await reorderRaces.mutateAsync(ids);
    } finally {
      setAddingRace(false);
    }
  }

  // Auto-focus first row when list first loads
  useEffect(() => {
    if (didAutoFocus.current || !races?.length) return;
    didAutoFocus.current = true;
    (raceListRef.current?.querySelector<HTMLElement>('[tabindex="0"]'))?.focus();
  }, [races]);

  useShortcuts([
    {
      key: 'n',
      description: 'Add race',
      section: 'Races',
      when: () => !readOnly,
      handler: () => {
        if (isHandicap && hasStartSequence) {
          setFirstStartTime('');
          setNewRaceError('');
          setShowNewRaceDialog(true);
        } else {
          handleAddRaceScratch();
        }
      },
    },
  ]);
  // Row-level keys bound on the focused race row itself.
  useShortcutHelp([
    { key: '↵', description: 'Open focused race', section: 'Races' },
    { key: 'd', description: 'Delete focused race', section: 'Races' },
    { key: 'Alt+↑ / Alt+↓', description: 'Move focused race earlier / later', section: 'Races' },
  ]);

  async function handleAddRaceScratch() {
    if (addingRace) return;
    setAddingRace(true);
    try {
      const existingRaces = await raceRepo.listBySeries(seriesId);
      const nextNumber = existingRaces.length + 1;
      const race: Race = {
        id: crypto.randomUUID(),
        seriesId,
        raceNumber: nextNumber,
        name: null,
        date: new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
      };
      log('races', 'adding', race);
      await saveRace.mutateAsync(race);
    } finally {
      setAddingRace(false);
    }
  }

  async function handleAddRaceHandicap() {
    if (addingRace) return;
    const normalized = normalizeTimeInput(firstStartTime);
    if (!normalized) {
      setNewRaceError('Enter a valid time, e.g. 14:05:00 or 140500.');
      return;
    }
    if (!hasStartSequence) {
      setNewRaceError('No default start sequence configured. Set one in Settings > Fleets.');
      return;
    }

    setAddingRace(true);
    try {
      const existingRaces = await raceRepo.listBySeries(seriesId);
      const nextNumber = existingRaces.length + 1;
      const race: Race = {
        id: crypto.randomUUID(),
        seriesId,
        raceNumber: nextNumber,
        name: null,
        date: new Date().toISOString().slice(0, 10),
        createdAt: Date.now(),
      };
      log('races', 'adding with starts', race);
      await saveRace.mutateAsync(race);

      // Create RaceStart records from the start sequence
      const starts = generateStarts(startSequence!, normalized);
      await saveRaceStarts.mutateAsync(
        starts.map((start) => ({
          id: crypto.randomUUID(),
          raceId: race.id,
          fleetIds: start.fleetIds,
          startTime: start.startTime,
        })),
      );

      setShowNewRaceDialog(false);
    } finally {
      setAddingRace(false);
    }
  }

  function handleAddRaceClick() {
    if (isHandicap && hasStartSequence) {
      setFirstStartTime('');
      setNewRaceError('');
      setShowNewRaceDialog(true);
    } else {
      handleAddRaceScratch();
    }
  }

  const allFleetIds = (fleets ?? []).map((f) => f.id);

  function openCreateSubSeries() {
    setEditingSubSeries(null);
    setSubSeriesName('');
    setSelectedRaceIds(new Set());
    setSelectedFleetIds(new Set(allFleetIds));
    setExcludedPairs(new Set());
    setCarryFromId('');
    setSubSeriesError('');
    setShowSubSeriesDialog(true);
  }

  function openEditSubSeries(ss: SubSeries) {
    setEditingSubSeries(ss);
    setSubSeriesName(ss.name);
    setSelectedRaceIds(new Set(ss.raceIds));
    setSelectedFleetIds(new Set(ss.fleetIds ?? allFleetIds));
    setExcludedPairs(
      new Set((ss.raceFleetExclusions ?? []).map((ex) => `${ex.raceId}::${ex.fleetId}`)),
    );
    setCarryFromId(ss.startingHandicapSource === 'continue' ? ss.continueFromSubSeriesId ?? '' : '');
    setSubSeriesError('');
    setShowSubSeriesDialog(true);
  }

  function toggleRaceSelected(raceId: string) {
    setSelectedRaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(raceId)) next.delete(raceId);
      else next.add(raceId);
      return next;
    });
  }

  function toggleFleetSelected(fleetId: string) {
    setSelectedFleetIds((prev) => {
      const next = new Set(prev);
      if (next.has(fleetId)) next.delete(fleetId);
      else next.add(fleetId);
      return next;
    });
  }

  function toggleExcluded(raceId: string, fleetId: string) {
    setExcludedPairs((prev) => {
      const key = `${raceId}::${fleetId}`;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleSaveSubSeries() {
    const name = subSeriesName.trim();
    if (!name) {
      setSubSeriesError('Enter a name for the sub-series.');
      return;
    }
    const raceIds = (races ?? []).filter((r) => selectedRaceIds.has(r.id)).map((r) => r.id);
    const startingHandicapSource = carryFromId ? ('continue' as const) : ('base' as const);
    const continueFromSubSeriesId = carryFromId || null;

    // Scope to a fleet subset only when fewer than all are picked; all selected
    // means "all fleets" (the server stores that as absent).
    const scopedFleetIds = allFleetIds.filter((id) => selectedFleetIds.has(id));
    const fleetIds =
      scopedFleetIds.length > 0 && scopedFleetIds.length < allFleetIds.length
        ? scopedFleetIds
        : undefined;
    // Exclusions only matter for selected races and scoped fleets.
    const effectiveFleetIds = new Set(fleetIds ?? allFleetIds);
    const selectedRaceIdList = new Set(raceIds);
    const raceFleetExclusions = [...excludedPairs]
      .map((key) => {
        const [raceId, fleetId] = key.split('::');
        return { raceId, fleetId };
      })
      .filter((ex) => selectedRaceIdList.has(ex.raceId) && effectiveFleetIds.has(ex.fleetId));

    if (editingSubSeries) {
      await saveSubSeries.mutateAsync({
        ...editingSubSeries,
        name,
        raceIds,
        fleetIds,
        raceFleetExclusions,
        startingHandicapSource,
        continueFromSubSeriesId,
      });
    } else {
      await createSubSeries.mutateAsync({
        seriesId,
        input: { name, raceIds, fleetIds, raceFleetExclusions, startingHandicapSource, continueFromSubSeriesId },
      });
    }
    setShowSubSeriesDialog(false);
  }

  async function handleDeleteSubSeries(ss: SubSeries) {
    if (!confirm(`Remove sub-series "${ss.name}"? The races themselves are kept.`)) return;
    await deleteSubSeries.mutateAsync({ seriesId, subSeriesId: ss.id });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {races === undefined
            ? 'Loading…'
            : `${races.length} race${races.length === 1 ? '' : 's'}`}
        </p>
        <div className="flex items-center gap-2">
          {subSeriesEnabled && canManageBlocks && races !== undefined && races.length > 0 && (
            <Button variant="outline" onClick={openCreateSubSeries}>
              New sub-series
            </Button>
          )}
          {!readOnly && (
            <Button onClick={handleAddRaceClick} disabled={addingRace}>
              Add race
            </Button>
          )}
        </div>
      </div>

      {races !== undefined && races.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No races yet. Add the first race above.
        </p>
      )}

      {/* Sub-series: named selections of races, each scored on its own. */}
      {blocks && blocks.length > 0 && (
        <div className="space-y-2 rounded-lg border bg-muted/30 p-4">
          <h3 className="text-sm font-semibold">Sub-series</h3>
          {blocks.map(({ subSeries: block, races: blockRaces }) => (
            <div key={block.id} className="flex items-center justify-between gap-2">
              <div className="text-sm">
                <span className="font-medium">{block.name}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {blockRaces.length} race{blockRaces.length === 1 ? '' : 's'}
                  {block.startingHandicapSource === 'continue' && block.continueFromSubSeriesId && (
                    <> · continues {subSeriesList?.find((s) => s.id === block.continueFromSubSeriesId)?.name ?? '—'}</>
                  )}
                </span>
              </div>
              {canManageBlocks && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Edit sub-series ${block.name}`}
                    onClick={() => openEditSubSeries(block)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove sub-series ${block.name}`}
                    onClick={() => handleDeleteSubSeries(block)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {races !== undefined && races.length > 0 && (
        <div className="space-y-2" ref={raceListRef}>
          {readOnly ? (
            races.map((race) => (
              <RaceRow key={race.id} race={race} seriesId={seriesId} />
            ))
          ) : (
            <SortableList items={races} onReorder={(orderedIds) => reorderRaces.mutate(orderedIds)}>
              {(race, { ref, style, handleProps }) => {
                const index = races.findIndex((r) => r.id === race.id);
                return (
                  <RaceRow
                    race={race}
                    seriesId={seriesId}
                    rowRef={ref}
                    rowStyle={style}
                    dragHandle={handleProps}
                    onNudge={(direction) => nudgeRace(race.id, direction)}
                    onInsert={(position) => insertRaceAt(position === 'above' ? index : index + 1)}
                  />
                );
              }}
            </SortableList>
          )}
        </div>
      )}

      {/* Handicap race creation dialog */}
      <Dialog open={showNewRaceDialog} onOpenChange={(open) => { if (!open) setShowNewRaceDialog(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New race</DialogTitle>
            <DialogDescription>Set the first start time to generate the start sequence.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="firstStartTime">First start time</Label>
              <Input
                id="firstStartTime"
                value={firstStartTime}
                onChange={(e) => { setFirstStartTime(e.target.value); setNewRaceError(''); }}
                placeholder="e.g. 14:05:00"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddRaceHandicap(); } }}
              />
            </div>
            {previewStarts && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground font-medium">Start sequence preview:</p>
                {previewStarts.map((s, i) => (
                  <p key={i} className="text-sm">
                    <span className="font-mono">{s.startTime}</span>
                    {' — '}
                    {s.fleetIds.map((id) => fleetNameById.get(id) ?? id).join(', ')}
                    {i > 0 && startSequence && (
                      <span className="text-xs text-muted-foreground ml-1">(+{startSequence[i].intervalMinutes} min after Start {i})</span>
                    )}
                  </p>
                ))}
              </div>
            )}
            {newRaceError && <p className="text-sm text-destructive">{newRaceError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowNewRaceDialog(false)}>Cancel</Button>
            <Button onClick={handleAddRaceHandicap}>Create race</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sub-series editor: name + race selection + optional handicap carry */}
      <Dialog open={showSubSeriesDialog} onOpenChange={(open) => { if (!open) setShowSubSeriesDialog(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSubSeries ? 'Edit sub-series' : 'New sub-series'}</DialogTitle>
            <DialogDescription>
              A sub-series is a named selection of races, scored on its own — its
              own standings, discards, and (for NHC/ECHO) its own handicaps.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="subSeriesName">Name</Label>
              <Input
                id="subSeriesName"
                value={subSeriesName}
                onChange={(e) => { setSubSeriesName(e.target.value); setSubSeriesError(''); }}
                placeholder="e.g. Spring, Tuesday Series 1"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>Races</Label>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                {(races ?? []).map((race) => (
                  <label
                    key={race.id}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRaceIds.has(race.id)}
                      onChange={() => toggleRaceSelected(race.id)}
                    />
                    <span className="font-medium">Race {race.raceNumber}</span>
                    {race.name && <span>{race.name}</span>}
                    {race.date && <span className="text-xs text-muted-foreground">{race.date}</span>}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selectedRaceIds.size} of {races?.length ?? 0} races selected.
              </p>
            </div>
            {(fleets?.length ?? 0) > 1 && (
              <div className="space-y-1.5">
                <Label>Fleets</Label>
                <div className="space-y-1 rounded-md border p-2">
                  {(fleets ?? []).map((fleet) => (
                    <label
                      key={fleet.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-muted"
                    >
                      <input
                        type="checkbox"
                        checked={selectedFleetIds.has(fleet.id)}
                        onChange={() => toggleFleetSelected(fleet.id)}
                      />
                      <span className="font-medium">{fleet.name}</span>
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  All fleets are scored unless you narrow this. Scoping to one
                  fleet keeps the others out of this sub-series&apos; standings.
                </p>
              </div>
            )}
            {(fleets?.length ?? 0) > 1 && selectedRaceIds.size > 0 && selectedFleetIds.size > 0 && (
              <details className="rounded-md border p-2">
                <summary className="cursor-pointer text-sm font-medium">
                  Per-fleet race exclusions
                </summary>
                <p className="mb-2 mt-1 text-xs text-muted-foreground">
                  Strike a race for one fleet only (e.g. a single-competitor
                  heat). It still counts for the other fleets.
                </p>
                <div className="max-h-48 space-y-2 overflow-y-auto">
                  {(races ?? [])
                    .filter((r) => selectedRaceIds.has(r.id))
                    .map((race) => (
                      <div key={race.id} className="text-sm">
                        <span className="font-medium">Race {race.raceNumber}</span>
                        {race.name && <span className="ml-1 text-muted-foreground">{race.name}</span>}
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          {(fleets ?? [])
                            .filter((f) => selectedFleetIds.has(f.id))
                            .map((fleet) => (
                              <label key={fleet.id} className="flex cursor-pointer items-center gap-1.5 text-xs">
                                <input
                                  type="checkbox"
                                  checked={excludedPairs.has(`${race.id}::${fleet.id}`)}
                                  onChange={() => toggleExcluded(race.id, fleet.id)}
                                />
                                <span>Exclude {fleet.name}</span>
                              </label>
                            ))}
                        </div>
                      </div>
                    ))}
                </div>
              </details>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="carryFrom">Continue handicaps from</Label>
              <select
                id="carryFrom"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                value={carryFromId}
                onChange={(e) => setCarryFromId(e.target.value)}
              >
                <option value="">Start from base ratings</option>
                {(subSeriesList ?? [])
                  .filter((s) => s.id !== editingSubSeries?.id)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </select>
              <p className="text-xs text-muted-foreground">
                For NHC/ECHO: seed this sub-series&apos; progressive handicaps from
                another&apos;s end, instead of the class base numbers.
              </p>
            </div>
            {subSeriesError && <p className="text-sm text-destructive">{subSeriesError}</p>}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowSubSeriesDialog(false)}>Cancel</Button>
            <Button
              onClick={handleSaveSubSeries}
              disabled={createSubSeries.isPending || saveSubSeries.isPending}
            >
              {editingSubSeries ? 'Save' : 'Create sub-series'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
