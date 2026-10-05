'use client';

import { useEffect, useMemo, useState } from 'react';
import { renderCourseSvg, type DrawnCourseMark, type DrawnMark } from '@sailscoring/course-cards';

import type { Variation } from '@/lib/bearings';
import { loadCourseBackground, type CourseBackground } from '@/lib/course-cards';
import { routedDrawing } from '@/lib/course-geometry';

/**
 * The course-library drawing: the library's own inert SVG — no script, no
 * stylesheet, no ids — rendered inline. A sanity check as much as a picture:
 * a coordinate that went in wrong should be obviously wrong at a glance, so
 * it redraws as positions and sequences are edited.
 *
 * `set` is the course-cards data set the marks were adopted from, and its
 * captured chart is drawn under them — the same water the club's own card
 * page shows. It arrives after the drawing does: the image is a few hundred
 * kilobytes, and waiting for it would mean waiting to show the marks.
 *
 * `variation` labels the legs' bearings in magnetic, as the figures beside
 * the drawing are; without it they are labelled true.
 *
 * Where the set has a routing overlay, a leg it routes round an obstruction
 * is drawn through the passage, lettered as the legs it is scored as. A
 * caller showing legs already scored passes how many as `scoredLegs`, and a
 * drawing that would route them into a different number — a start scored
 * before the overlay — is drawn straight, as it was scored.
 */
export function CourseDrawing({
  marks,
  course,
  highlight,
  width = 560,
  title,
  className,
  set,
  variation,
  scoredLegs,
}: {
  marks: DrawnMark[];
  course?: DrawnCourseMark[];
  highlight?: string;
  width?: number;
  title?: string;
  className?: string;
  set?: string;
  variation?: Variation;
  scoredLegs?: number;
}) {
  // Held with the set it belongs to, so switching sets draws on plain ground
  // until the new chart is in rather than briefly on the old club's water.
  const [loaded, setLoaded] = useState<{ set: string; chart: CourseBackground } | null>(null);
  useEffect(() => {
    if (!set) return;
    let live = true;
    void loadCourseBackground(set).then((chart) => {
      if (live && chart) setLoaded({ set, chart });
    });
    return () => {
      live = false;
    };
  }, [set]);
  const background = set && loaded?.set === set ? loaded.chart : undefined;

  const svg = useMemo(() => {
    const routed = routedDrawing(marks, course ?? [], set, highlight);
    const drawn = scoredLegs == null || routed.legCount === scoredLegs
      ? routed
      : { marks, course: course ?? [], highlight, routing: undefined };
    return renderCourseSvg(drawn.marks, drawn.course, {
      width,
      ...(drawn.highlight ? { highlight: drawn.highlight } : {}),
      ...(title ? { title } : {}),
      ...(background ? { background } : {}),
      ...(variation ? { magneticVariationDeg: variation.deg } : {}),
      ...(drawn.routing ? { routing: drawn.routing } : {}),
    });
  }, [marks, course, highlight, width, title, background, variation, set, scoredLegs]);
  if (!svg) {
    return (
      <div
        className={`flex items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground ${className ?? ''}`}
        style={{ minHeight: 120 }}
        data-testid="course-drawing-empty"
      >
        Nothing to draw yet
      </div>
    );
  }
  return (
    <div
      className={`overflow-hidden rounded-md border [&>svg]:h-auto [&>svg]:w-full ${className ?? ''}`}
      data-testid="course-drawing"
      data-chart={background ? 'set' : undefined}
      // The string is the library's own output for our data: one SVG
      // element, no script, and no resource it did not embed itself.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
