import { z } from 'zod';

import { submitFinishesSchema } from './finish-submission';
import { named } from './public-api-v1';

/**
 * The public API's authenticated part, version 1 (ADR-016 §3): what its
 * calls take and return, below `/api/public/v1`, beside the published results
 * (`./public-api-v1.ts`), in the same OpenAPI description.
 *
 * These are shapes of their own, mapped from the internal model in
 * `lib/public-api/workspace-resources.ts`, so the model can change without
 * the API changing. Each lists a few fields: one can be added later, and
 * within v1 none is removed, renamed or given a new meaning. Ids are the
 * internal ones, which the writes take. A field with nothing to say is
 * null, never absent, so a client sees the whole shape every time.
 */

const id = z.uuid();
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('A local date, `YYYY-MM-DD`.');
const wallClock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .describe('A local time of day, `HH:MM:SS` (or `HH:MM`).');
const isoTimestamp = z.string().describe('An instant, as an ISO 8601 timestamp in UTC (`…Z`).');

export const workspaceResource = named(
  z.object({
    id: z.string(),
    slug: z.string().describe('The workspace in published URLs: `/p/{slug}`.'),
    name: z.string(),
  }),
  'Workspace',
  'A workspace the token can act in.',
);

export const workspacesResource = named(
  z.object({ workspaces: z.array(workspaceResource) }),
  'Workspaces',
  'The workspaces this token can act in: for an app, the one its grant names.',
);

export const seasonResource = named(
  z.object({
    label: z.string().describe('As the publish call takes it, e.g. `2026`.'),
    current: z.boolean(),
  }),
  'Season',
  'A season results are published under.',
);

export const seasonsResource = named(
  z.object({ seasons: z.array(seasonResource) }),
  'Seasons',
  'The workspace\'s seasons, newest first.',
);

export const seriesResource = named(
  z.object({
    id,
    name: z.string(),
    venue: z.string().nullable(),
    startDate: localDate.nullable(),
    endDate: localDate.nullable(),
    archived: z.boolean().describe('An archived series is read-only.'),
    asPublished: z.boolean().describe('An archive of results as originally published: read-only, never scored here.'),
  }),
  'Series',
  'A series: a regatta, a league, a season\'s racing.',
);

export const seriesListResource = named(
  z.object({ series: z.array(seriesResource) }),
  'SeriesList',
  'Every series in the workspace.',
);

export const fleetResource = named(
  z.object({
    id,
    name: z.string(),
    scoringSystem: z
      .string()
      .describe('How the fleet is scored: `scratch`, `irc`, `orc`, `echo`, `py`, `nhc`, `vprs`, `tcf`. Open-ended: more may be added.'),
  }),
  'Fleet',
  'A fleet of a series.',
);

export const fleetsResource = named(z.object({ fleets: z.array(fleetResource) }), 'Fleets', 'A series\' fleets, in order.');

export const competitorResource = named(
  z.object({
    id,
    fleetIds: z.array(id).describe('The fleets the boat is entered in.'),
    sailNumber: z.string(),
    bowNumber: z.string().nullable(),
    alternativeSailNumbers: z.array(z.string()).describe('Other sail numbers the boat is known by.'),
    boatName: z.string().nullable(),
    boatClass: z.string().nullable(),
    names: z.array(z.string()).describe('The primary person or people, as the series heads them (helm, owner, skipper).'),
    helms: z.array(z.string()),
    owners: z.array(z.string()),
    crew: z.array(z.string()),
    clubs: z.array(z.string()),
    nationality: z.string().nullable().describe('Three-letter national code.'),
    excluded: z.boolean().describe('Entered, but not scored as an entrant.'),
  }),
  'Competitor',
  'A boat entered in the series, with the details the series records.',
);

export const competitorsResource = named(
  z.object({ competitors: z.array(competitorResource) }),
  'CompetitorList',
  'A series\' entry list.',
);

export const courseLegResource = named(
  z.object({
    name: z.string().nullable(),
    distanceNm: z.number(),
    bearingDeg: z.number(),
    windDirectionDeg: z.number(),
    windSpeedKts: z.number().nullable(),
  }),
  'CourseLeg',
  'One leg of a start\'s course.',
);

export const courseResource = named(
  z.object({
    name: z.string().nullable(),
    north: z
      .enum(['true', 'magnetic'])
      .describe('What the bearings are relative to: `true`, unless the course came with magnetic bearings and nothing said where it was, so they could not be converted.'),
    distanceNm: z.number().nullable().describe('The course length the start states, else the sum of its legs.'),
    legs: z.array(courseLegResource),
  }),
  'Course',
  'A start\'s constructed course (ORC rule 402.5), as stored.',
);

export const startResource = named(
  z.object({
    id,
    fleetIds: z.array(id).describe('The fleets on this gun. A fleet starts once per race.'),
    startTime: wallClock.nullable().describe('The gun, `HH:MM:SS`; null for a start with no time.'),
    course: courseResource.nullable(),
  }),
  'Start',
  'A start of a race: a gun and the fleets on it.',
);

export const raceResource = named(
  z.object({
    id,
    number: z.number().int().describe('The race\'s number in the series. Deleting or reordering races renumbers them; use `id` to keep track of one.'),
    name: z.string().nullable(),
    date: localDate.nullable(),
    starts: z.array(startResource),
  }),
  'Race',
  'A race and its starts.',
);

export const racesResource = named(z.object({ races: z.array(raceResource) }), 'RaceList', 'A series\' races, in order.');

export const datedRaceResource = named(
  raceResource.extend({
    seriesId: id,
    seriesName: z.string(),
  }),
  'DatedRace',
  'A race, with its starts and the series it scores for.',
);

export const datedRacesResource = named(
  z.object({ races: z.array(datedRaceResource) }),
  'DatedRaceList',
  'The races on a date across the workspace\'s series, by series and then by number.',
);

export const finishResource = named(
  z.object({
    id,
    competitorId: id.nullable().describe('Null for a crossing whose sail number matched no entry.'),
    sailNumber: z.string().nullable().describe('The sail number recorded, for a crossing that matched no entry.'),
    position: z.number().int().nullable().describe('Finishing order among the finishers; null for a boat that didn\'t finish.'),
    tiedWithPrevious: z.boolean(),
    finishTime: wallClock.nullable(),
    elapsedSecs: z.number().nullable(),
    resultCode: z.string().nullable().describe('An RRS code (`DNF`, `OCS`, …) for a boat that didn\'t finish normally.'),
    penaltyCode: z.string().nullable().describe('A scoring penalty (`ZFP`, `SCP`, `DPI`).'),
  }),
  'Finish',
  'One boat\'s finish in a race, as recorded.',
);

export const finishesResource = named(z.object({ finishes: z.array(finishResource) }), 'FinishList', 'A race\'s finishes, in finishing order.');

export const submittedStartResource = named(
  z.object({
    startId: id,
    startTime: wallClock.describe('The start time taken on the water, `HH:MM:SS`.'),
  }),
  'SubmittedStart',
  'A start time a submission records, for one of the race\'s starts.',
);

export const submittedFinishResource = named(
  z.object({
    id: z.string().describe('The row\'s own id, as submitted.'),
    competitorId: id.nullable().describe('The boat, where the submission named it by id.'),
    sailNumber: z.string().nullable().describe('The sail number written down, where the submission named the boat that way.'),
    finishTime: wallClock.nullable(),
    elapsedSecs: z.number().nullable(),
    resultCode: z.string().nullable(),
  }),
  'SubmittedFinish',
  'One row of a submitted finish sheet, as submitted.',
);

export const submissionResource = named(
  z.object({
    id,
    raceId: id,
    seriesId: id,
    revision: z.number().int(),
    status: z
      .enum(['pending', 'applied', 'dismissed'])
      .describe('`pending` until a scorer applies it to the finish sheet or dismisses it. A new revision is `pending` again.'),
    recordedBy: z.string().nullable(),
    complete: z.boolean(),
    starts: z.array(submittedStartResource),
    finishes: z.array(submittedFinishResource),
    submittedBy: z.string().nullable().describe('The person who submitted it.'),
    app: z.string().nullable().describe('The app it was submitted through, where it was.'),
    submittedAt: isoTimestamp.describe('When the current revision arrived.'),
    reviewedAt: isoTimestamp.nullable().describe('When a scorer last applied or dismissed it.'),
    reviewedRevision: z.number().int().nullable().describe('The revision that review was of.'),
    matched: z.number().int().describe('Rows naming a boat entered in the race.'),
    unknownSailNumbers: z.array(z.string()).describe('Sail numbers that match no entry; the scorer resolves them.'),
    skipped: z
      .array(z.object({ id: z.string(), reason: z.string() }))
      .describe('Rows the scorer\'s review will leave out, and why: a boat in no fleet racing in this race, a boat twice.'),
    reviewUrl: z.string().describe('The race in Sail Scoring, where a scorer reviews it.'),
  }),
  'Submission',
  'A recording of one race\'s finishes, held beside the race until a scorer applies it to the finish sheet or dismisses it.',
);

export const submissionsResource = named(
  z.object({ submissions: z.array(submissionResource) }),
  'SubmissionList',
  'A race\'s submissions, the latest upload first.',
);

export const publicationResource = named(
  z.object({
    id: z.string().describe('The publication, as `/publications/{id}` serves it.'),
    seriesId: id.nullable(),
    slug: z.string(),
    url: z.string().describe('The published results page.'),
    api: z.string().nullable().describe('The publication in the published results API, where it has one.'),
    publishedAt: isoTimestamp,
  }),
  'WorkspacePublication',
  'A series\' published results.',
);

export const publicationsResource = named(
  z.object({ publications: z.array(publicationResource) }),
  'WorkspacePublications',
  'Every publication in the workspace.',
);

export const seriesPublicationResource = named(
  z.object({ publication: publicationResource.nullable() }),
  'SeriesPublication',
  'A series\' publication, or null while it has none.',
);

// ─── What the writes take ────────────────────────────────────────────────────

export const createRacesInput = named(
  z
    .object({
      races: z
        .array(
          z
            .object({
              id: id.optional().describe('Choose the id, so a retried call replaces rather than duplicates.'),
              date: localDate,
              name: z.string().trim().max(120).nullable().optional(),
              starts: z
                .array(
                  z
                    .object({
                      id: id.optional(),
                      fleetIds: z.array(id),
                      startTime: wallClock.nullable().optional(),
                    })
                    .strict(),
                )
                .default([]),
            })
            .strict(),
        )
        .min(1)
        .max(50),
    })
    .strict(),
  'CreateRaces',
  'Races to add after the series\' last race, each with its starts. The server numbers them.',
);

export const startPatchInput = named(
  z
    .object({
      startTime: wallClock.nullable().optional(),
      fleetIds: z.array(id).optional(),
    })
    .strict(),
  'StartChange',
  'The parts of a start to change; a field left out keeps its value, and `null` clears it.',
);

export const publishInput = named(
  z
    .object({
      season: z.string().trim().max(40).optional().describe('The season to publish under; defaults to the series\' year.'),
      folder: z.string().trim().max(60).optional(),
      slug: z.string().trim().max(80).optional().describe('Honoured on the first publish only.'),
      fleets: z.array(z.string()).optional().describe('The fleets to publish, by name; all of them when left out.'),
    })
    .strict(),
  'Publish',
  'How to publish a series.',
);

export const submitFinishesInput = named(
  submitFinishesSchema,
  'SubmitFinishes',
  'The whole recording of a race\'s finishes, at one revision: each upload replaces the last. Row order is crossing order.',
);

export type WorkspaceResource = z.infer<typeof workspaceResource>;
export type SeriesResource = z.infer<typeof seriesResource>;
export type FleetResource = z.infer<typeof fleetResource>;
export type CompetitorResource = z.infer<typeof competitorResource>;
export type CourseResource = z.infer<typeof courseResource>;
export type StartResource = z.infer<typeof startResource>;
export type RaceResource = z.infer<typeof raceResource>;
export type DatedRaceResource = z.infer<typeof datedRaceResource>;
export type FinishResource = z.infer<typeof finishResource>;
export type PublicationResource = z.infer<typeof publicationResource>;
export type SubmissionResource = z.infer<typeof submissionResource>;
