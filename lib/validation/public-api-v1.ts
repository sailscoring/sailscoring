import { z } from 'zod';

/**
 * The published results API, version 1 (ADR-015): the response shapes of
 * `/api/public/v1/...`.
 *
 * These schemas are the contract. The published view is built to them, the
 * read route serves what was built, and the OpenAPI description is generated
 * from them (`lib/public-api/openapi.ts`), so the three cannot disagree.
 * Within v1 a change is additive: a new optional field, a new resource, a new
 * value where a field is documented as open-ended. Anything else is v2.
 *
 * Every resource says what the published pages say, as they said it when they
 * were last published. A field a series does not display is absent rather
 * than empty.
 */

/** The schemas named in the OpenAPI description's components. */
export const publicApiV1Registry = z.registry<{ id: string; description?: string }>();

/** What each named schema is, by its id, for the description's components. */
export const publicApiV1Descriptions: Record<string, string> = {};

export function named<T extends z.ZodType>(schema: T, id: string, description: string): T {
  publicApiV1Registry.add(schema, { id, description });
  publicApiV1Descriptions[id] = description;
  return schema;
}

const isoTimestamp = z.string().describe('An instant, as an ISO 8601 timestamp in UTC (`…Z`).');
const localDate = z
  .string()
  .describe('A local date, `YYYY-MM-DD`, in the declared `timeZone`.');
const timeZone = z
  .string()
  .describe('The IANA time zone every local date and time in this resource is in.');

export const fleetRefSchema = named(
  z.object({
    key: z.string().describe('The fleet within the publication, stable across publishes: the kebab-cased fleet name.'),
    name: z.string(),
  }),
  'FleetRef',
  'A fleet of the publication.',
);

export const competitorSchema = named(
  z.object({
    id: z
      .string()
      .describe(
        'The competitor within this series: the same in every resource and every publish of it. Not related across series; use `identity` for that.',
      ),
    identity: z
      .object({
        slug: z.string(),
        url: z.string().describe('The competitor\'s public timeline across the workspace\'s series.'),
      })
      .optional()
      .describe('The competitor across series, where the workspace publishes competitor pages.'),
    sailNumber: z.string(),
    bowNumber: z.string().optional(),
    entryNumber: z.string().optional(),
    tallyNumber: z.string().optional(),
    boatName: z.string().optional(),
    boatClass: z.string().optional(),
    names: z
      .array(z.string())
      .describe('The primary person or people, headed as the resource\'s `namesLabel` says.'),
    helms: z.array(z.string()).optional(),
    owners: z.array(z.string()).optional(),
    crew: z.array(z.string()).optional(),
    clubs: z.array(z.string()).optional(),
    nationality: z.string().optional().describe('Three-letter national code.'),
    worldSailingId: z.string().optional(),
    subdivisions: z
      .record(z.string(), z.string())
      .optional()
      .describe('Prize-giving subdivisions, keyed by the column heading ("Division": "Silver").'),
    gender: z.enum(['M', 'F']).optional(),
    age: z.number().int().optional(),
    details: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .optional()
      .describe('An archive\'s competitor columns, as originally published.'),
  }),
  'Competitor',
  'A competitor, with the details the series displays.',
);

export const scoreSchema = named(
  z.object({
    points: z.number().nullable().describe('Null in an archive, which holds what was printed.'),
    code: z.string().nullable().describe('A result or penalty code (`DNF`, `SCP`, `RDG`), or null.'),
    discarded: z.boolean(),
    excluded: z
      .boolean()
      .optional()
      .describe('The race is not in the standings: nobody finished it, or it is not scored yet.'),
    display: z.string().describe('The cell as the page prints it, e.g. `(12.0 DNF)`.'),
  }),
  'Score',
  'One race score in a standings row.',
);

const standingsRaceSchema = z.object({
  race: z
    .number()
    .int()
    .nullable()
    .describe('The race\'s number in the series, the `n` of `races/{n}`. Null where a column is not one race.'),
  label: z.string().describe('The column heading, e.g. `R3`. A fleet that sat races out numbers its own.'),
  date: localDate.nullable(),
  name: z.string().nullable(),
});

export const standingsRowSchema = named(
  z.object({
    rank: z.number().int().nullable(),
    rankDisplay: z.string().describe('The rank as printed, e.g. `1st`.'),
    competitor: competitorSchema,
    fleet: z
      .string()
      .optional()
      .describe('A championship row\'s fleet, where the championship has split.'),
    scores: z
      .array(scoreSchema.nullable())
      .describe('One per column of `races`, in the same order; null where the competitor has no score.'),
    total: z.number().nullable(),
    net: z.number().nullable(),
    totalDisplay: z.string().nullable(),
    netDisplay: z.string().nullable(),
    summary: z
      .array(z.object({ label: z.string(), value: z.string() }))
      .optional()
      .describe('An archive\'s totals columns, as originally published.'),
  }),
  'StandingsRow',
  'One competitor\'s line in a standings table.',
);

export const standingsTableSchema = named(
  z.object({
    fleet: fleetRefSchema,
    subSeries: z.string().nullable().describe('The sub-series the table scores, or null for the whole series.'),
    scoringSystem: z.string().nullable(),
    namesLabel: z.string().describe('What the competitors\' `names` are headed, e.g. `Helm`.'),
    caption: z.string().optional(),
    races: z.array(standingsRaceSchema),
    rows: z.array(standingsRowSchema),
  }),
  'StandingsTable',
  'A fleet\'s standings, as published.',
);

const resourceBase = {
  timeZone,
  publication: z.string().describe('The publication resource this belongs to.'),
  publishedAt: isoTimestamp.describe('When the page this resource follows was last published.'),
};

export const standingsSchema = named(
  z.object({ ...resourceBase, tables: z.array(standingsTableSchema) }),
  'Standings',
  'Every fleet\'s standings, or one fleet\'s.',
);

const startSchema = z.object({
  time: z.string().nullable().describe('The gun, local `HH:MM:SS`; null where no time was set.'),
  fleets: z.array(z.string()).describe('The keys of the fleets on this gun.'),
});

export const raceSummarySchema = named(
  z.object({
    race: z.number().int(),
    name: z.string().nullable(),
    date: localDate.nullable(),
    starts: z.array(startSchema),
    fleets: z.array(z.string()).describe('The keys of the fleets with results in this race.'),
    url: z.string(),
  }),
  'RaceSummary',
  'A sailed race.',
);

export const racesSchema = named(
  z.object({ ...resourceBase, races: z.array(raceSummarySchema) }),
  'Races',
  'The sailed races.',
);

export const raceResultSchema = named(
  z.object({
    competitor: competitorSchema,
    rank: z.number().int().nullable(),
    points: z.number().nullable(),
    code: z.string().nullable(),
    display: z.string().describe('The points as the page prints them, e.g. `9.0 DNC`.'),
    finishTime: z.string().optional().describe('Local `HH:MM:SS`.'),
    elapsed: z.string().optional().describe('Elapsed time as printed, `H:MM:SS`.'),
    corrected: z.string().optional().describe('Corrected time as printed, `H:MM:SS`.'),
    rating: z.number().optional().describe('The rating applied in this race, headed as the fleet\'s `ratingLabel` says.'),
  }),
  'RaceResult',
  'One competitor\'s result in one race.',
);

export const raceFleetSchema = named(
  z.object({
    fleet: fleetRefSchema,
    subSeries: z.string().nullable(),
    label: z.string().describe('The race as this fleet numbers it, e.g. `R2`.'),
    startTime: z.string().nullable(),
    ratingLabel: z.string().nullable(),
    results: z.array(raceResultSchema),
    table: z
      .object({
        caption: z.string().optional(),
        columns: z.array(z.string()),
        rows: z.array(z.array(z.string())),
      })
      .optional()
      .describe('An archive\'s race table, as originally published.'),
  }),
  'RaceFleet',
  'One fleet\'s results in a race.',
);

export const raceSchema = named(
  z.object({
    ...resourceBase,
    race: z.number().int(),
    name: z.string().nullable(),
    date: localDate.nullable(),
    fleets: z.array(raceFleetSchema),
  }),
  'Race',
  'One race\'s results, fleet by fleet.',
);

export const entrySchema = named(
  competitorSchema.extend({
    fleets: z.array(z.string()).describe('The names of the fleets the competitor is entered in.'),
    ratings: z
      .array(z.string().nullable())
      .optional()
      .describe('One per `ratingColumns` entry: the rating, empty when unrated, null when not entered in that fleet.'),
  }),
  'Entry',
  'One competitor on the entry list.',
);

export const competitorsSchema = named(
  z.object({
    ...resourceBase,
    count: z.number().int(),
    namesLabel: z.string(),
    groups: z.array(
      z.object({
        heading: z.string().nullable(),
        ratingColumns: z.array(z.string()),
        competitors: z.array(entrySchema),
      }),
    ),
  }),
  'Competitors',
  'The entry list.',
);

export const scheduleRaceSchema = named(
  z.object({
    race: z.number().int().describe('The race\'s number in the series.'),
    name: z.string().nullable(),
    date: localDate.nullable(),
    starts: z
      .array(startSchema)
      .describe('Each gun and the fleets on it. A start may have no time, and a race may have no starts.'),
    status: z
      .enum(['sailed', 'scheduled'])
      .describe('`sailed` once the race has results. A past race still `scheduled` was blown out, abandoned, or not yet entered.'),
    results: z
      .string()
      .optional()
      .describe('The results page of a sailed race.'),
  }),
  'ScheduleRace',
  'A race on the schedule.',
);

export const scheduleSchema = named(
  z.object({ ...resourceBase, races: z.array(scheduleRaceSchema) }),
  'Schedule',
  'Every race of the series, sailed or not, as of when the Schedule page was last published.',
);

const resourceLinkSchema = z.object({
  url: z.string(),
  publishedAt: isoTimestamp,
});

export const publicationSchema = named(
  z.object({
    timeZone,
    id: z.string().describe('Opaque; stable for as long as the series stays published.'),
    url: z.string(),
    name: z.string(),
    kind: z
      .enum(['series', 'championship', 'archive'])
      .describe('A scored series, a split-fleet championship, or results kept as originally published.'),
    status: z.enum(['provisional', 'final']).nullable(),
    workspace: z.object({ slug: z.string(), name: z.string(), url: z.string() }),
    season: z.string().nullable(),
    page: z.string().describe('The publication\'s results page.'),
    data: z.string().nullable().describe('The publication\'s `.sailscoring.json` data file, or null.'),
    publishedAt: isoTimestamp.describe('When any page of the publication was last published.'),
    fleets: z.array(
      fleetRefSchema.extend({ scoringSystem: z.string().nullable() }),
    ),
    resources: z
      .object({
        standings: resourceLinkSchema.optional(),
        races: resourceLinkSchema.optional(),
        competitors: resourceLinkSchema.optional(),
        schedule: resourceLinkSchema.optional(),
      })
      .describe('The resources the publication\'s pages publish, and when each was last published.'),
  }),
  'Publication',
  'A published series.',
);

/** The error codes the public API answers with, both parts alike (ADR-016
 *  §5). A code is stable; a message is for people and may change. */
export const PUBLIC_ERROR_CODES = [
  'invalid',
  'unauthenticated',
  'forbidden',
  'not-found',
  'conflict',
  'archived',
  'rate-limited',
  'internal',
] as const;
export type PublicErrorCode = (typeof PUBLIC_ERROR_CODES)[number];

export const errorSchema = named(
  z.object({
    error: z.enum(PUBLIC_ERROR_CODES).describe('What went wrong, as a stable code.'),
    message: z.string().optional().describe('What went wrong, for a person. Not stable: don\'t match on it.'),
    problems: z
      .array(z.object({ field: z.string(), message: z.string() }))
      .optional()
      .describe('For `invalid`: each field the request got wrong, by its path (`races.0.date`).'),
  }),
  'Error',
  'What went wrong.',
);

export type PublicApiFleetRef = z.infer<typeof fleetRefSchema>;
export type PublicApiCompetitor = z.infer<typeof competitorSchema>;
export type PublicApiScore = z.infer<typeof scoreSchema>;
export type PublicApiStandingsRow = z.infer<typeof standingsRowSchema>;
export type PublicApiStandingsTable = z.infer<typeof standingsTableSchema>;
export type PublicApiStandings = z.infer<typeof standingsSchema>;
export type PublicApiRaceSummary = z.infer<typeof raceSummarySchema>;
export type PublicApiRaces = z.infer<typeof racesSchema>;
export type PublicApiRaceResult = z.infer<typeof raceResultSchema>;
export type PublicApiRaceFleet = z.infer<typeof raceFleetSchema>;
export type PublicApiRace = z.infer<typeof raceSchema>;
export type PublicApiEntry = z.infer<typeof entrySchema>;
export type PublicApiCompetitors = z.infer<typeof competitorsSchema>;
export type PublicApiPublication = z.infer<typeof publicationSchema>;
export type PublicApiSchedule = z.infer<typeof scheduleSchema>;
export type PublicApiScheduleRace = z.infer<typeof scheduleRaceSchema>;
