'use client';

import { use } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { raceRepo, finishRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import type { Race } from '@/lib/types';
import { log } from '@/lib/debug';

async function handleDeleteRace(race: Race) {
  if (!confirm(`Delete Race ${race.raceNumber}? This will also delete all results for this race.`)) return;
  await finishRepo.deleteByRace(race.id);
  await raceRepo.delete(race.id);
}

function RaceRow({ race, seriesId }: { race: Race; seriesId: string }) {
  const finishes = useLiveQuery(() => finishRepo.listByRace(race.id), [race.id]);
  const finisherCount = finishes?.filter((f) => f.finishPosition !== null).length;

  return (
    <div className="flex items-center justify-between border rounded-lg px-5 py-4">
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
      <div className="flex gap-2">
        <Button variant="outline" size="sm" asChild>
          <Link href={`/series/${seriesId}/races/${race.id}`}>Enter results</Link>
        </Button>
        <Button variant="outline" size="sm" onClick={() => handleDeleteRace(race)}>
          Delete
        </Button>
      </div>
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
        <div className="space-y-2">
          {races.map((race) => (
            <RaceRow key={race.id} race={race} seriesId={seriesId} />
          ))}
        </div>
      )}
    </div>
  );
}
