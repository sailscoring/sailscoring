import { z } from 'zod';

import { SAMPLE_RATE, SEGMENT_SECONDS, VOICE_DOCUMENT_FORMAT } from './types';

/**
 * What the phone sends when a recording goes to the scorer with the sheet:
 * the document (what was heard and pressed, and what was decided), then the
 * sound in pieces. The limits are generous for a race's finish and small
 * enough that nothing here can be used as storage.
 */

const epochMs = z.number().int().nonnegative();

const pressSchema = z.object({ id: z.string().min(1).max(64), at: epochMs }).strict();

const finishSchema = z
  .object({
    id: z.uuid(),
    competitorId: z.uuid().nullable(),
    sailNumber: z.string().max(20).nullable(),
    at: epochMs,
    timeFrom: z.enum(['press', 'spoken', 'called', 'hand']),
    pressId: z.string().min(1).max(64).nullable(),
    calledAt: epochMs.nullable(),
    removed: z.boolean(),
  })
  .strict();

const dismissalSchema = z
  .object({ pressId: z.string().min(1).max(64).nullable(), spokenAt: epochMs.nullable(), calledAt: epochMs.nullable() })
  .strict();

/** The longest take the server holds: three hours. */
const MAX_TAKE_SAMPLES = SAMPLE_RATE * 60 * 60 * 3;

export const voiceDocumentSchema = z
  .object({
    format: z.literal(VOICE_DOCUMENT_FORMAT),
    recordingId: z.uuid(),
    raceId: z.uuid(),
    sampleRate: z.literal(SAMPLE_RATE),
    segmentSeconds: z.literal(SEGMENT_SECONDS),
    engine: z
      .object({ model: z.string().max(80), version: z.string().max(40), lagSeconds: z.number().min(0).max(5) })
      .strict()
      .nullable(),
    device: z.object({ userAgent: z.string().max(400), microphone: z.string().max(200).nullable() }).strict(),
    realTimeFactor: z.number().min(0).max(100).nullable(),
    takes: z
      .array(z.object({ index: z.number().int().min(0).max(499), startedAt: epochMs, samples: z.number().int().min(0).max(MAX_TAKE_SAMPLES) }).strict())
      .max(500),
    gaps: z.array(z.object({ from: epochMs, to: epochMs }).strict()).max(500),
    presses: z.array(pressSchema).max(2000),
    words: z.array(z.object({ w: z.string().max(40), at: epochMs }).strict()).max(100_000),
    finishes: z.array(finishSchema).max(2000),
    dismissals: z.array(dismissalSchema).max(2000),
  })
  .strict();

export const putRecordingSchema = z
  .object({
    raceId: z.uuid(),
    /** The finish sheet submission the recording goes with. */
    submissionId: z.uuid(),
    document: voiceDocumentSchema,
  })
  .strict();

export type PutRecordingInput = z.infer<typeof putRecordingSchema>;

/** Pieces of sound in one request: two minutes of it. */
export const MAX_SEGMENTS_PER_REQUEST = 24;

export const putSegmentsSchema = z
  .object({
    segments: z
      .array(
        z
          .object({
            take: z.number().int().min(0).max(499),
            index: z.number().int().min(0),
            /** µ-law, base64. */
            audio: z.string().min(1).max(Math.ceil((SAMPLE_RATE * SEGMENT_SECONDS * 4) / 3) + 8),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_SEGMENTS_PER_REQUEST),
  })
  .strict();

export type PutSegmentsInput = z.infer<typeof putSegmentsSchema>;
