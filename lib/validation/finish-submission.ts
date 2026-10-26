import { z } from 'zod';

/**
 * A finish sheet submission upload (#671): the whole recording of one race's
 * finishes, at one revision. The same body whether it comes from the Record
 * finishes page or from a race-day app through the public API.
 */

const wallClock = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/)
  .describe('A local time of day, `HH:MM:SS` (or `HH:MM`).');

/** The codes a recorder records for a boat that didn't finish normally.
 *  Redress and scoring penalties are the scorer's and the jury's. */
export const SUBMITTABLE_CODES = ['DNC', 'DNS', 'OCS', 'NSC', 'DNF', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD'] as const;

export const submittedStartSchema = z
  .object({
    startId: z.uuid().describe('One of the race\'s starts.'),
    startTime: wallClock.describe('The start time taken on the water.'),
  })
  .strict();

export const submittedFinishSchema = z
  .object({
    id: z.string().trim().min(1).max(64).describe('The row\'s own id, unique within the submission.'),
    competitorId: z.uuid().nullable().optional().describe('The boat, where the recorder knew the entry.'),
    sailNumber: z.string().trim().min(1).max(40).nullable().optional().describe('The sail number written down, for a boat not named by `competitorId`.'),
    finishTime: wallClock.nullable().optional().describe('The time of day the boat finished.'),
    elapsedSecs: z.number().nonnegative().finite().nullable().optional().describe('The boat\'s elapsed time, for a sheet kept on a stopwatch; instead of `finishTime`.'),
    resultCode: z.enum(SUBMITTABLE_CODES).nullable().optional().describe('For a boat that didn\'t finish normally.'),
  })
  .strict()
  .refine((f) => f.competitorId || f.sailNumber, { message: 'Name the boat: competitorId or sailNumber.', path: ['sailNumber'] })
  .refine((f) => !(f.finishTime && f.elapsedSecs != null), { message: 'A finish has a finishTime or an elapsedSecs, not both.', path: ['elapsedSecs'] });

export const submitFinishesSchema = z
  .object({
    revision: z.number().int().positive().describe('Higher than the last upload of this submission: each upload replaces the whole recording.'),
    recordedBy: z.string().trim().max(80).nullable().optional().describe('A label for the device or the person, such as `Committee boat`.'),
    starts: z.array(submittedStartSchema).max(20).default([]).describe('Start times taken on the water.'),
    finishes: z.array(submittedFinishSchema).max(500).describe('Row order is crossing order; a row with a `resultCode` takes no place.'),
    complete: z.boolean().default(false).describe('True once the recording is the whole race.'),
  })
  .strict();

export type SubmitFinishesInput = z.infer<typeof submitFinishesSchema>;

export const reviewSubmissionSchema = z
  .object({
    status: z.enum(['applied', 'dismissed']),
    revision: z.number().int().positive(),
  })
  .strict();

export type ReviewSubmissionInput = z.infer<typeof reviewSubmissionSchema>;
