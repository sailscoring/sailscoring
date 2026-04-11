'use client';

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { seriesRepo, fleetRepo, finishRepo, competitorRepo, raceRepo } from '@/lib/dexie-repository';
import { db } from '@/lib/db';
import type { Fleet, CompetitorFieldKey, StartGroup } from '@/lib/types';
import { ALL_COMPETITOR_FIELDS, COMPETITOR_FIELD_LABELS, defaultEnabledCompetitorFields } from '@/lib/competitor-fields';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  saveSeriesFile,
  parseSeriesFile,
  checkLineage,
  openSeriesFromFile,
  updateSeriesFromFile,
  type SeriesFile,
  type LineageStatus,
} from '@/lib/series-file';
import type { DiscardThreshold, Series } from '@/lib/types';

function BasicsCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const [expanded, setExpanded] = useState(false);
  const [venue, setVenue] = useState(series.venue);
  const [startDate, setStartDate] = useState(series.startDate);
  const [endDate, setEndDate] = useState(series.endDate);
  const [venueLogoUrl, setVenueLogoUrl] = useState(series.venueLogoUrl);
  const [eventLogoUrl, setEventLogoUrl] = useState(series.eventLogoUrl);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    setVenue(series.venue);
    setStartDate(series.startDate);
    setEndDate(series.endDate);
    setVenueLogoUrl(series.venueLogoUrl);
    setEventLogoUrl(series.eventLogoUrl);
    setChanged(false);
  }, [series.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await db.series.update(seriesId, {
      venue: venue.trim(),
      startDate,
      endDate,
      venueLogoUrl: venueLogoUrl.trim(),
      eventLogoUrl: eventLogoUrl.trim(),
      lastModifiedAt: Date.now(),
    });
    setChanged(false);
    setExpanded(false);
  }

  const parts = [series.venue, series.startDate].filter(Boolean);
  const summary = parts.length ? parts.join(' · ') : 'No venue or dates set';

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Basic</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="venue">Venue</Label>
            <Input
              id="venue"
              value={venue}
              onChange={(e) => { setVenue(e.target.value); setChanged(true); }}
              placeholder="e.g. Howth Yacht Club"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="startDate">Start date</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => { setStartDate(e.target.value); setChanged(true); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="endDate">End date</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => { setEndDate(e.target.value); setChanged(true); }}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="venueLogoUrl">Venue logo URL</Label>
            <Input
              id="venueLogoUrl"
              type="url"
              value={venueLogoUrl}
              onChange={(e) => { setVenueLogoUrl(e.target.value); setChanged(true); }}
              placeholder="https://…"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eventLogoUrl">Event logo URL</Label>
            <Input
              id="eventLogoUrl"
              type="url"
              value={eventLogoUrl}
              onChange={(e) => { setEventLogoUrl(e.target.value); setChanged(true); }}
              placeholder="https://…"
            />
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={!changed}>
              {changed ? 'Save' : 'Saved'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function ScoringModeCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const [locked, setLocked] = useState(false);
  const [lockReason, setLockReason] = useState('');

  // Check if any race in the series has finishes — if so, scoring mode is locked
  useEffect(() => {
    (async () => {
      const races = await raceRepo.listBySeries(seriesId);
      if (races.length === 0) { setLocked(false); return; }
      const raceIds = races.map((r) => r.id);
      const finishes = await db.finishes.where('raceId').anyOf(raceIds).limit(1).toArray();
      if (finishes.length > 0) {
        setLocked(true);
        setLockReason('Scoring mode is locked because races have finishes. Remove all finishes to change it.');
      } else {
        setLocked(false);
      }
    })();
  }, [seriesId]);

  async function handleChange(mode: 'scratch' | 'handicap') {
    if (locked || mode === series.scoringMode) return;
    await db.series.update(seriesId, { scoringMode: mode });
    // When switching to scratch, reset all fleet scoring systems to scratch
    if (mode === 'scratch') {
      const fleets = await fleetRepo.listBySeries(seriesId);
      for (const f of fleets) {
        if (f.scoringSystem !== 'scratch') {
          await fleetRepo.save({ ...f, scoringSystem: 'scratch' });
        }
      }
    }
    await seriesRepo.touch(seriesId);
  }

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <h2 className="text-sm font-medium">Scoring mode</h2>
      <div className="space-y-2">
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="scoringMode"
            value="scratch"
            checked={series.scoringMode === 'scratch'}
            onChange={() => handleChange('scratch')}
            disabled={locked}
            className="mt-0.5"
          />
          <div>
            <span className="text-sm font-medium">Scratch (position-based)</span>
            <p className="text-xs text-muted-foreground">Boats are ranked by the order they cross the finish line. No finish times needed.</p>
          </div>
        </label>
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="radio"
            name="scoringMode"
            value="handicap"
            checked={series.scoringMode === 'handicap'}
            onChange={() => handleChange('handicap')}
            disabled={locked}
            className="mt-0.5"
          />
          <div>
            <span className="text-sm font-medium">Handicap (time-corrected)</span>
            <p className="text-xs text-muted-foreground">Some or all fleets use IRC, PY, or other time-based scoring. Finish times are recorded for handicap fleets.</p>
          </div>
        </label>
      </div>
      {locked && (
        <p className="text-xs text-muted-foreground">{lockReason}</p>
      )}
    </div>
  );
}

function StartSequenceEditor({ seriesId, series, fleets }: { seriesId: string; series: Series; fleets: Fleet[] }) {
  const [groups, setGroups] = useState<StartGroup[]>(series.defaultStartSequence ?? []);
  const [dirty, setDirty] = useState(false);

  // Sync from series when it changes externally
  useEffect(() => {
    setGroups(series.defaultStartSequence ?? []);
    setDirty(false);
  }, [series.defaultStartSequence]);

  const assignedFleetIds = new Set(groups.flatMap((g) => g.fleetIds));
  const unassignedFleets = fleets.filter((f) => !assignedFleetIds.has(f.id));

  function addGroup() {
    // Default offset: 3 minutes after the last group, or 0 for the first
    const offset = groups.length === 0 ? 0 : (groups[groups.length - 1].offsetMinutes + 3);
    setGroups([...groups, { fleetIds: [], offsetMinutes: offset }]);
    setDirty(true);
  }

  function removeGroup(index: number) {
    setGroups(groups.filter((_, i) => i !== index));
    setDirty(true);
  }

  function addFleetToGroup(groupIndex: number, fleetId: string) {
    setGroups(groups.map((g, i) => i === groupIndex ? { ...g, fleetIds: [...g.fleetIds, fleetId] } : g));
    setDirty(true);
  }

  function removeFleetFromGroup(groupIndex: number, fleetId: string) {
    setGroups(groups.map((g, i) => i === groupIndex ? { ...g, fleetIds: g.fleetIds.filter((id) => id !== fleetId) } : g));
    setDirty(true);
  }

  function setOffset(groupIndex: number, minutes: number) {
    setGroups(groups.map((g, i) => i === groupIndex ? { ...g, offsetMinutes: minutes } : g));
    setDirty(true);
  }

  async function save() {
    // Filter out empty groups
    const nonEmpty = groups.filter((g) => g.fleetIds.length > 0);
    await db.series.update(seriesId, { defaultStartSequence: nonEmpty.length > 0 ? nonEmpty : undefined });
    await seriesRepo.touch(seriesId);
    setDirty(false);
  }

  const fleetNameById = new Map(fleets.map((f) => [f.id, f.name]));

  return (
    <div className="border-t pt-3 mt-3 space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Default start sequence</h3>
      <p className="text-xs text-muted-foreground">
        Defines how fleets are grouped at the start line and the time between starts. Used as the default when creating new races.
      </p>
      {groups.map((group, i) => (
        <div key={i} className="flex items-center gap-2 text-sm border rounded-md px-3 py-2">
          <span className="text-xs text-muted-foreground w-14 shrink-0">Start {i + 1}</span>
          <div className="flex flex-wrap gap-1 flex-1">
            {group.fleetIds.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 bg-muted px-2 py-0.5 rounded text-xs">
                {fleetNameById.get(id) ?? id}
                <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => removeFleetFromGroup(i, id)}>×</button>
              </span>
            ))}
            {unassignedFleets.length > 0 && (
              <Select onValueChange={(v) => addFleetToGroup(i, v)}>
                <SelectTrigger className="h-6 w-24 text-xs border-dashed">
                  <SelectValue placeholder="+ fleet" />
                </SelectTrigger>
                <SelectContent>
                  {unassignedFleets.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          {i > 0 && (
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs text-muted-foreground">+</span>
              <Input
                type="number"
                min={1}
                max={30}
                value={group.offsetMinutes}
                onChange={(e) => setOffset(i, parseInt(e.target.value, 10) || 0)}
                className="w-14 h-6 text-xs text-center"
              />
              <span className="text-xs text-muted-foreground">min</span>
            </div>
          )}
          <Button type="button" variant="ghost" size="sm" className="h-6 px-1 text-muted-foreground" onClick={() => removeGroup(i)}>×</Button>
        </div>
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="outline" size="sm" className="text-xs" onClick={addGroup}>
          + Add start group
        </Button>
        {dirty && (
          <Button type="button" size="sm" className="text-xs" onClick={save}>
            Save sequence
          </Button>
        )}
      </div>
      {unassignedFleets.length > 0 && groups.length > 0 && (
        <p className="text-xs text-amber-600">
          {unassignedFleets.length} fleet{unassignedFleets.length === 1 ? '' : 's'} not assigned to a start group: {unassignedFleets.map((f) => f.name).join(', ')}
        </p>
      )}
    </div>
  );
}

function FleetsCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const fleets = useLiveQuery(() => fleetRepo.listBySeries(seriesId), [seriesId]) ?? [];
  const [expanded, setExpanded] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState('');
  const [addingFleet, setAddingFleet] = useState(false);
  const [newFleetName, setNewFleetName] = useState('');
  const [newFleetError, setNewFleetError] = useState('');
  // Inline error message for a blocked Scratch → Handicap change (missing finish times).
  const [scoringSystemError, setScoringSystemError] = useState<{ fleetId: string; message: string } | null>(null);
  // Pending Handicap → Scratch confirmation (non-blocking warning).
  const [confirmToScratch, setConfirmToScratch] = useState<{ fleet: Fleet } | null>(null);
  // Pending fleet deletion confirmation.
  const [confirmDeleteFleet, setConfirmDeleteFleet] = useState<Fleet | null>(null);

  // A single Default fleet means fleets are invisible to the user.
  const isOnlyDefault = fleets.length === 1 && fleets[0].name === 'Default';

  async function moveFleet(index: number, direction: -1 | 1) {
    const sorted = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= sorted.length) return;
    const a = sorted[index];
    const b = sorted[swapIndex];
    await fleetRepo.save({ ...a, displayOrder: b.displayOrder });
    await fleetRepo.save({ ...b, displayOrder: a.displayOrder });
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
      await fleetRepo.save({ ...fleet, name: newName });
    }
    setRenamingId(null);
    setRenameError('');
  }

  async function changeScoringSystem(fleet: Fleet, system: Fleet['scoringSystem']) {
    setScoringSystemError(null);
    const wasScratch = fleet.scoringSystem === 'scratch';
    const willBeScratch = system === 'scratch';
    if (wasScratch === willBeScratch) {
      // No category change (e.g. IRC → PY or scratch → scratch). Apply directly.
      await fleetRepo.save({ ...fleet, scoringSystem: system });
      return;
    }

    // Scratch → Handicap: block if any finish for this fleet lacks a finishTime.
    if (wasScratch && !willBeScratch) {
      const competitorsInFleet = await competitorRepo.listBySeries(seriesId);
      const fleetCompetitorIds = new Set(
        competitorsInFleet.filter((c) => c.fleetIds.includes(fleet.id)).map((c) => c.id),
      );
      if (fleetCompetitorIds.size === 0) {
        await fleetRepo.save({ ...fleet, scoringSystem: system });
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
      // All finishers have times — proceed.
      await fleetRepo.save({ ...fleet, scoringSystem: system });
      return;
    }

    // Handicap → Scratch: warn (non-blocking), stored times are preserved but unused.
    setConfirmToScratch({ fleet: { ...fleet, scoringSystem: system } });
  }

  async function confirmSwitchToScratch() {
    if (!confirmToScratch) return;
    await fleetRepo.save(confirmToScratch.fleet);
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
    await fleetRepo.save({
      id: crypto.randomUUID(),
      seriesId,
      name,
      displayOrder: maxOrder + 1,
      scoringSystem: 'scratch',
    });
    await seriesRepo.touch(seriesId);
    setNewFleetName('');
    setNewFleetError('');
    setAddingFleet(false);
  }

  async function handleDeleteFleet(fleet: Fleet) {
    const competitorsInFleet = await competitorRepo.listBySeries(seriesId);
    const count = competitorsInFleet.filter((c) => c.fleetIds.includes(fleet.id)).length;
    if (count > 0) {
      // Move competitors out of this fleet before deleting
      for (const c of competitorsInFleet) {
        if (c.fleetIds.includes(fleet.id)) {
          const remaining = c.fleetIds.filter((id) => id !== fleet.id);
          await competitorRepo.save({ ...c, fleetIds: remaining.length > 0 ? remaining : c.fleetIds });
        }
      }
    }
    await fleetRepo.delete(fleet.id);
    await seriesRepo.touch(seriesId);
    setConfirmDeleteFleet(null);
  }

  const sorted = [...fleets].sort((a, b) => a.displayOrder - b.displayOrder);

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
            : sorted.map((f) => f.scoringSystem !== 'scratch' ? `${f.name} (${f.scoringSystem.toUpperCase()})` : f.name).join(' · ')}
        </p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Add and configure fleets for your series. Set each fleet&apos;s scoring system here.
          </p>
          <div className="space-y-1">
            {sorted.map((fleet, i) => (
              <div key={fleet.id} className="flex-col items-start gap-1">
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
                    </SelectContent>
                  </Select>
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
            <StartSequenceEditor seriesId={seriesId} series={series} fleets={sorted} />
          )}
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
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
    </div>
  );
}

function ScoringCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const [expanded, setExpanded] = useState(false);
  const [thresholds, setThresholds] = useState<DiscardThreshold[]>(series.discardThresholds ?? []);
  const [dnfScoring, setDnfScoring] = useState<Series['dnfScoring']>(series.dnfScoring ?? 'seriesEntries');
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    setThresholds(series.discardThresholds ?? []);
    setDnfScoring(series.dnfScoring ?? 'seriesEntries');
    setChanged(false);
  }, [series.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    await db.series.update(seriesId, {
      discardThresholds: thresholds,
      dnfScoring,
      lastModifiedAt: Date.now(),
    });
    setChanged(false);
    setExpanded(false);
  }

  function updateThreshold(index: number, field: keyof DiscardThreshold, value: number) {
    setThresholds((prev) => {
      const next = prev.map((t, i) => i === index ? { ...t, [field]: value } : t);
      setScoringChanged();
      return next;
    });
  }

  function setScoringChanged() { setChanged(true); }

  function addThreshold() {
    setThresholds((prev) => {
      const maxMinRaces = prev.reduce((m, t) => Math.max(m, t.minRaces), 0);
      const maxDiscardCount = prev.reduce((m, t) => Math.max(m, t.discardCount), 0);
      setChanged(true);
      return [...prev, { minRaces: maxMinRaces + 1, discardCount: maxDiscardCount + 1 }];
    });
  }

  function removeThreshold(index: number) {
    setThresholds((prev) => {
      setChanged(true);
      return prev.filter((_, i) => i !== index);
    });
  }

  const ruleCount = (series.discardThresholds ?? []).length;
  const dnfLabel = (series.dnfScoring ?? 'seriesEntries') === 'startingArea'
    ? 'DNF: starting area'
    : 'DNF: series entries';
  const summary = ruleCount === 0
    ? `No discards · ${dnfLabel}`
    : `${ruleCount} discard rule${ruleCount !== 1 ? 's' : ''} · ${dnfLabel}`;

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Scoring</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <form onSubmit={handleSave} className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Discard rules — drop each competitor&apos;s worst race(s) from the series total.
            Each rule sets the <em>total</em> number of discards once that many races have been sailed.
          </p>
          {thresholds.length === 0 ? (
            <p className="text-sm text-muted-foreground">No discards configured.</p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_auto] gap-2 text-xs text-muted-foreground px-1">
                <span>From (races)</span>
                <span>Total discards</span>
                <span />
              </div>
              {[...thresholds]
                .sort((a, b) => a.minRaces - b.minRaces)
                .map((t, i, sorted) => {
                  const origIndex = thresholds.indexOf(t);
                  const minDiscard = i === 0 ? 1 : sorted[i - 1].discardCount + 1;
                  return (
                    <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2 items-center">
                      <Input
                        type="number"
                        min={1}
                        value={t.minRaces}
                        onChange={(e) => updateThreshold(origIndex, 'minRaces', Math.max(1, parseInt(e.target.value) || 1))}
                        className="h-8 text-sm"
                      />
                      <Input
                        type="number"
                        min={minDiscard}
                        max={t.minRaces - 1}
                        value={t.discardCount}
                        onChange={(e) => updateThreshold(origIndex, 'discardCount', Math.max(minDiscard, parseInt(e.target.value) || minDiscard))}
                        className="h-8 text-sm"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 px-2 text-muted-foreground"
                        onClick={() => removeThreshold(origIndex)}
                      >
                        ×
                      </Button>
                    </div>
                  );
                })}
            </div>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" size="sm" onClick={addThreshold}>
              Add rule
            </Button>
          </div>
          <div className="flex items-start gap-2.5 pt-1">
            <input
              id="dnfScoring"
              type="checkbox"
              checked={dnfScoring === 'startingArea'}
              onChange={(e) => {
                setDnfScoring(e.target.checked ? 'startingArea' : 'seriesEntries');
                setChanged(true);
              }}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <label htmlFor="dnfScoring" className="text-sm font-medium cursor-pointer">
                Score DNF/OCS on starting-area entries (RRS A5.3)
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                By default, DNF and OCS score series entries + 1 (A5.2). Enable this to use
                the number of boats that came to the starting area in each race instead.
                DNC always scores series entries + 1. Use the Start check-in on each race
                to record who was present.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="outline" size="sm" disabled={!changed}>
              {changed ? 'Save' : 'Saved'}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setExpanded(false)}>
              Done
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

function CompetitorFieldsCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const [expanded, setExpanded] = useState(false);
  // Mirror the persisted array into local state so the checkbox updates
  // instantly on click — the async db.update that follows would otherwise
  // leave the controlled <input> at the old value until useLiveQuery reruns.
  const persisted = series.enabledCompetitorFields ?? defaultEnabledCompetitorFields();
  const [localEnabled, setLocalEnabled] = useState<CompetitorFieldKey[]>(persisted);
  useEffect(() => {
    setLocalEnabled(persisted);
  }, [persisted.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const enabledSet = new Set<CompetitorFieldKey>(localEnabled);

  async function toggle(field: CompetitorFieldKey, checked: boolean) {
    const next = new Set(enabledSet);
    if (checked) next.add(field); else next.delete(field);
    const nextArray = ALL_COMPETITOR_FIELDS.filter((f) => next.has(f));
    setLocalEnabled(nextArray);
    await db.series.update(seriesId, {
      enabledCompetitorFields: nextArray,
      lastModifiedAt: Date.now(),
    });
  }

  const shownLabels = ALL_COMPETITOR_FIELDS
    .filter((f) => enabledSet.has(f))
    .map((f) => COMPETITOR_FIELD_LABELS[f]);
  const summary = shownLabels.length === 0
    ? 'Only sail number and helm name'
    : `Sail, Helm, ${shownLabels.join(', ')}`;

  const fieldHints: Partial<Record<CompetitorFieldKey, string>> = {
    crewName: 'Enable for two-person classes (420, Fireball, GP14).',
  };

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Competitor fields</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Sail number and helm name are always shown. Toggle the optional fields you want
            displayed in the competitor list, standings, and exported results.
          </p>
          <div className="space-y-2">
            {ALL_COMPETITOR_FIELDS.map((field) => (
              <div key={field} className="flex items-start gap-2.5">
                <input
                  id={`field-${field}`}
                  type="checkbox"
                  checked={enabledSet.has(field)}
                  onChange={(e) => toggle(field, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <div>
                  <label htmlFor={`field-${field}`} className="text-sm font-medium cursor-pointer">
                    {COMPETITOR_FIELD_LABELS[field]}
                  </label>
                  {fieldHints[field] && (
                    <p className="text-xs text-muted-foreground mt-0.5">{fieldHints[field]}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

function PublishingCard({ seriesId, series }: { seriesId: string; series: Series }) {
  const [expanded, setExpanded] = useState(false);

  const includeJson = series.includeJsonExport ?? true;
  const summary = includeJson ? 'JSON export included in results' : 'JSON export excluded from results';

  return (
    <div className="border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Publishing</h2>
        {!expanded && (
          <Button variant="ghost" size="sm" onClick={() => setExpanded(true)}>
            Edit ▸
          </Button>
        )}
      </div>
      {!expanded ? (
        <p className="text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start gap-2.5">
            <input
              id="includeJsonExport"
              type="checkbox"
              checked={includeJson}
              onChange={(e) => {
                db.series.update(seriesId, { includeJsonExport: e.target.checked });
              }}
              className="mt-0.5 h-4 w-4 shrink-0"
            />
            <div>
              <label htmlFor="includeJsonExport" className="text-sm font-medium cursor-pointer">
                Include data export in published results
              </label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Embeds a JSON snapshot of the results in every exported HTML file, with a
                &ldquo;Download results (JSON)&rdquo; link in the footer. Disable if you prefer
                to share results without the underlying data.
              </p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => setExpanded(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}

type UpdateFlow =
  | { step: 'idle' }
  | { step: 'confirm'; file: SeriesFile; status: LineageStatus }
  | { step: 'working' }
  | { step: 'error'; message: string };

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `today at ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `yesterday at ${time}`;
  return d.toLocaleDateString();
}

export default function SettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const router = useRouter();
  const series = useLiveQuery(async () => (await seriesRepo.get(seriesId)) ?? null, [seriesId]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [updateFlow, setUpdateFlow] = useState<UpdateFlow>({ step: 'idle' });

  if (series === undefined) return <p className="text-muted-foreground">Loading…</p>;
  if (series === null) return <p className="text-muted-foreground">Series not found.</p>;

  const hasFileHistory = series.lastSnapshotId !== null;
  const isModified =
    series.lastSavedAt !== null && series.lastModifiedAt > series.lastSavedAt;

  async function handleSaveToFile() {
    setSaving(true);
    try {
      await saveSeriesFile(seriesId);
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  }

  function handleUpdateFromFile() {
    fileInputRef.current?.click();
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    try {
      const content = await file.text();
      const parsed = parseSeriesFile(content);

      if (parsed.seriesId !== series!.id) {
        setUpdateFlow({
          step: 'error',
          message:
            'This file is for a different series. Use "Open Series" on the home screen to open it as a new series.',
        });
        return;
      }

      const status = checkLineage(series!, parsed);
      setUpdateFlow({ step: 'confirm', file: parsed, status });
    } catch (err) {
      setUpdateFlow({
        step: 'error',
        message: err instanceof Error ? err.message : 'Could not read file.',
      });
    }
  }

  async function handleConfirmUpdate(asNewCopy: boolean) {
    if (updateFlow.step !== 'confirm') return;
    const { file } = updateFlow;
    setUpdateFlow({ step: 'working' });
    try {
      if (asNewCopy) {
        const newId = await openSeriesFromFile(file);
        router.push(`/series/${newId}/races`);
      } else {
        await updateSeriesFromFile(seriesId, file);
        router.push(`/series/${seriesId}/races`);
      }
    } catch (err) {
      console.error(err);
      setUpdateFlow({ step: 'error', message: 'Failed to update series. Please try again.' });
    }
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* File card */}
      <div className={`border rounded-lg p-5 space-y-4 ${!hasFileHistory ? 'opacity-70' : ''}`}>
        <div>
          <h2 className="text-sm font-medium">File</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {series.lastSavedAt
              ? <>Last saved: {formatTimestamp(series.lastSavedAt)}{isModified && <span className="ml-2 text-amber-600 dark:text-amber-400">· modified since last save</span>}</>
              : hasFileHistory
              ? 'Opened from file — not yet saved from this device'
              : 'Not saved to file'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSaveToFile} disabled={saving} variant="outline">
            {saving ? 'Saving…' : 'Save to File'}
          </Button>
          {hasFileHistory && (
            <Button onClick={handleUpdateFromFile} variant="outline">
              Update from File
            </Button>
          )}
        </div>
        {!hasFileHistory && (
          <p className="text-xs text-muted-foreground">
            Save to a file to share this series with co-scorers or back it up.
          </p>
        )}
      </div>

      <BasicsCard seriesId={seriesId} series={series} />
      <ScoringModeCard seriesId={seriesId} series={series} />
      <FleetsCard seriesId={seriesId} series={series} />
      <ScoringCard seriesId={seriesId} series={series} />
      <CompetitorFieldsCard seriesId={seriesId} series={series} />
      <PublishingCard seriesId={seriesId} series={series} />

      <input
        ref={fileInputRef}
        type="file"
        accept=".sailscoring,application/json"
        className="hidden"
        onChange={handleFileSelected}
      />

      {/* Identical snapshot */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'identical'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nothing to update</DialogTitle>
            <DialogDescription>
              This file matches your local copy. No changes were made.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUpdateFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clean update */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'clean'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Update &ldquo;{series.name}&rdquo;?</DialogTitle>
            <DialogDescription>
              This file is a newer version of your local copy.{' '}
              {updateFlow.step === 'confirm' &&
                `Saved on ${new Date(updateFlow.file.exportedAt).toLocaleString()}.`}
              {' '}Your local copy will be replaced. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button onClick={() => handleConfirmUpdate(false)}>Update</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Diverged */}
      <Dialog
        open={updateFlow.step === 'confirm' && updateFlow.status === 'diverged'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>⚠ This file conflicts with your local copy</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2">
                <p>
                  This file and your local copy appear to have diverged — both have changes
                  the other doesn&apos;t.
                </p>
                {updateFlow.step === 'confirm' && (
                  <div className="text-sm">
                    <p>This file: saved {new Date(updateFlow.file.exportedAt).toLocaleString()}</p>
                    <p>Local copy: last modified {formatTimestamp(series.lastModifiedAt)}</p>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUpdateFlow({ step: 'idle' })}>
              Cancel
            </Button>
            <Button variant="outline" onClick={() => handleConfirmUpdate(true)}>
              Open as a new copy
            </Button>
            <Button variant="destructive" onClick={() => handleConfirmUpdate(false)}>
              Replace local copy
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error */}
      <Dialog
        open={updateFlow.step === 'error'}
        onOpenChange={(open) => { if (!open) setUpdateFlow({ step: 'idle' }); }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Could not open file</DialogTitle>
            <DialogDescription>
              {updateFlow.step === 'error' ? updateFlow.message : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setUpdateFlow({ step: 'idle' })}>OK</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
