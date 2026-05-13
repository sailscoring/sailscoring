import { z } from 'zod';

import type {
  Series,
  DiscardThreshold,
  StartGroup,
  BilgeBundle,
  CompetitorFieldKey,
  PrimaryPersonLabel,
} from '@/lib/types';

import { epochMsSchema, isoDateSchema, uuidSchema, versionSchema } from './common';

export const competitorFieldKeySchema = z.enum([
  'boatName',
  'boatClass',
  'helm',
  'owner',
  'crewName',
  'club',
  'gender',
  'age',
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

export const bilgeBundleSchema = z.object({
  uuid: z.string().min(1),
  prefix: z.string(),
  slug: z.string(),
  email: z.string().optional(),
  status: z.enum(['unpublished', 'pending', 'published']),
  publishedUrl: z.string().nullable(),
  lastPublishedAt: epochMsSchema.nullable(),
  fleets: z
    .array(z.object({ name: z.string(), url: z.string().nullable() }))
    .optional(),
});

export const seriesSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  venue: z.string(),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  venueLogoUrl: z.string(),
  eventLogoUrl: z.string(),
  createdAt: epochMsSchema,
  lastSnapshotId: uuidSchema.nullable(),
  lastSavedAt: epochMsSchema.nullable(),
  lastModifiedAt: epochMsSchema,
  snapshotHistory: z.array(uuidSchema),
  scoringMode: z.enum(['scratch', 'handicap']),
  defaultStartSequence: z.array(startGroupSchema).optional(),
  discardThresholds: z.array(discardThresholdSchema),
  dnfScoring: z.enum(['seriesEntries', 'startingArea']),
  ftpHost: z.string(),
  ftpPath: z.string(),
  ftpPaths: z.record(z.string(), z.string()),
  bilgeBundle: bilgeBundleSchema.nullable(),
  includeJsonExport: z.boolean(),
  publishRatingCalculations: z.boolean().optional(),
  showPerRaceRatingsInSummary: z.boolean().optional(),
  enabledCompetitorFields: z.array(competitorFieldKeySchema),
  primaryPersonLabel: primaryPersonLabelSchema,
  version: versionSchema,
});

/** Write-side schema. The id is optional — clients commonly generate UUIDs
 *  but the server may also generate one for new series. The optional
 *  `version` flows through from a prior GET; the API handler converts it
 *  into an If-Match-style CAS check at the repository layer. */
export const seriesInputSchema = seriesSchema.extend({
  id: uuidSchema.optional(),
});

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

const _bilgeFromZod: BilgeBundle = undefined as unknown as z.infer<typeof bilgeBundleSchema>;
const _bilgeFromTs: z.infer<typeof bilgeBundleSchema> = undefined as unknown as BilgeBundle;
void _bilgeFromZod;
void _bilgeFromTs;

const _fieldKeyFromZod: CompetitorFieldKey = undefined as unknown as z.infer<typeof competitorFieldKeySchema>;
const _fieldKeyFromTs: z.infer<typeof competitorFieldKeySchema> = undefined as unknown as CompetitorFieldKey;
void _fieldKeyFromZod;
void _fieldKeyFromTs;

const _primaryFromZod: PrimaryPersonLabel = undefined as unknown as z.infer<typeof primaryPersonLabelSchema>;
const _primaryFromTs: z.infer<typeof primaryPersonLabelSchema> = undefined as unknown as PrimaryPersonLabel;
void _primaryFromZod;
void _primaryFromTs;
