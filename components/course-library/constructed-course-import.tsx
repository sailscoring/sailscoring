'use client';

import { useMemo, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { CourseDrawing } from '@/components/course-library/course-drawing';
import type { Variation } from '@/lib/bearings';
import { drawnStartCourse } from '@/lib/course-geometry';
import {
  constructedCourseSummary,
  importedCourseLegs,
  parseConstructedCourse,
  snapshotOfImportedCourse,
  type ConstructedCourse,
} from '@/lib/orc-constructed-course';

/**
 * Taking an ORC constructed course into a race start: a document from an
 * app that builds courses (docs/design/orc/constructed-course-format.md),
 * pasted or picked as a file. What it holds is shown — its name, legs and
 * length, whether it carries the wind, and the drawing — before anything
 * reaches the start, and a document that can't be read says why.
 *
 * The document's directions are magnetic and the start stores true, so it
 * needs a variation: at the course's anchor, or the venue on the race's
 * day. The caller says what that is; with neither, the course can't be
 * used, and the panel says what to set.
 */
export function ConstructedCourseImport({
  variationAt,
  librarySet,
  onUse,
  onCancel,
}: {
  /** The variation where a course is (its anchor, else the venue) on the
   *  race's day; undefined where there is nowhere to read one. */
  variationAt: (anchor: { lat: number; lng: number } | undefined) => Variation | undefined;
  /** The series' own chart, preferred under an anchored course. */
  librarySet?: string;
  onUse: (course: ConstructedCourse, variation: Variation) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState('');
  const [fileError, setFileError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const read = useMemo(() => (text.trim() ? parseConstructedCourse(text) : null), [text]);
  const course = read?.ok ? read.course : undefined;
  const variation = useMemo(() => (course ? variationAt(course.anchor) : undefined), [course, variationAt]);
  const drawing = useMemo(() => {
    if (!course || !variation) return null;
    return drawnStartCourse(snapshotOfImportedCourse(course, importedCourseLegs(course, variation)), librarySet);
  }, [course, variation, librarySet]);

  async function pickFile(file: File | undefined) {
    setFileError('');
    if (!file) return;
    try {
      setText(await file.text());
    } catch {
      setFileError(`${file.name} couldn’t be read.`);
    }
  }

  return (
    <div className="space-y-1.5 rounded-md border p-2" data-testid="import-course">
      <textarea
        aria-label="Course to import"
        className="w-full h-28 rounded-md border border-input bg-transparent px-2 py-1 text-xs font-mono"
        value={text}
        placeholder={'{ "format": "orc-constructed-course", "version": 1, … }'}
        onChange={(e) => { setText(e.target.value); setFileError(''); }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          aria-label="Course file"
          className="hidden"
          onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        <Button type="button" variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
          Choose a file…
        </Button>
        <span className="text-xs text-muted-foreground">or paste the course its app gave you.</span>
      </div>
      <p
        className={`text-xs ${read && !read.ok ? 'text-destructive' : 'text-muted-foreground'}`}
        data-testid="import-course-preview"
      >
        {fileError
          || (read == null
            ? 'An ORC constructed course, as an app that builds courses hands it over: each leg’s distance and course in degrees magnetic, usually with the wind.'
            : !read.ok
              ? read.error
              : `${course!.name ? `${course!.name} · ` : ''}${constructedCourseSummary(course!)}`)}
      </p>
      {course && !variation && (
        <p className="text-xs text-destructive" data-testid="import-course-no-variation">
          Its directions are magnetic, and there is nowhere to read the variation at: the course
          has no anchor, and the series has no venue position. Set the venue position on the
          Courses tab.
        </p>
      )}
      {drawing && (
        <CourseDrawing
          marks={drawing.marks}
          course={drawing.course}
          set={drawing.set}
          route={false}
          variation={variation}
          width={440}
          title="Drawing of the course to import"
        />
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!course || !variation}
          onClick={() => { if (course && variation) onUse(course, variation); }}
          data-testid="import-course-use"
        >
          Use this course
        </Button>
      </div>
    </div>
  );
}
