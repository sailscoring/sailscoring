/**
 * The public API's authenticated resources, built from the internal model
 * (ADR-016 §2). The only place the two meet: a change to the model that
 * touches none of the fields here doesn't change the API. Pure.
 */
import { legDistance } from '@/lib/course-geometry';
import type { Competitor, Finish, Fleet, Race, RaceStart, Series } from '@/lib/types';
import type {
  CompetitorResource,
  CourseResource,
  FinishResource,
  FleetResource,
  RaceResource,
  SeriesResource,
  StartResource,
} from '@/lib/validation/public-api-v1-authenticated';

const orNull = (v: string | undefined | null): string | null => (v ? v : null);

export function seriesResourceOf(s: Series): SeriesResource {
  return {
    id: s.id,
    name: s.name,
    venue: orNull(s.venue),
    startDate: orNull(s.startDate),
    endDate: orNull(s.endDate),
    archived: s.archived === true,
    asPublished: s.asPublished === true,
  };
}

export function fleetResourceOf(f: Fleet): FleetResource {
  return { id: f.id, name: f.name, scoringSystem: f.scoringSystem };
}

export function competitorResourceOf(c: Competitor): CompetitorResource {
  return {
    id: c.id,
    fleetIds: c.fleetIds,
    sailNumber: c.sailNumber,
    bowNumber: orNull(c.bowNumber),
    alternativeSailNumbers: c.alternativeSailNumbers ?? [],
    boatName: orNull(c.boatName),
    boatClass: orNull(c.boatClass),
    names: c.names,
    helms: c.helms ?? [],
    owners: c.owners ?? [],
    crew: c.crewNames ?? [],
    clubs: c.clubs,
    nationality: orNull(c.nationality),
    excluded: c.excluded === true,
  };
}

export function courseResourceOf(start: RaceStart): CourseResource | null {
  const legs = start.courseLegs ?? [];
  if (legs.length === 0) return null;
  const sum = legDistance(legs.reduce((total, l) => total + l.distanceNm, 0));
  return {
    name: start.course?.name ?? null,
    north: start.course?.north === 'magnetic' ? 'magnetic' : 'true',
    distanceNm: start.distanceNm ?? sum,
    legs: legs.map((l) => ({
      name: l.name ?? null,
      distanceNm: l.distanceNm,
      bearingDeg: l.bearingDeg,
      windDirectionDeg: l.windDirectionDeg,
      windSpeedKts: l.windSpeedKts ?? null,
    })),
  };
}

export function startResourceOf(s: RaceStart): StartResource {
  return {
    id: s.id,
    fleetIds: s.fleetIds,
    startTime: s.startTime ? s.startTime : null,
    course: courseResourceOf(s),
  };
}

/** Starts in gun order; those with no gun after, as they were added. */
function byGun(a: RaceStart, b: RaceStart): number {
  if (a.startTime && b.startTime) return a.startTime.localeCompare(b.startTime);
  if (a.startTime) return -1;
  if (b.startTime) return 1;
  return 0;
}

export function raceResourceOf(r: Race, starts: readonly RaceStart[]): RaceResource {
  return {
    id: r.id,
    number: r.raceNumber,
    name: r.name ? r.name : null,
    date: orNull(r.date),
    starts: starts.filter((s) => s.raceId === r.id).sort(byGun).map(startResourceOf),
  };
}

export function finishResourceOf(f: Finish): FinishResource {
  return {
    id: f.id,
    competitorId: f.competitorId,
    sailNumber: f.competitorId ? null : orNull(f.unknownSailNumber),
    position: f.sortOrder,
    tiedWithPrevious: f.tiedWithPrevious,
    finishTime: orNull(f.finishTime),
    elapsedSecs: f.elapsedSecs ?? null,
    laps: f.laps ?? null,
    resultCode: f.resultCode,
    penaltyCode: f.penaltyCode,
  };
}

/** Finishers in order, then the boats that didn't finish. */
export function finishesInOrder(finishes: readonly Finish[]): Finish[] {
  return [...finishes].sort((a, b) => {
    if (a.sortOrder !== null && b.sortOrder !== null) return a.sortOrder - b.sortOrder;
    if (a.sortOrder !== null) return -1;
    if (b.sortOrder !== null) return 1;
    return 0;
  });
}

/** A time as the public API takes it (`HH:MM` or `HH:MM:SS`), as stored. */
export function storedWallClock(time: string): string {
  return time.length === 5 ? `${time}:00` : time;
}
