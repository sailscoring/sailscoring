import { z } from 'zod';

import { SAMPLE_RATE, SEGMENT_SECONDS, VOICE_DOCUMENT_FORMAT } from './types';

/**
 * What the phone sends when a recording goes to the scorer with the sheet:
 * the list of calls, then the sound in pieces. The limits are generous for a
 * race's finish and small enough that nothing here can be used as storage.
 */

const epochMs = z.number().int().nonnegative();

const lineSchema = z
  .object({
    id: z.string().min(1).max(64),
    how: z.enum(['whole', 'ending', 'sounds', 'ambiguous', 'unknown', 'tap']),
    competitorId: z.uuid().nullable(),
    couldBe: z.array(z.uuid()).max(50),
    digits: z.string().max(20),
    words: z.array(z.string().max(40)).max(20),
    heardAt: epochMs.nullable(),
    heardUntil: epochMs.nullable(),
    at: epochMs,
    timeFrom: z.enum(['tap', 'word', 'called']),
    calledAgainAt: z.array(epochMs).max(50),
    boatSettled: z.boolean(),
    timeSettled: z.boolean(),
    removed: z.boolean(),
  })
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
    lines: z.array(lineSchema).max(2000),
    words: z.array(z.object({ w: z.string().max(40), at: epochMs }).strict()).max(100_000),
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
