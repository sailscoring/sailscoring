'use client';

import {
  DEFAULT_PRIMARY_PERSON_LABEL,
  defaultEnabledCompetitorFields,
} from '@/lib/competitor-fields';
import type {
  Competitor,
  CompetitorFieldKey,
  Finish,
  Fleet,
  PrimaryPersonLabel,
  Race,
  RaceStart,
  Series,
} from '@/lib/types';

import { useCompetitorsBySeries } from './use-competitors';
import { useFinishesBySeries } from './use-finishes';
import { useFleetsBySeries } from './use-fleets';
import { useRaceStartsBySeries } from './use-race-starts';
import { useRacesBySeries } from './use-races';
import { useSeries } from './use-series';

export type SeriesData =
  | { status: 'loading' }
  | { status: 'missing' }
  | {
      status: 'ready';
      series: Series;
      competitors: Competitor[];
      fleets: Fleet[];
      races: Race[];
      /** Present only when requested via `opts.finishes`. */
      finishes?: Finish[];
      /** Present only when requested via `opts.raceStarts`. */
      raceStarts?: RaceStart[];
      fleetById: Map<string, Fleet>;
      enabledFields: CompetitorFieldKey[];
      primaryLabel: PrimaryPersonLabel;
    };

/**
 * The series-tab data scaffold: the standard query fan-in every tab page
 * needs (series + competitors + fleets + races, optionally finishes and
 * race starts), folded into one discriminated status. A page renders its
 * fallback until every requested query has resolved, then gets the loaded
 * cluster plus the secondary values each page used to re-derive
 * (`fleetById`, the enabled-fields and primary-person-label defaults).
 */
export function useSeriesData(
  seriesId: string,
  opts?: { finishes?: boolean; raceStarts?: boolean },
): SeriesData {
  const wantFinishes = opts?.finishes ?? false;
  const wantRaceStarts = opts?.raceStarts ?? false;

  const { data: series } = useSeries(seriesId);
  const { data: competitors } = useCompetitorsBySeries(seriesId);
  const { data: fleets } = useFleetsBySeries(seriesId);
  const { data: races } = useRacesBySeries(seriesId);
  // Hooks must be called unconditionally; the optional cluster members are
  // gated with `enabled` instead, so an unrequested query costs nothing.
  const { data: finishes } = useFinishesBySeries(seriesId, { enabled: wantFinishes });
  const { data: raceStarts } = useRaceStartsBySeries(seriesId, { enabled: wantRaceStarts });

  if (
    series === undefined ||
    competitors === undefined ||
    fleets === undefined ||
    races === undefined ||
    (wantFinishes && finishes === undefined) ||
    (wantRaceStarts && raceStarts === undefined)
  ) {
    return { status: 'loading' };
  }
  if (series === null) {
    return { status: 'missing' };
  }

  return {
    status: 'ready',
    series,
    competitors,
    fleets,
    races,
    ...(wantFinishes ? { finishes } : {}),
    ...(wantRaceStarts ? { raceStarts } : {}),
    fleetById: new Map(fleets.map((f) => [f.id, f])),
    enabledFields: series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
    primaryLabel: series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
  };
}
