'use client';

import { use, useRef, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { raceRepo, finishRepo, seriesRepo, fleetRepo, raceStartRepo } from '@/lib/dexie-repository';
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
import { Trash2 } from 'lucide-react';
import type { Race } from '@/lib/types';
import { log } from '@/lib/debug';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';
import { generateStarts } from '@/lib/start-sequence';

function RaceRow({ race, seriesId }: { race: Race; seriesId: string }) {
  const router = useRouter();
  const finishes = useLiveQuery(() => finishRepo.listByRace(race.id), [race.id]);
  const finisherCount = finishes?.filter((f) => f.sortOrder !== null).length;

  async function handleDelete() {
    if (!confirm(`Delete Race ${race.raceNumber}? This will also delete all results for this race.`)) return;
    await finishRepo.deleteByRace(race.id);
    await raceRepo.delete(race.id);
    await seriesRepo.touch(seriesId);
  }

  return (
    <div
      className="flex items-center justify-between border rounded-lg px-5 py-4 cursor-pointer hover:bg-muted/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      tabIndex={0}
      onClick={() => router.push(`/series/${seriesId}/races/${race.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          router.push(`/series/${seriesId}/races/${race.id}`);
        } else if (e.key === 'd' || e.key === 'Delete') {
          e.preventDefault();
          handleDelete();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          (e.currentTarget.nextElementSibling as HTMLElement)?.focus();
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          (e.currentTarget.previousElementSibling as HTMLElement)?.focus();
        }
      }}
    >
      <div>
        <span className="font-medium">Race {race.raceNumber}</span>
        {race.date && (
          <span className="text-sm text-muted-foreground ml-2">{race.date}</span>
        )}
        {finisherCount !== undefined && (
          <span className="text-sm text-muted-foreground ml-2">
            {finisherCount} {finisherCount === 1 ? 'finisher' : 'finishers'}
          </span>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete Race ${race.raceNumber}`}
        onClick={(e) => { e.stopPropagation(); handleDelete(); }}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
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
  const races = useLiveQuery(() => raceRepo.listBySeries(seriesId), [seriesId]);
  const series = useLiveQuery(() => seriesRepo.get(seriesId), [seriesId]);
  const fleets = useLiveQuery(() => fleetRepo.listBySeries(seriesId), [seriesId]);
  const raceListRef = useRef<HTMLDivElement>(null);
  const didAutoFocus = useRef(false);

  // Handicap race creation dialog state
  const [showNewRaceDialog, setShowNewRaceDialog] = useState(false);
  const [firstStartTime, setFirstStartTime] = useState('');
  const [newRaceError, setNewRaceError] = useState('');

  const isHandicap = series?.scoringMode === 'handicap';
  const startSequence = series?.defaultStartSequence;
  const hasStartSequence = startSequence && startSequence.length > 0;

  // Preview of starts based on the entered first start time
  const previewStarts = (firstStartTime && hasStartSequence)
    ? (() => {
        const normalized = normalizeTimeInput(firstStartTime);
        if (!normalized) return null;
        return generateStarts(startSequence!, normalized);
      })()
    : null;

  const fleetNameById = new Map((fleets ?? []).map((f) => [f.id, f.name]));

  // Auto-focus first row when list first loads
  useEffect(() => {
    if (didAutoFocus.current || !races?.length) return;
    didAutoFocus.current = true;
    (raceListRef.current?.querySelector<HTMLElement>('[tabindex="0"]'))?.focus();
  }, [races]);

  useGlobalKeyDown((e) => {
    if (e.key === 'n' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(
      (document.activeElement?.tagName ?? '')
    )) {
      e.preventDefault();
      if (isHandicap && hasStartSequence) {
        setFirstStartTime('');
        setNewRaceError('');
        setShowNewRaceDialog(true);
      } else {
        handleAddRaceScratch();
      }
    }
  });

  async function handleAddRaceScratch() {
    const existingRaces = await raceRepo.listBySeries(seriesId);
    const nextNumber = existingRaces.length + 1;
    const race: Race = {
      id: crypto.randomUUID(),
      seriesId,
      raceNumber: nextNumber,
      date: new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
    };
    log('races', 'adding', race);
    await raceRepo.save(race);
    await seriesRepo.touch(seriesId);
  }

  async function handleAddRaceHandicap() {
    const normalized = normalizeTimeInput(firstStartTime);
    if (!normalized) {
      setNewRaceError('Enter a valid time, e.g. 14:05:00 or 140500.');
      return;
    }
    if (!hasStartSequence) {
      setNewRaceError('No default start sequence configured. Set one in Settings > Fleets.');
      return;
    }

    const existingRaces = await raceRepo.listBySeries(seriesId);
    const nextNumber = existingRaces.length + 1;
    const race: Race = {
      id: crypto.randomUUID(),
      seriesId,
      raceNumber: nextNumber,
      date: new Date().toISOString().slice(0, 10),
      createdAt: Date.now(),
    };
    log('races', 'adding with starts', race);
    await raceRepo.save(race);

    // Create RaceStart records from the start sequence
    const starts = generateStarts(startSequence!, normalized);
    for (const start of starts) {
      await raceStartRepo.save({
        id: crypto.randomUUID(),
        raceId: race.id,
        fleetIds: start.fleetIds,
        startTime: start.startTime,
      });
    }

    await seriesRepo.touch(seriesId);
    setShowNewRaceDialog(false);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {races === undefined
            ? 'Loading…'
            : `${races.length} race${races.length === 1 ? '' : 's'}`}
        </p>
        <Button onClick={handleAddRaceClick}>Add race</Button>
      </div>

      {races !== undefined && races.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No races yet. Add the first race above.
        </p>
      )}

      {races !== undefined && races.length > 0 && (
        <div className="space-y-2" ref={raceListRef}>
          {races.map((race) => (
            <RaceRow key={race.id} race={race} seriesId={seriesId} />
          ))}
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
                      <span className="text-xs text-muted-foreground ml-1">(+{startSequence[i].offsetMinutes} min)</span>
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
    </div>
  );
}
