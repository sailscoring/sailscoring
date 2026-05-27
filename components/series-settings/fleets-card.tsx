'use client';

import { useState } from 'react';
import { useFeatures } from '@/components/features-provider';
import {
  competitorRepo,
  raceRepo,
  finishRepo,
  raceStartRepo,
} from '@/lib/api-repository';
import { useFleetsBySeries, useDeleteFleet, useSaveFleet, useSaveFleets } from '@/hooks/use-fleets';
import { useSaveCompetitors } from '@/hooks/use-competitors';
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
import { ECHO_DEFAULT_ALPHA } from '@/lib/scoring';
import { NhcProfileDialog } from './nhc-profile-dialog';

export type FleetsCardProps = {
  seriesId: string;
  series: Series;
  mode?: 'settings' | 'wizard';
};

export function FleetsCard({ seriesId, series, mode = 'settings' }: FleetsCardProps) {
  const { has } = useFeatures();
  const isWizard = mode === 'wizard';
  const { data: fleetsData } = useFleetsBySeries(seriesId);
  const fleets = fleetsData ?? [];
  const saveFleet = useSaveFleet();
  const saveFleets = useSaveFleets();
  const deleteFleetMutation = useDeleteFleet();
  const saveCompetitors = useSaveCompetitors();
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
  const [editingNhcProfileFor, setEditingNhcProfileFor] = useState<Fleet | null>(null);

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
    const changed = reordered
      .map((f, i) => (f.displayOrder === i ? null : { ...f, displayOrder: i }))
      .filter((f): f is Fleet => f !== null);
    if (changed.length > 0) {
      await saveFleets.mutateAsync(changed);
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

    // Seed the default α when switching INTO ECHO; drop it when switching out.
    // NHC fleets fall back to DEFAULT_NHC_PROFILE when `nhcProfile` is absent
    // — only customisation materialises it. Drop any override when leaving NHC.
    const next: Fleet = {
      ...fleet,
      scoringSystem: system,
      ...(system === 'echo' ? { echoAlpha: fleet.echoAlpha ?? ECHO_DEFAULT_ALPHA } : { echoAlpha: undefined }),
      ...(system === 'nhc' ? {} : { nhcProfile: undefined }),
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

  async function commitEchoAlpha(fleet: Fleet, raw: string) {
    const trimmed = raw.trim();
    if (!trimmed) return;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 1) return;
    if (parsed === fleet.echoAlpha) return;
    await saveFleet.mutateAsync({ ...fleet, echoAlpha: parsed });
  }

  async function commitNhcProfile(fleet: Fleet, next: import('@/lib/types').NhcProfile | null) {
    // `null` means "matches DEFAULT_NHC_PROFILE" — clear the override so the
    // fleet falls back to the engine default on read. Skip the round-trip if
    // nothing actually changed.
    const current = fleet.nhcProfile;
    const noOp = next === null ? current == null : current != null
      && next.alphaP === current.alphaP
      && next.alphaN === current.alphaN
      && next.alphaPX === current.alphaPX
      && next.alphaNX === current.alphaNX
      && next.sdOver === current.sdOver
      && next.sdUnder === current.sdUnder
      && next.minFin === current.minFin;
    if (!noOp) {
      await saveFleet.mutateAsync({ ...fleet, nhcProfile: next ?? undefined });
    }
    setEditingNhcProfileFor(null);
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
    // Skip competitors whose only fleet is this one — keep them on the original
    // fleet list rather than leaving them unassigned (matches prior behaviour).
    const patched = competitorsInFleet
      .filter((c) => c.fleetIds.includes(fleet.id) && c.fleetIds.length > 1)
      .map((c) => ({ ...c, fleetIds: c.fleetIds.filter((id) => id !== fleet.id) }));
    if (patched.length > 0) {
      await saveCompetitors.mutateAsync(patched);
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
      const affected = allStarts.filter((s) => s.fleetIds.includes(fleet.id));
      await Promise.all(
        affected.map((s) => {
          const remaining = s.fleetIds.filter((id) => id !== fleet.id);
          return remaining.length === 0
            ? deleteRaceStart.mutateAsync({ id: s.id, raceId: s.raceId })
            : saveRaceStart.mutateAsync({ ...s, fleetIds: remaining });
        }),
      );
    }
    await deleteFleetMutation.mutateAsync({ id: fleet.id, seriesId });
    await touchSeries.mutateAsync(seriesId);
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
                      {/* ECHO is experimental/gated (#155); still offer it for a
                          fleet that already uses it so the control isn't broken. */}
                      {(has('echo') || fleet.scoringSystem === 'echo') && (
                        <SelectItem value="echo">ECHO</SelectItem>
                      )}
                    </SelectContent>
                  </Select>
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
                  {/* Custom NHC parameters are experimental/gated (#155); NHC
                      scoring with stock SWNHC2015 stays GA. Keep the button for
                      a fleet that already carries a custom profile. */}
                  {fleet.scoringSystem === 'nhc' &&
                    (has('nhc-parameters') || Boolean(fleet.nhcProfile)) && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => setEditingNhcProfileFor(fleet)}
                      title={fleet.nhcProfile
                        ? 'Edit per-fleet NHC parameters (currently customised)'
                        : 'Edit per-fleet NHC parameters (currently stock SWNHC2015)'}
                      data-testid={`nhc-configure-${fleet.id}`}
                    >
                      {fleet.nhcProfile ? 'NHC · custom' : 'Configure…'}
                    </Button>
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
      <NhcProfileDialog
        open={editingNhcProfileFor !== null}
        fleetName={editingNhcProfileFor?.name ?? ''}
        initial={editingNhcProfileFor?.nhcProfile}
        onClose={() => setEditingNhcProfileFor(null)}
        onSave={(next) => {
          if (editingNhcProfileFor) void commitNhcProfile(editingNhcProfileFor, next);
        }}
      />
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
            <Button
              variant="destructive"
              onClick={() => {
                const fleet = confirmDeleteFleet;
                if (!fleet) return;
                setConfirmDeleteFleet(null);
                void handleDeleteFleet(fleet);
              }}
            >
              Delete fleet
            </Button>
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
                if (f.scoringSystem === 'nhc') return `${f.name} (NHC${f.nhcProfile ? ', custom' : ''})`;
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
