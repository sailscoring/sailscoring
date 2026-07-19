import { z } from 'zod';

import type {
  Series,
  DiscardThreshold,
  StartGroup,
  CompetitorFieldKey,
  PrimaryPersonLabel,
  PublishingGroup,
  RrsOrgPushConfig,
  ProtestTimeLimit,
} from '@/lib/types';

import { SUBDIVISION_LABEL_MAX_LENGTH } from '@/lib/competitor-fields';
import { PUBLISHING_GROUP_NAME_MAX_LENGTH } from '@/lib/publishing-groups';
import {
  PRIZE_CLAUSES_MAX,
  PRIZE_NAME_MAX_LENGTH,
  PRIZE_RECIPIENT_COUNT_MAX,
} from '@/lib/prizes';

import { epochMsSchema, isoDateSchema, uuidSchema, versionSchema } from './common';

export const competitorFieldKeySchema = z.enum([
  'bowNumber',
  'boatName',
  'boatClass',
  'helm',
  'owner',
  'crewName',
  'club',
  'nationality',
  'gender',
  'age',
  'subdivision',
]);

export const primaryPersonLabelSchema = z.enum([
  'competitor',
  'entrant',
  'helm',
  'owner',
]);

export const discardThresholdSchema = z.object({
  minRaces: z.number().int().nonnegative(),
  discardCount: z.number().int().nonnegative(),
});

export const startGroupSchema = z.object({
  fleetIds: z.array(uuidSchema),
  intervalMinutes: z.number().nonnegative(),
});

export const raceFleetExclusionSchema = z.object({
  raceId: uuidSchema,
  fleetId: uuidSchema,
});

/** Combined published page (#255). Name length is bounded here; the richer
 *  rules (uniqueness, no clash with a fleet name, chosen mode needs members)
 *  live in `lib/publishing-groups.ts` and are enforced by the editor. */
export const publishingGroupSchema = z.object({
  id: uuidSchema,
  name: z.string().max(PUBLISHING_GROUP_NAME_MAX_LENGTH),
  fleetMode: z.enum(['all', 'chosen']),
  fleetIds: z.array(uuidSchema),
  detail: z.enum(['standings', 'full']),
});

/** Protest / redress time limit from the SIs. Minutes are bounded loosely —
 *  real SIs range from 30 minutes to a few hours; a day is the sanity cap. */
export const protestTimeLimitSchema = z.object({
  minutes: z.number().int().min(1).max(24 * 60),
  basis: z.enum(['race', 'day']),
});

/** rrs.org competitor-push settings remembered on the series. The event UUID
 *  is rrs.org's, not one of ours, but it is UUID-shaped all the same. */
export const rrsOrgPushConfigSchema = z.object({
  eventUuid: uuidSchema,
  divisionSource: z.enum(['none', 'fleet', 'axis']),
  divisionAxisId: z.string().optional(),
});

/** One conjunct of a prize's eligibility predicate (#240). Fleet ids are ours
 *  (UUID); axis ids are plain strings like `subdivisionAxes[].id`. */
export const prizeClauseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fleet'), fleetId: uuidSchema }),
  z.object({ kind: z.literal('axis'), axisId: z.string(), value: z.string() }),
  z.object({ kind: z.literal('rank'), max: z.number().int().positive() }),
  z.object({ kind: z.literal('gender'), value: z.enum(['M', 'F']) }),
  z.object({ kind: z.literal('nationality'), value: z.string() }),
  z.object({ kind: z.literal('club'), value: z.string() }),
]);

/** A prize (#240): bounds are structural only — allocation-level conditions
 *  (a clause referencing a deleted fleet, not enough eligible boats) are
 *  warnings in `lib/prizes.ts`, not rejections here. */
export const prizeSchema = z.object({
  id: z.string(),
  name: z.string().max(PRIZE_NAME_MAX_LENGTH),
  recipientCount: z.number().int().min(1).max(PRIZE_RECIPIENT_COUNT_MAX),
  clauses: z.array(prizeClauseSchema).max(PRIZE_CLAUSES_MAX),
});

export const seriesSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  venue: z.string(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  venueLogoUrl: z.string(),
  eventLogoUrl: z.string(),
  venueUrl: z.string(),
  eventUrl: z.string(),
  createdAt: epochMsSchema,
  lastSavedAt: epochMsSchema.nullable(),
  lastModifiedAt: epochMsSchema,
  scoringMode: z.enum(['scratch', 'handicap']),
  defaultStartSequence: z.array(startGroupSchema).optional(),
  discardThresholds: z.array(discardThresholdSchema),
  dnfScoring: z.enum(['seriesEntries', 'startingArea', 'startingAreaInclDnc']),
  // Whole-series per-fleet race exclusions. Optional on the wire so sparse
  // creation and older clients round-trip cleanly.
  raceFleetExclusions: z.array(raceFleetExclusionSchema).optional(),
  ftpHost: z.string(),
  ftpPath: z.string(),
  ftpPaths: z.record(z.string(), z.string()),
  // Which destination the Publish dialog opens in. Optional on the wire so
  // sparse creation and older clients round-trip cleanly.
  publishMode: z.enum(['sailscoring', 'ftp']).optional(),
  // FTP upload provenance for the "last uploaded · N edits since" indicator.
  ftpLastUploadedAt: epochMsSchema.optional(),
  ftpUploadedVersion: z.number().int().optional(),
  includeJsonExport: z.boolean(),
  publishRatingCalculations: z.boolean().optional(),
  showPerRaceRatingsInSummary: z.boolean().optional(),
  // Combined published pages (#255). Optional on the wire so sparse creation
  // and older clients round-trip cleanly.
  publishingGroups: z.array(publishingGroupSchema).optional(),
  publishIndividualFleetPages: z.boolean().optional(),
  // rrs.org competitor-push settings. Optional on the wire so sparse creation
  // and older clients round-trip cleanly.
  rrsOrgPush: rrsOrgPushConfigSchema.optional(),
  // Prize list (#240). Optional on the wire so sparse creation and older
  // clients round-trip cleanly.
  prizes: z.array(prizeSchema).optional(),
  // Results lifecycle. Optional on the wire (absent = provisional). Status
  // changes normally go through the dedicated finalise/reopen endpoint —
  // a generic series PUT is rejected while the series is final anyway.
  resultsStatus: z.enum(['provisional', 'final']).optional(),
  finalisedAt: epochMsSchema.optional(),
  protestTimeLimit: protestTimeLimitSchema.optional(),
  enabledCompetitorFields: z.array(competitorFieldKeySchema),
  multiPersonFields: z.array(z.enum(['primary', 'owner', 'helm', 'crewName'])).optional(),
  primaryPersonLabel: primaryPersonLabelSchema,
  // Independent subdivision axes, e.g. a "Division" and an "Age category"
  // axis. Each freeform label is bounded; empty is tolerated on the wire (the
  // read-side resolver falls back to the default) so we don't reject with a
  // brittle 400.
  subdivisionAxes: z.array(
    z.object({ id: z.string(), label: z.string().max(SUBDIVISION_LABEL_MAX_LENGTH) }),
  ),
  // Series-list organisation (#154). Workspace-local; optional on the wire so
  // sparse new-series creation and older clients round-trip cleanly.
  categoryId: uuidSchema.nullable().optional(),
  archived: z.boolean().optional(),
  // Import provenance (workspace-local). Optional on the wire so sparse
  // creation and older clients round-trip cleanly.
  source: z.enum(['sailwave']).optional(),
  // Manual sort position. Server-managed: accepted on the wire so a
  // full-series round-trip validates, but the repository ignores the client
  // value (seeded on insert, preserved on update).
  displayOrder: z.number().int().nonnegative().optional(),
  version: versionSchema,
});

/** Body for POST /api/v1/series/:id/archive — the archive/unarchive toggle (#154). */
export const seriesArchiveInputSchema = z.object({
  archived: z.boolean(),
});

/** Body for POST /api/v1/series/:id/results-status — mark the series' results
 *  final, or reopen them as provisional. */
export const seriesResultsStatusInputSchema = z.object({
  status: z.enum(['provisional', 'final']),
});

/** Body for POST /api/v1/series/reorder — rewrite the manual sort order. */
export const seriesReorderSchema = z.object({
  orderedIds: z.array(uuidSchema),
});

/** Body for POST /api/v1/series/:id/category — move a series between categories
 *  (#154). `null` clears the assignment back to the synthetic "Uncategorized". */
export const seriesCategoryInputSchema = z.object({
  categoryId: uuidSchema.nullable(),
});

/** Write-side schema. The id is optional — clients commonly generate UUIDs
 *  but the server may also generate one for new series. The optional
 *  `version` flows through from a prior GET; the API handler converts it
 *  into an If-Match-style CAS check at the repository layer. */
export const seriesInputSchema = seriesSchema.extend({
  id: uuidSchema.optional(),
});

// Drift guard: the parsed input must remain assignable to `Series` (minus the
// optional id), so `putSeries` can spread it without a field-by-field copy.
// A schema field that loosens away from `lib/types.ts` becomes a type error
// here instead of silent data loss on every settings save.
type SeriesInput = z.infer<typeof seriesInputSchema>;
type AssertAssignable<T extends U, U> = T;
type _SeriesInputMatchesSeries = AssertAssignable<SeriesInput, Omit<Series, 'id'> & { id?: string }>;

// ─── Type-fidelity guard ─────────────────────────────────────────────────────
// If the Zod schema drifts from the TS interface in `lib/types.ts`, one of
// these assignments will fail the typecheck. Both directions catch addition
// and removal of fields.
const _seriesFromZod: Series = undefined as unknown as z.infer<typeof seriesSchema>;
const _seriesFromTs: z.infer<typeof seriesSchema> = undefined as unknown as Series;
void _seriesFromZod;
void _seriesFromTs;

const _discardFromZod: DiscardThreshold = undefined as unknown as z.infer<typeof discardThresholdSchema>;
const _discardFromTs: z.infer<typeof discardThresholdSchema> = undefined as unknown as DiscardThreshold;
void _discardFromZod;
void _discardFromTs;

const _startGroupFromZod: StartGroup = undefined as unknown as z.infer<typeof startGroupSchema>;
const _startGroupFromTs: z.infer<typeof startGroupSchema> = undefined as unknown as StartGroup;
void _startGroupFromZod;
void _startGroupFromTs;

const _fieldKeyFromZod: CompetitorFieldKey = undefined as unknown as z.infer<typeof competitorFieldKeySchema>;
const _fieldKeyFromTs: z.infer<typeof competitorFieldKeySchema> = undefined as unknown as CompetitorFieldKey;
void _fieldKeyFromZod;
void _fieldKeyFromTs;

const _primaryFromZod: PrimaryPersonLabel = undefined as unknown as z.infer<typeof primaryPersonLabelSchema>;
const _primaryFromTs: z.infer<typeof primaryPersonLabelSchema> = undefined as unknown as PrimaryPersonLabel;
void _primaryFromZod;
void _primaryFromTs;

const _groupFromZod: PublishingGroup = undefined as unknown as z.infer<typeof publishingGroupSchema>;
const _groupFromTs: z.infer<typeof publishingGroupSchema> = undefined as unknown as PublishingGroup;
void _groupFromZod;
void _groupFromTs;

const _rrsPushFromZod: RrsOrgPushConfig = undefined as unknown as z.infer<typeof rrsOrgPushConfigSchema>;
const _rrsPushFromTs: z.infer<typeof rrsOrgPushConfigSchema> = undefined as unknown as RrsOrgPushConfig;
void _rrsPushFromZod;
void _rrsPushFromTs;

const _protestLimitFromZod: ProtestTimeLimit = undefined as unknown as z.infer<typeof protestTimeLimitSchema>;
const _protestLimitFromTs: z.infer<typeof protestTimeLimitSchema> = undefined as unknown as ProtestTimeLimit;
void _protestLimitFromZod;
void _protestLimitFromTs;
