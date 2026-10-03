'use client';

import { useQueryClient } from '@tanstack/react-query';

import { log } from '@/lib/debug';
import { finishRowsFromImport } from '@/lib/finish-entry';
import type { PlannedRace } from '@/lib/racesense-plan';
import type { Finish, Race, RaceSenseLink } from '@/lib/types';

import { queryKeys } from './query-keys';
import { useDeleteFinish, useSaveFinishes } from './use-finishes';
import { useSaveRace } from './use-races';

export interface UseRaceSenseImportArgs {
  seriesId: string;
  /** Every race in the series, for the links each one carries. */
  races: Race[] | undefined;
  /** Every finish in the series, for the rows a race already holds. */
  finishes: Finish[] | undefined;
}

/**
 * Commit the races a scorer ticked in a RaceSense import.
 *
 * Race by race, the same replace-all the per-race CSV import performs: the
 * race's existing finishes go, the imported ones land. Doing it a race at a
 * time rather than in one transaction is deliberate — if a later race fails,
 * the earlier ones are in and the scorer re-uploads the same workbook, which
 * now reads them back as `unchanged`. That is the property that makes the
 * whole flow safe to repeat.
 *
 * Each race then records which RaceSense race it now holds, after its
 * finishes, so a race whose finishes failed to land isn't remembered as
 * imported. A failure there costs only the match, which the next import
 * makes again by position.
 */
export function useRaceSenseImport({ seriesId, races, finishes }: UseRaceSenseImportArgs) {
  const qc = useQueryClient();
  const saveFinishes = useSaveFinishes();
  const deleteFinish = useDeleteFinish();
  const saveRace = useSaveRace();

  return async function applyRaceSenseImport(
    planned: PlannedRace[],
    links: Map<string, RaceSenseLink[]>,
  ): Promise<void> {
    const existingByRace = new Map<string, Finish[]>();
    for (const f of finishes ?? []) {
      existingByRace.set(f.raceId, [...(existingByRace.get(f.raceId) ?? []), f]);
    }

    for (const race of planned) {
      if (!race.race || !race.result) continue;
      const raceId = race.race.id;
      const rows = finishRowsFromImport(raceId, race.result.finishes);

      await Promise.all(
        (existingByRace.get(raceId) ?? []).map((f) =>
          deleteFinish.mutateAsync({ id: f.id, raceId }),
        ),
      );
      await saveFinishes.mutateAsync(rows);
      log('result-entry', 'racesense import applied', {
        sheet: race.sheetName,
        raceId,
        finishers: race.result.summary.finishers,
        coded: race.result.summary.coded,
      });
    }

    const raceById = new Map((races ?? []).map((r) => [r.id, r]));
    for (const [raceId, raceSenseLinks] of links) {
      const race = raceById.get(raceId);
      if (!race) continue;
      await saveRace.mutateAsync({ ...race, raceSenseLinks });
    }

    await qc.invalidateQueries({ queryKey: queryKeys.finishes.bySeries(seriesId) });
  };
}
