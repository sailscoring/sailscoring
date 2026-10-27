'use client';

import { useEffect, useMemo, useState } from 'react';
import { renderCourseSvg, type DrawnCourseMark, type DrawnMark } from '@sailscoring/course-cards';

import type { Variation } from '@/lib/bearings';
import { loadCourseBackground, type CourseBackground } from '@/lib/course-cards';

/**
 * A start's course drawn: the course-cards library's own inert SVG — no
 * script, no stylesheet, no ids — rendered inline. A sanity check as much as
 * a picture: a leg that went in wrong should be obviously wrong at a glance,
 * so it redraws as the legs are edited.
 *
 * `set` is the course-cards data set whose chart covers the course, and its
 * captured chart is drawn under it — the same water the club's own card page
 * shows. It arrives after the drawing does: the image is a few hundred
 * kilobytes, and waiting for it would mean waiting to show the legs.
 *
 * `variation` labels the legs' bearings in magnetic, as the figures beside
 * the drawing are; without it they are labelled true. A course kept in
 * magnetic (`north="magnetic"`) has nothing to convert by: its legs are
 * drawn as their figures are, so magnetic north is up, and labelled °M.
 */
export function CourseDrawing({
  marks,
  course,
  width = 560,
  title,
  className,
  set,
  variation,
  north,
}: {
  marks: DrawnMark[];
  course?: DrawnCourseMark[];
  width?: number;
  title?: string;
  className?: string;
  set?: string;
  variation?: Variation;
  north?: 'magnetic';
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

  const svg = useMemo(
    () => renderCourseSvg(marks, course ?? [], {
      width,
      ...(title ? { title } : {}),
      ...(background ? { background } : {}),
      ...(variation ? { magneticVariationDeg: variation.deg } : north === 'magnetic' ? { magneticVariationDeg: 0 } : {}),
    }),
    [marks, course, width, title, background, variation, north],
  );
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
