'use client';

import { useState } from 'react';
import { useRepos } from '@/lib/repos';
import { useFleetsBySeries, useDeleteFleet, useSaveFleet } from '@/hooks/use-fleets';
import { useSaveCompetitor } from '@/hooks/use-competitors';
import { useDeleteRaceStart, useSaveRaceStart } from '@/hooks/use-race-starts';
import { useTouchSeries, useUpdateSeries } from '@/hooks/use-series';
import type { Fleet, Series } from '@/lib/types';
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
import { Input } from '@/components/ui/input';
import { StartSequenceEditor } from './start-sequence-editor';
import { NHC_DEFAULT_ALPHA, ECHO_DEFAULT_ALPHA } from '@/lib/scoring';

export type FleetsCardProps = {
  seriesId: string;
  series: Series;
  mode?: 'settings' | 'wizard';
};

export function FleetsCard({ seriesId, series, mode = 'settings' }: FleetsCardProps) {
  const isWizard = mode === 'wizard';
  const { competitorRepo, raceRepo, finishRepo, raceStartRepo } = useRepos();
  const { data: fleetsData } = useFleetsBySeries(seriesId);
  const fleets = fleetsData ?? [];
  const saveFleet = useSaveFleet();
  const deleteFleetMutation = useDeleteFleet();
  const saveCompetitor = useSaveCompetitor();
  const saveRaceStart = useSaveRaceStart();
  const deleteRaceStart = useDeleteRaceStart();
  const touchSeries = useTouchSeries();
  const updateSeries = useUpdateSeries();
  const [expanded, setExpanded] = useState(isWizard);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [addingFleet, setAddingFleet] = useState(false);
  const [newFleetName, setNewFleetName] = useState('');
  const [newFleetError, setNewFleetError] = useState('');
  const [scoringSystemError, setScoringSystemError] = useState<{ fleetId: string; message: string } | null>(null);
  const [confirmToScratch, setConfirmToScratch] = useState<{ fleet: Fleet } | null>(null);
  const [confirmDeleteFleet, setConfirmDeleteFleet] = useState<Fleet | null>(null);

  const isOnlyDefault = fleets.length === 1 && fleets[0].name === 'Default';

  async function moveFleet(index: number, direction: -1 | 1) {
    const sorted = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const reordered = [...sorted];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(swapIndex, 0, moved);
    // Renumber rather than swap values: this self-heals fleets that share a
    // displayOrder (which a historical race in ensureFleet could produce).
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].displayOrder !== i) {
        await saveFleet.mutateAsync({ ...reordered[i], displayOrder: i });
      }
    }
  }

  function startRename(fleet: Fleet) {
    setRenamingId(fleet.id);
    setRenameValue(fleet.name);
    setRenameError('');
  }

  async function commitRename(fleet: Fleet) {
    const newName = renameValue.trim();
    if (newName && newName !== fleet.name) {
      const duplicate = fleets.some(
        (f) => f.id !== fleet.id && f.name.toLowerCase() === newName.toLowerCase(),
      );
      if (duplicate) {
        setRenameError(`"${newName}" already exists.`);
        return;
      }
      await saveFleet.mutateAsync({ ...fleet, name: newName });
    }
    setRenamingId(null);
    setRenameError('');
  }

  async function changeScoringSystem(fleet: Fleet, system: Fleet['scoringSystem']) {
    setScoringSystemError(null);
    const wasScratch = fleet.scoringSystem === 'scratch';
    const willBeScratch = system === 'scratch';

    // Seed the default α when switching INTO a progressive system; drop it
    // when switching OUT (NHC and ECHO each have their own α field).
    const next: Fleet = {
      ...fleet,
      scoringSystem: system,
      ...(system === 'nhc' ? { nhcAlpha: fleet.nhcAlpha ?? NHC_DEFAULT_ALPHA } : { nhcAlpha: undefined }),
      ...(system === 'echo' ? { echoAlpha: fleet.echoAlpha ?? ECHO_DEFAULT_ALPHA } : { echoAlpha: undefined }),
    };

    if (wasScratch === willBeScratch) {
      await saveFleet.mutateAsync(next);
      return;
    }

    if (wasScratch && !willBeScratch) {
      const competitorsInFleet = await competitorRepo.listBySeries(seriesId);
      const fleetCompetitorIds = new Set(
        competitorsInFleet.filter((c) => c.fleetIds.includes(fleet.id)).map((c) => c.id),
      );
      if (fleetCompetitorIds.size === 0) {
        await saveFleet.mutateAsync(next);
        return;
      }
      const races = await raceRepo.listBySeries(seriesId);
      let untimedCount = 0;
      for (const race of races) {
        const finishes = await finishRepo.listByRace(race.id);
        for (const f of finishes) {
          if (f.competitorId && fleetCompetitorIds.has(f.competitorId)
              && f.sortOrder !== null && f.resultCode === null && !f.finishTime) {
            untimedCount++;
          }
        }
      }
      if (untimedCount > 0) {
        setScoringSystemError({
          fleetId: fleet.id,
          message: `Cannot switch to ${system.toUpperCase()}: ${untimedCount} finish${untimedCount === 1 ? ' lacks' : 'es lack'} a finish time. Enter finish times on those races first.`,
        });
        return;
      }
      await saveFleet.mutateAsync(next);
      return;
    }

    setConfirmToScratch({ fleet: next });
  }

  async function commitAlpha(fleet: Fleet, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return;
    if (parsed === fleet.nhcAlpha) return;
    await saveFleet.mutateAsync({ ...fleet, nhcAlpha: parsed });
  }

  async function commitEchoAlpha(fleet: Fleet, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return;
    if (parsed === fleet.echoAlpha) return;
    await saveFleet.mutateAsync({ ...fleet, echoAlpha: parsed });
  }

  async function confirmSwitchToScratch() {
    if (!confirmToScratch) return;
    await saveFleet.mutateAsync(confirmToScratch.fleet);
    setConfirmToScratch(null);
  }

  async function handleAddFleet() {
    const name = newFleetName.trim();
    if (!name) {
      setNewFleetError('Fleet name is required.');
      return;
    }
    if (fleets.some((f) => f.name.toLowerCase() === name.toLowerCase())) {
      setNewFleetError(`"${name}" already exists.`);
      return;
    }
    const maxOrder = fleets.reduce((max, f) => Math.max(max, f.displayOrder), -1);
    await saveFleet.mutateAsync({
      id: crypto.randomUUID(),
      seriesId,
      name,
      displayOrder: maxOrder + 1,
      scoringSystem: 'scratch',
    });
    await touchSeries.mutateAsync(seriesId);
    setNewFleetName('');
    setNewFleetError('');
    setAddingFleet(false);
  }

  async function handleDeleteFleet(fleet: Fleet) {
    const competitorsInFleet = await competitorRepo.listBySeries(seriesId);
    const count = competitorsInFleet.filter((c) => c.fleetIds.includes(fleet.id)).length;
    if (count > 0) {
      for (const c of competitorsInFleet) {
        if (c.fleetIds.includes(fleet.id)) {
          const remaining = c.fleetIds.filter((id) => id !== fleet.id);
          await saveCompetitor.mutateAsync({ ...c, fleetIds: remaining.length > 0 ? remaining : c.fleetIds });
        }
      }
    }
    const seq = series.defaultStartSequence;
    if (seq?.some((g) => g.fleetIds.includes(fleet.id))) {
      const next = seq
        .map((g) => ({ ...g, fleetIds: g.fleetIds.filter((id) => id !== fleet.id) }))
        .filter((g) => g.fleetIds.length > 0);
      await updateSeries.mutateAsync({
        id: seriesId,
        patch: { defaultStartSequence: next.length > 0 ? next : undefined },
      });
    }
    const races = await raceRepo.listBySeries(seriesId);
    const raceIds = races.map((r) => r.id);
    if (raceIds.length > 0) {
      const allStarts = await raceStartRepo.listByRaces(raceIds);
      for (const s of allStarts) {
        if (!s.fleetIds.includes(fleet.id)) continue;
        const remaining = s.fleetIds.filter((id) => id !== fleet.id);
        if (remaining.length === 0) {
          await deleteRaceStart.mutateAsync({ id: s.id, raceId: s.raceId });
        } else {
          await saveRaceStart.mutateAsync({ ...s, fleetIds: remaining });
        }
      }
    }
    await deleteFleetMutation.mutateAsync({ id: fleet.id, seriesId });
    await touchSeries.mutateAsync(seriesId);
    setConfirmDeleteFleet(null);
  }

  const sorted = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);

  const body = (
    <div className="space-y-3">
      {!isWizard && (
        <p className="text-xs text-muted-foreground">
          Add and configure fleets for your series. Set each fleet&apos;s scoring system here.
        </p>
      )}
      <div className="space-y-1">
        {sorted.map((fleet, i) => (
          <div key={fleet.id} data-testid="fleet-row" className="flex-col items-start gap-1">
            <div className="flex items-center gap-2">
              {renamingId === fleet.id ? (
                <input
                  className={`flex-1 border rounded px-2 py-1 text-sm${renameError ? ' border-destructive' : ''}`}
                  value={renameValue}
                  autoFocus
                  onChange={(e) => { setRenameValue(e.target.value); setRenameError(''); }}
                  onBlur={() => commitRename(fleet)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitRename(fleet); }
                    if (e.key === 'Escape') { setRenamingId(null); setRenameError(''); }
                  }}
                />
              ) : (
                <span className="flex-1 text-sm">{fleet.name}</span>
              )}
              {series.scoringMode === 'handicap' && (
                <>
                  <Select
                    value={fleet.scoringSystem}
                    onValueChange={(v) => changeScoringSystem(fleet, v as Fleet['scoringSystem'])}
                  >
                    <SelectTrigger className="w-28 h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="scratch">Scratch</SelectItem>
                      <SelectItem value="irc">IRC</SelectItem>
                      <SelectItem value="py">PY</SelectItem>
                      <SelectItem value="nhc">NHC</SelectItem>
                      <SelectItem value="echo">ECHO</SelectItem>
                    </SelectContent>
                  </Select>
                  {fleet.scoringSystem === 'nhc' && (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      α
                      <Input
                        type="number"
                        defaultValue={fleet.nhcAlpha ?? NHC_DEFAULT_ALPHA}
                        step="0.01"
                        min="0.01"
                        max="1"
                        className="w-16 h-7 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        onBlur={(e) => commitAlpha(fleet, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitAlpha(fleet, (e.target as HTMLInputElement).value);
                          }
                        }}
                        title="NHC blend rate (0 < α ≤ 1; default 0.15)"
                      />
                    </label>
                  )}
                  {fleet.scoringSystem === 'echo' && (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      α
                      <Input
                        type="number"
                        defaultValue={fleet.echoAlpha ?? ECHO_DEFAULT_ALPHA}
                        step="0.01"
                        min="0.01"
                        max="1"
                        className="w-16 h-7 text-xs [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        onBlur={(e) => commitEchoAlpha(fleet, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitEchoAlpha(fleet, (e.target as HTMLInputElement).value);
                          }
                        }}
                        title="ECHO blend rate (0 < α ≤ 1; 0.25 club / 0.50 regatta — IS 2022 guide)"
                      />
                    </label>
                  )}
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-muted-foreground"
                disabled={i === 0}
                onClick={() => moveFleet(i, -1)}
                title="Move up"
              >
                ↑
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-muted-foreground"
                disabled={i === sorted.length - 1}
                onClick={() => moveFleet(i, 1)}
                title="Move down"
              >
                ↓
              </Button>
              {renamingId !== fleet.id && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => startRename(fleet)}
                >
                  Rename
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-1.5 text-destructive/70 hover:text-destructive"
                onClick={() => setConfirmDeleteFleet(fleet)}
                title="Delete fleet"
              >
                ×
              </Button>
            </div>
            {renamingId === fleet.id && renameError && (
              <p className="text-xs text-destructive mt-0.5">{renameError}</p>
            )}
            {scoringSystemError?.fleetId === fleet.id && (
              <p className="text-xs text-destructive mt-0.5" data-testid={`scoring-system-error-${fleet.id}`}>
                {scoringSystemError.message}
              </p>
            )}
          </div>
        ))}
      </div>
      {addingFleet ? (
        <div className="flex items-center gap-2">
          <input
            className={`flex-1 border rounded px-2 py-1 text-sm${newFleetError ? ' border-destructive' : ''}`}
            value={newFleetName}
            autoFocus
            placeholder="Fleet name"
            onChange={(e) => { setNewFleetName(e.target.value); setNewFleetError(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); handleAddFleet(); }
              if (e.key === 'Escape') { setAddingFleet(false); setNewFleetName(''); setNewFleetError(''); }
            }}
          />
          <Button type="button" size="sm" className="h-7" onClick={handleAddFleet}>Add</Button>
          <Button type="button" variant="ghost" size="sm" className="h-7" onClick={() => { setAddingFleet(false); setNewFleetName(''); setNewFleetError(''); }}>Cancel</Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setAddingFleet(true)}>
          + Add fleet
        </Button>
      )}
      {newFleetError && <p className="text-xs text-destructive">{newFleetError}</p>}
      {series.scoringMode === 'handicap' && sorted.length > 0 && (
        <StartSequenceEditor
          value={series.defaultStartSequence}
          fleets={sorted}
          onSave={async (next) => {
            await updateSeries.mutateAsync({ id: seriesId, patch: { defaultStartSequence: next } });
            await touchSeries.mutateAsync(seriesId);
          }}
        />
      )}
      {!isWizard && (
        <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
          Done
        </Button>
      )}
    </div>
  );

  const dialogs = (
    <>
      <Dialog open={confirmToScratch !== null} onOpenChange={(open) => { if (!open) setConfirmToScratch(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Switch to scratch scoring?</DialogTitle>
            <DialogDescription>
              Finish times for {confirmToScratch?.fleet.name} will be preserved but not used for scoring. You can switch back to handicap scoring later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmToScratch(null)}>Cancel</Button>
            <Button onClick={confirmSwitchToScratch}>Switch to scratch</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmDeleteFleet !== null} onOpenChange={(open) => { if (!open) setConfirmDeleteFleet(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete fleet &ldquo;{confirmDeleteFleet?.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              Competitors in this fleet will be unassigned. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmDeleteFleet(null)}>Cancel</Button>
            <Button variant="destructive" onClick={() => confirmDeleteFleet && handleDeleteFleet(confirmDeleteFleet)}>Delete fleet</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  if (isWizard) {
    return <>{body}{dialogs}</>;
  }

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Fleets</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">
          {fleets.length === 0 || isOnlyDefault
            ? 'No fleets configured.'
            : sorted.map((f) => {
                if (f.scoringSystem === 'scratch') return f.name;
                if (f.scoringSystem === 'nhc') return `${f.name} (NHC, α=${f.nhcAlpha ?? NHC_DEFAULT_ALPHA})`;
                if (f.scoringSystem === 'echo') return `${f.name} (ECHO, α=${f.echoAlpha ?? ECHO_DEFAULT_ALPHA})`;
                return `${f.name} (${f.scoringSystem.toUpperCase()})`;
              }).join(' · ')}
        </p>
      ) : (
        body
      )}
      {dialogs}
    </div>
  );
}
