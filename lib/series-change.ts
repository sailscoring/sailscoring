import type { ActivityAction } from '@/lib/activity-actions';
import type { Series } from '@/lib/types';

/**
 * What a series save actually changed, named for the activity log.
 *
 * The series row is the whole event's configuration plus its publishing
 * bookkeeping, and one endpoint writes all of it — so an entry that just says
 * "updated series settings" leaves a reader unable to tell a publish note from
 * a change to the discard profile, which alters every result in the series.
 * This picks the facet that moved and says so, in the same spirit as
 * `describeSubSeriesChange`.
 *
 * Pure and total: every persisted field belongs to a facet, and anything not
 * claimed by a named one falls to the generic settings facet, so a field added
 * later is reported vaguely rather than silently swallowed.
 */

/**
 * Fields this endpoint never decides. The first six are identity and
 * bookkeeping — they move with a save rather than because of one, and say
 * nothing about intent. The last two are server-managed and not in the series
 * update columns at all, so a client that round-trips without them must not
 * read as having cleared them.
 */
const IGNORED_FIELDS: readonly string[] = [
  'id',
  'createdAt',
  'lastSavedAt',
  'lastModifiedAt',
  'displayOrder',
  'version',
  'asPublished',
  'previousSeriesId',
];

/**
 * What an absent value means, for the fields where absent is not "nothing".
 * Everywhere else absent, null, empty and false are the same state, which is
 * how the row and the wire both already treat them — so a client holding an
 * explicit `false` where the stored row simply omits the field is not a
 * change. A field missing from here that needs an entry reports a change that
 * did not happen, which is today's behaviour and not a regression.
 */
const FIELD_DEFAULTS: Record<string, unknown> = {
  includeJsonExport: true,
  publishRatingCalculations: true,
  showPerRaceRatingsInSummary: true,
  publishIndividualFleetPages: true,
  publishDetail: 'full',
  publishMode: 'sailscoring',
  resultsStatus: 'provisional',
};

/** The actions a series save can file — a subset of the shared vocabulary. */
type SeriesChangeAction = Extract<
  ActivityAction,
  'series.updated' | 'series.renamed' | 'series.scoring-updated'
>;

type Facet = {
  /** Stable key; also the activity dedupe discriminator. */
  key: string;
  fields: readonly (keyof Series)[];
  /** Scoring-affecting facets take the dedicated action. */
  action: SeriesChangeAction;
  summary: (after: Series) => string;
};

/**
 * Facets in reporting priority. A save that moves several is headlined by the
 * first one listed, so the scoring-affecting facets lead: under-reporting a
 * venue edit alongside a discard change is harmless, the reverse is not.
 */
const FACETS: readonly Facet[] = [
  {
    key: 'scoring-mode',
    fields: ['scoringMode'],
    action: 'series.scoring-updated',
    summary: (s) => `Changed the scoring mode to ${s.scoringMode}`,
  },
  {
    key: 'discards',
    fields: ['discardThresholds', 'proportionalDiscard'],
    action: 'series.scoring-updated',
    summary: () => 'Changed the discard profile',
  },
  {
    key: 'dnf-scoring',
    fields: ['dnfScoring'],
    action: 'series.scoring-updated',
    summary: () => 'Changed how a boat that did not finish is scored',
  },
  {
    key: 'dnc-only',
    fields: ['excludeDncOnlyCompetitors'],
    action: 'series.scoring-updated',
    summary: () => 'Changed whether boats that never sailed are counted',
  },
  {
    key: 'race-exclusions',
    fields: ['raceFleetExclusions'],
    action: 'series.scoring-updated',
    summary: () => 'Changed which races count for which fleets',
  },
  {
    key: 'name',
    fields: ['name'],
    action: 'series.renamed',
    summary: (s) => `Renamed the series to “${s.name}”`,
  },
  {
    key: 'starts',
    fields: ['defaultStartSequence'],
    action: 'series.updated',
    summary: () => 'Changed the default start sequence',
  },
  {
    key: 'competitor-fields',
    fields: ['enabledCompetitorFields', 'multiPersonFields', 'primaryPersonLabel'],
    action: 'series.updated',
    summary: () => 'Changed which competitor details are recorded',
  },
  {
    key: 'subdivisions',
    fields: ['subdivisionAxes'],
    action: 'series.updated',
    summary: () => 'Changed the subdivision axes',
  },
  {
    key: 'dates',
    fields: ['startDate', 'endDate'],
    action: 'series.updated',
    summary: () => 'Changed the series dates',
  },
  {
    key: 'venue',
    fields: ['venue', 'venueUrl', 'venueLogoUrl', 'eventUrl', 'eventLogoUrl'],
    action: 'series.updated',
    summary: () => 'Updated the venue and event details',
  },
  {
    key: 'officials',
    fields: ['officials', 'publishOfficials'],
    action: 'series.updated',
    summary: () => 'Updated the race management team',
  },
  {
    key: 'protest-time-limit',
    fields: ['protestTimeLimit'],
    action: 'series.updated',
    summary: () => 'Changed the protest time limit',
  },
  {
    key: 'prizes',
    fields: ['prizes'],
    action: 'series.updated',
    summary: () => 'Updated the prize list',
  },
  {
    key: 'notes',
    fields: ['seriesNote', 'pageNotes'],
    action: 'series.updated',
    summary: () => 'Edited the note on the published pages',
  },
  {
    key: 'publishing',
    fields: [
      'includeJsonExport',
      'publishRatingCalculations',
      'showPerRaceRatingsInSummary',
      'publishingGroups',
      'publishIndividualFleetPages',
      'publishDetail',
      'publishTrackData',
    ],
    action: 'series.updated',
    summary: () => 'Changed what the published pages show',
  },
  {
    key: 'rrs-org',
    fields: ['rrsOrgPush'],
    action: 'series.updated',
    summary: () => 'Updated the rrs.org connection',
  },
  {
    key: 'publishing-destination',
    fields: [
      'ftpServerId',
      'ftpHost',
      'ftpPath',
      'ftpPaths',
      'ftpPagesExcluded',
      'ftpLastUploadedAt',
      'ftpUploadedVersion',
      'publishMode',
    ],
    action: 'series.updated',
    summary: () => 'Updated the publishing destination',
  },
];

/** Catch-all for a field no named facet claims — including one added later. */
const GENERIC: Facet = {
  key: 'settings',
  fields: [],
  action: 'series.updated',
  summary: () => 'Updated series settings',
};

const FACET_BY_FIELD = new Map<string, Facet>();
for (const facet of FACETS) {
  for (const field of facet.fields) FACET_BY_FIELD.set(field, facet);
}

/** The one state that absent, null, empty and false all collapse to. */
const EMPTY = '\u0000empty';

function normalize(field: string, value: unknown): string {
  const withDefault = value === undefined || value === null ? FIELD_DEFAULTS[field] : value;
  if (
    withDefault === undefined ||
    withDefault === null ||
    withDefault === false ||
    withDefault === '' ||
    (Array.isArray(withDefault) && withDefault.length === 0) ||
    (typeof withDefault === 'object' && Object.keys(withDefault as object).length === 0)
  ) {
    return EMPTY;
  }
  // Key order is not a change; array order is (prize and axis lists are
  // displayed in the order they are stored).
  return JSON.stringify(withDefault, (_k, v) => {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) return v;
    const obj = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, obj[k]]),
    );
  });
}

export interface SeriesChange {
  action: SeriesChangeAction;
  summary: string;
  /** The headline facet's key — the activity dedupe discriminator. */
  facet: string;
}

/**
 * Name what a save changed, or null when it changed nothing.
 *
 * A null result means the save is a no-op: the caller should write nothing and
 * record nothing, rather than file an entry and bump the version for an edit
 * that did not happen.
 */
export function describeSeriesChange(
  before: Series,
  after: Series,
): SeriesChange | null {
  const ignored = new Set(IGNORED_FIELDS);
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: Facet[] = [];
  for (const field of fields) {
    if (ignored.has(field)) continue;
    const key = field as keyof Series;
    if (normalize(field, before[key]) === normalize(field, after[key])) continue;
    const facet = FACET_BY_FIELD.get(field) ?? GENERIC;
    if (!changed.includes(facet)) changed.push(facet);
  }
  if (changed.length === 0) return null;

  // Report in declared priority, not in whatever order the keys came out.
  const ordered = [...FACETS, GENERIC].filter((f) => changed.includes(f));
  const [headline, ...rest] = ordered;
  return {
    action: headline.action,
    facet: headline.key,
    summary:
      rest.length > 0
        ? `${headline.summary(after)} +${rest.length} more`
        : headline.summary(after),
  };
}
