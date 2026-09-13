import { z } from 'zod';

import type { RaceStartCourse, SeriesCourse, SeriesMark } from '@/lib/types';

import { uuidSchema, versionSchema } from './common';

/** The course library (ORC constructed courses): marks, courses, and the
 *  snapshot a start keeps of the course it sailed. */

const nameSchema = z.string().trim().min(1).max(80);
const latSchema = z.number().min(-90).max(90);
const lngSchema = z.number().min(-180).max(180);
const bearingSchema = z.number().min(0).max(360);
const sideSchema = z.enum(['port', 'starboard']);
/** A course may not exceed the leg table it fills (60 legs = 61 marks). */
const MAX_COURSE_MARKS = 61;
const MAX_COURSE_LEGS = MAX_COURSE_MARKS - 1;

/** One leg of a course defined by the committee's leg table. The distance
 *  bound matches a start's own legs; the course carries no wind. */
export const seriesCourseLegSchema = z.object({
  distanceNm: z.number().positive().max(999),
  bearingDeg: bearingSchema,
});

export const seriesMarkSchema = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  name: nameSchema,
  lat: latSchema,
  lng: lngSchema,
  card: z
    .object({
      set: z.string().min(1).max(200),
      markId: z.string().min(1).max(40),
      release: z.string().min(1).max(40),
    })
    .optional(),
  shape: z.string().max(80).optional(),
  color: z.string().max(80).optional(),
  from: z
    .object({
      markId: uuidSchema,
      bearingDeg: bearingSchema,
      distanceM: z.number().positive().max(200_000),
    })
    .optional(),
  createdAt: z.number(),
  version: versionSchema,
});

export const seriesMarkInputSchema = seriesMarkSchema.extend({ id: uuidSchema.optional() });

export const seriesCourseMarkSchema = z.object({
  markId: uuidSchema,
  side: sideSchema.optional(),
  passing: z.boolean().optional(),
});

/** The fields, unrefined — the refinement below goes on each schema derived
 *  from this rather than on this, because zod refuses `.extend` on a schema
 *  that already carries one. */
const seriesCourseFields = z.object({
  id: uuidSchema,
  seriesId: uuidSchema,
  name: nameSchema,
  card: z
    .object({
      set: z.string().min(1).max(200),
      cardId: z.string().min(1).max(80),
      courseId: z.string().min(1).max(40),
      release: z.string().min(1).max(40),
    })
    .optional(),
  modified: z.boolean().optional(),
  marks: z.array(seriesCourseMarkSchema).max(MAX_COURSE_MARKS),
  legs: z.array(seriesCourseLegSchema).max(MAX_COURSE_LEGS).optional(),
  createdAt: z.number(),
  version: versionSchema,
});

/** Exactly one definition, which is the invariant `courseLegsOf` reads: a
 *  course carrying both would score one way and draw the other, and one
 *  carrying neither has no geometry at all. */
const ONE_DEFINITION = {
  check: (c: { marks: unknown[]; legs?: unknown[] }) =>
    (c.marks.length > 0) !== ((c.legs?.length ?? 0) > 0),
  error: {
    message: 'A course is defined either by its marks or by a leg table, and needs one of them',
    path: ['legs'] as const,
  },
};

export const seriesCourseSchema = seriesCourseFields.refine(
  ONE_DEFINITION.check,
  { message: ONE_DEFINITION.error.message, path: [...ONE_DEFINITION.error.path] },
);

export const seriesCourseInputSchema = seriesCourseFields
  .extend({ id: uuidSchema.optional() })
  .refine(ONE_DEFINITION.check, { message: ONE_DEFINITION.error.message, path: [...ONE_DEFINITION.error.path] });

export const raceStartCourseSchema = z.object({
  courseId: uuidSchema.optional(),
  name: nameSchema,
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
      }),
    )
    .max(MAX_COURSE_MARKS),
  legs: z.array(seriesCourseLegSchema).max(MAX_COURSE_LEGS).optional(),
  windDirectionDeg: bearingSchema.optional(),
  windSpeedKts: z.number().positive().max(99).optional(),
  legsEdited: z.boolean().optional(),
});

/** Bulk-write payloads, mirroring the repositories' `saveMany`. */
export const seriesMarksBulkInputSchema = z.object({ marks: z.array(seriesMarkInputSchema) });
export const seriesCoursesBulkInputSchema = z.object({ courses: z.array(seriesCourseInputSchema) });

const _markFromZod: SeriesMark = undefined as unknown as z.infer<typeof seriesMarkSchema>;
const _markFromTs: z.infer<typeof seriesMarkSchema> = undefined as unknown as SeriesMark;
const _courseFromZod: SeriesCourse = undefined as unknown as z.infer<typeof seriesCourseSchema>;
const _courseFromTs: z.infer<typeof seriesCourseSchema> = undefined as unknown as SeriesCourse;
const _startCourseFromZod: RaceStartCourse = undefined as unknown as z.infer<typeof raceStartCourseSchema>;
const _startCourseFromTs: z.infer<typeof raceStartCourseSchema> = undefined as unknown as RaceStartCourse;
void _markFromZod;
void _markFromTs;
void _courseFromZod;
void _courseFromTs;
void _startCourseFromZod;
void _startCourseFromTs;
