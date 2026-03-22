'use client';

import { use } from 'react';
import Link from 'next/link';
import { useLiveQuery } from 'dexie-react-hooks';
import { raceRepo } from '@/lib/dexie-repository';
import { Button } from '@/components/ui/button';
import type { Race } from '@/lib/types';
import { log } from '@/lib/debug';

function RaceRow({ race, seriesId }: { race: Race; seriesId: string }) {
  return (
    <div className="flex items-center justify-between border rounded-lg px-5 py-4">
      <div>
        <span className="font-medium">Race {race.raceNumber}</span>
        {race.date && (
          <span className="text-sm text-muted-foreground ml-2">{race.date}</span>
        )}
      </div>
      <Button variant="outline" size="sm" asChild>
        <Link href={`/series/${seriesId}/races/${race.id}`}>Enter results</Link>
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
