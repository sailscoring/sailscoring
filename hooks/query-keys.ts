/**
 * TanStack Query key factory. Each entry returns a `readonly` tuple so
 * `useQuery({ queryKey })` and `invalidateQueries({ queryKey })` agree
 * structurally without runtime overhead.
 *
 * Convention: top-level key per resource, then a subkey describing the
 * shape of the data (`list`, `bySeries`, `detail`, etc.). Mutations
 * invalidate at the resource level by default — fine-grained
 * invalidation is added per-hook only where it actually matters.
 */

export const queryKeys = {
  series: {
    all: ['series'] as const,
    list: () => ['series', 'list'] as const,
    detail: (id: string) => ['series', 'detail', id] as const,
  },
  fleets: {
    all: ['fleets'] as const,
    bySeries: (seriesId: string) => ['fleets', 'bySeries', seriesId] as const,
  },
  competitors: {
    all: ['competitors'] as const,
    bySeries: (seriesId: string) =>
      ['competitors', 'bySeries', seriesId] as const,
    detail: (id: string) => ['competitors', 'detail', id] as const,
  },
  races: {
    all: ['races'] as const,
    bySeries: (seriesId: string) => ['races', 'bySeries', seriesId] as const,
    detail: (id: string) => ['races', 'detail', id] as const,
  },
  finishes: {
    all: ['finishes'] as const,
    byRace: (raceId: string) => ['finishes', 'byRace', raceId] as const,
    bySeries: (seriesId: string) =>
      ['finishes', 'bySeries', seriesId] as const,
  },
  raceStarts: {
    all: ['raceStarts'] as const,
    byRace: (raceId: string) => ['raceStarts', 'byRace', raceId] as const,
    byRaces: (raceIds: string[]) =>
      ['raceStarts', 'byRaces', [...raceIds].sort()] as const,
  },
  ftpServers: {
    all: ['ftpServers'] as const,
    list: () => ['ftpServers', 'list'] as const,
  },
} as const;
