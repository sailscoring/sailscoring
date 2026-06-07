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
  categories: {
    all: ['categories'] as const,
    list: () => ['categories', 'list'] as const,
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
    audit: (id: string) => ['competitors', 'audit', id] as const,
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
  raceRatingOverrides: {
    all: ['raceRatingOverrides'] as const,
    byRace: (raceId: string) => ['raceRatingOverrides', 'byRace', raceId] as const,
  },
  ftpServers: {
    all: ['ftpServers'] as const,
    list: () => ['ftpServers', 'list'] as const,
  },
  logos: {
    all: ['logos'] as const,
    list: () => ['logos', 'list'] as const,
  },
  published: {
    all: ['published'] as const,
    list: () => ['published', 'list'] as const,
  },
  tcfHistory: {
    all: ['tcfHistory'] as const,
    bySeries: (seriesId: string) =>
      ['tcfHistory', 'bySeries', seriesId] as const,
  },
  activity: {
    all: ['activity'] as const,
    bySeries: (seriesId: string) => ['activity', 'bySeries', seriesId] as const,
    recent: () => ['activity', 'recent'] as const,
  },
  workspaceMembers: {
    all: ['workspaceMembers'] as const,
  },
  orgRequest: {
    mine: () => ['orgRequest', 'mine'] as const,
  },
  irishSailingRatings: {
    all: ['irishSailingRatings'] as const,
  },
  ircRatings: {
    all: ['ircRatings'] as const,
  },
  vprsClubs: {
    all: ['vprsClubs'] as const,
  },
  vprsClubRatings: {
    byClub: (clubId: string) => ['vprsClubRatings', clubId] as const,
  },
} as const;
