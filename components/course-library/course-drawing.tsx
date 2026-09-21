'use client';

import { useEffect, useMemo, useState } from 'react';
import { renderCourseSvg, type DrawnCourseMark, type DrawnMark } from '@sailscoring/course-cards';

import { loadCourseBackground, type CourseBackground } from '@/lib/course-cards';

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
 */
export function CourseDrawing({
  marks,
  course,
  highlight,
  width = 560,
  title,
  className,
  set,
}: {
  marks: DrawnMark[];
  course?: DrawnCourseMark[];
  highlight?: string;
  width?: number;
  title?: string;
  className?: string;
  set?: string;
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
    () =>
      renderCourseSvg(marks, course ?? [], {
        width,
        ...(highlight ? { highlight } : {}),
        ...(title ? { title } : {}),
        ...(background ? { background } : {}),
      }),
    [marks, course, highlight, width, title, background],
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
