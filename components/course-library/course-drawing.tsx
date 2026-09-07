'use client';

import { useMemo } from 'react';
import { renderCourseSvg, type DrawnCourseMark, type DrawnMark } from '@sailscoring/course-cards';

/**
 * The course-library drawing: the library's own inert SVG — no script, no
 * stylesheet, no ids — rendered inline. A sanity check, not a chart: a
 * coordinate that went in wrong should be obviously wrong at a glance, so
 * it redraws as positions and sequences are edited.
 */
export function CourseDrawing({
  marks,
  course,
  highlight,
  width = 560,
  title,
  className,
}: {
  marks: DrawnMark[];
  course?: DrawnCourseMark[];
  highlight?: string;
  width?: number;
  title?: string;
  className?: string;
}) {
  const svg = useMemo(
    () => renderCourseSvg(marks, course ?? [], { width, ...(highlight ? { highlight } : {}), ...(title ? { title } : {}) }),
    [marks, course, highlight, width, title],
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
      // The string is the library's own output for our data: one SVG
      // element, no script, no external resource.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
