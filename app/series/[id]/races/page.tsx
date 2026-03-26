'use client';

import { use, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useLiveQuery } from 'dexie-react-hooks';
import { raceRepo, finishRepo, seriesRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import type { Race } from '@/lib/types';
import { log } from '@/lib/debug';
import { useGlobalKeyDown } from '@/hooks/use-keyboard-shortcut';

function RaceRow({ race, seriesId }: { race: Race; seriesId: string }) {
  const router = useRouter();
  const finishes = useLiveQuery(() => finishRepo.listByRace(race.id), [race.id]);
  const finisherCount = finishes?.filter((f) => f.finishPosition !== null).length;

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

export default function RacesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: seriesId } = use(params);
  const races = useLiveQuery(() => raceRepo.listBySeries(seriesId), [seriesId]);
  const raceListRef = useRef<HTMLDivElement>(null);
  const didAutoFocus = useRef(false);

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
      handleAddRace();
    }
  });

  async function handleAddRace() {
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {races === undefined
            ? 'Loading…'
            : `${races.length} race${races.length === 1 ? '' : 's'}`}
        </p>
        <Button onClick={handleAddRace}>Add race</Button>
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
    </div>
  );
}
