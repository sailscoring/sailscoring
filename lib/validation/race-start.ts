import { z } from 'zod';

import { STORED_STAGES, type StoredStage } from '@/lib/split-fleets';
import type { RaceStart, RaceStartCourse } from '@/lib/types';

import { uuidSchema, versionSchema, wallClockSchema } from './common';

const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);
const bearingSchema = z.number().min(0).max(360);
const sideSchema = z.enum(['port', 'starboard']);
/** A course may not exceed the leg table it fills (60 legs = 61 marks). */
const MAX_COURSE_MARKS = 61;
const MAX_COURSE_LEGS = MAX_COURSE_MARKS - 1;

/** One leg of the table a start's course gave: how far, and on what
 *  bearing. The distance bound matches a start's own legs. */
const courseLegSchema = z.object({
  distanceNm: z.number().positive().max(999),
  bearingDeg: bearingSchema,
});

/** One end of a line a start's course was measured from. */
const raceStartCourseLineEndSchema = z.object({
  end: sideSchema,
  markId: uuidSchema.optional(),
  label: z.string().max(80),
  lat: latSchema,
  lng: lngSchema,
  fixed: z.boolean().optional(),
  set: z.string().min(1).max(200).optional(),
});

/** The course a start sailed: its name, wind and anchor, and the legs it
 *  gave (see RaceStartCourse). */
export const raceStartCourseSchema = z.object({
  courseId: uuidSchema.optional(),
  name: z.string().trim().min(1).max(80),
  waypoints: z
    .array(
      z.object({
        markId: uuidSchema.optional(),
        label: z.string().max(80),
        lat: latSchema,
        lng: lngSchema,
        side: sideSchema.optional(),
        passing: z.boolean().optional(),
        fixed: z.boolean().optional(),
        set: z.string().min(1).max(200).optional(),
        cardMarkId: z.string().min(1).max(40).optional(),
        ends: z
          .tuple([raceStartCourseLineEndSchema, raceStartCourseLineEndSchema])
          .refine(([a, b]) => a.end === 'starboard' && b.end === 'port', {
            message: 'A line has its starboard end first and its port end second',
          })
          .optional(),
      }),
    )
    .max(MAX_COURSE_MARKS),
  legs: z.array(courseLegSchema).max(MAX_COURSE_LEGS).optional(),
  anchor: z.object({ lat: latSchema, lng: lngSchema }).optional(),
  north: z.literal('magnetic').optional(),
  windDirectionDeg: bearingSchema.optional(),
  windSpeedKts: z.number().positive().max(99).optional(),
  legsEdited: z.boolean().optional(),
});

const _startCourseFromZod: RaceStartCourse = undefined as unknown as z.infer<typeof raceStartCourseSchema>;
const _startCourseFromTs: z.infer<typeof raceStartCourseSchema> = undefined as unknown as RaceStartCourse;
void _startCourseFromZod;
void _startCourseFromTs;

/** Constructed-course legs (ORC rule 402.5), in sailing order. */
export const courseLegsSchema = z
  .array(
    z.object({
      distanceNm: z.number().positive().max(999),
      bearingDeg: z.number().min(0).max(360),
      windDirectionDeg: z.number().min(0).max(360),
      // Recorded true wind speed on the leg. The certificates tabulate
      // 4–24 kt and the module clamps to that range; a wider bound is
      // allowed here so a squall the RC actually logged round-trips.
      windSpeedKts: z.number().positive().max(99).optional(),
      currentSpeedKts: z.number().min(0).max(20).optional(),
      currentDirectionDeg: z.number().min(0).max(360).optional(),
      // The race committee's label for the leg, where the course came
      // with one ("Start – 1").
      name: z.string().trim().min(1).max(80).optional(),
    }),
  )
  .max(60);

export const raceStartSchema = z.object({
  id: uuidSchema,
  raceId: uuidSchema,
  fleetIds: z.array(uuidSchema),
  // Optional: a membership-only start declares fleets with no gun time.
  startTime: wallClockSchema.optional(),
  // Split-fleet series: the stage race this start's fleets are sailing, and
  // the companion-race offset (see RaceStart in lib/types.ts).
  stage: z.enum(STORED_STAGES as [StoredStage, ...StoredStage[]]).optional(),
  stageRaceNumber: z.number().int().positive().optional(),
  firstPlaceOffset: z.number().int().min(0).optional(),
  // Course length in NM — a time-on-distance scoring input, recorded to
  // 0.01 NM by convention (not enforced; the value is what the RC states).
  distanceNm: z.number().positive().max(9999).optional(),
  // Race-committee PCS scoring-wind override (kt), ORC rule 402.12.
  orcScoringWind: z.number().positive().max(99).optional(),
  // ORC wind-band selection: the certificate rating field for this start.
  orcOption: z.string().min(1).max(64).optional(),
  // Constructed-course legs (ORC rule 402.5), in sailing order.
  courseLegs: courseLegsSchema.optional(),
  // The library course those legs came from, as a snapshot (RaceStartCourse).
  course: raceStartCourseSchema.optional(),
  version: versionSchema,
});

export const raceStartInputSchema = raceStartSchema.extend({
  id: uuidSchema.optional(),
});

/**
 * Body for PATCH /api/v1/races/:raceId/starts/:startId: the fields to change,
 * each optional. `null` clears a field; a field left out keeps its value.
 * Split-fleet stage fields stay with the full PUT.
 */
export const raceStartPatchSchema = z
  .object({
    startTime: wallClockSchema.nullable(),
    fleetIds: z.array(uuidSchema),
    distanceNm: raceStartSchema.shape.distanceNm.unwrap().nullable(),
    orcScoringWind: raceStartSchema.shape.orcScoringWind.unwrap().nullable(),
    orcOption: raceStartSchema.shape.orcOption.unwrap().nullable(),
    courseLegs: courseLegsSchema.nullable(),
    course: raceStartCourseSchema.nullable(),
  })
  .partial()
  .strict();

export type RaceStartPatch = z.infer<typeof raceStartPatchSchema>;

/** Bulk-write payload. Mirrors `RaceStartRepository.saveMany`. */
export const raceStartsBulkInputSchema = z.object({
  starts: z.array(raceStartInputSchema),
});

const _raceStartFromZod: RaceStart = undefined as unknown as z.infer<typeof raceStartSchema>;
const _raceStartFromTs: z.infer<typeof raceStartSchema> = undefined as unknown as RaceStart;
void _raceStartFromZod;
void _raceStartFromTs;
