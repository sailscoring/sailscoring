'use client';

// Courses — the library behind ORC constructed courses: the marks a series'
// courses are built from, and the courses a start picks.
// See docs/design/ux/flows/course-builder.md.

import { use, useMemo, useState } from 'react';
import { MoreHorizontal, Plus } from 'lucide-react';
import { formatPosition } from '@sailscoring/course-cards';

import { CourseDialog, type CourseDialogMode } from '@/components/course-library/course-dialog';
import { CourseDrawing } from '@/components/course-library/course-drawing';
import { MarkDialog, type MarkDialogMode } from '@/components/course-library/mark-dialog';
import { useConfirm } from '@/components/confirm-dialog';
import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ValidationApiError } from '@/lib/api-client';
import { COURSE_CARDS_RELEASE, courseCardSetLabel, courseCardSets, findCourseCardSet, loadCourseCard } from '@/lib/course-cards';
import { adoptCardMarks, drawnCourse, drawnMarks, resolveCourse, type NamingContext } from '@/lib/course-geometry';
import type { SeriesCourse, SeriesMark } from '@/lib/types';
import {
  useDeleteSeriesCourse,
  useDeleteSeriesMark,
  useSaveSeriesCourse,
  useSaveSeriesMark,
  useSaveSeriesMarks,
  useSeriesCourses,
  useSeriesMarks,
} from '@/hooks/use-course-library';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useSeriesData } from '@/hooks/use-series-data';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';

const SHOW_CARD_MARKS = 5;

/** Today, as an ISO date in the scorer's own clock — the date a mark made on
 *  the tab is offered under. */
function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CoursesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = use(params);
  const readOnly = useSeriesReadOnly();
  const { can } = useWorkspacePermissions();
  const canEdit = !readOnly && can('manage-series');
  const confirm = useConfirm();

  const data = useSeriesData(seriesId);
  const { data: marks } = useSeriesMarks(seriesId);
  const { data: courses } = useSeriesCourses(seriesId);
  const saveMark = useSaveSeriesMark();
  const saveMarks = useSaveSeriesMarks();
  const deleteMark = useDeleteSeriesMark();
  const saveCourse = useSaveSeriesCourse();
  const deleteCourse = useDeleteSeriesCourse();

  const [markDialog, setMarkDialog] = useState<MarkDialogMode | null>(null);
  const [courseDialog, setCourseDialog] = useState<CourseDialogMode | null>(null);
  const [swapping, setSwapping] = useState<SeriesCourse | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [showAllCardMarks, setShowAllCardMarks] = useState(false);
  const [notice, setNotice] = useState('');

  useShortcuts([
    ...(canEdit
      ? [
          { key: 'n', description: 'New mark', section: 'Courses', handler: () => setMarkDialog({ kind: 'new' }) },
          { key: 'c', description: 'New course', section: 'Courses', handler: () => setCourseDialog({ kind: 'new' }) },
        ]
      : []),
  ]);

  const naming: NamingContext = useMemo(() => ({ date: todayIso() }), []);
  const marksById = useMemo(() => new Map((marks ?? []).map((m) => [m.id, m])), [marks]);

  if (data.status !== 'ready' || marks === undefined || courses === undefined) {
    return <SeriesTabFallback status={data.status === 'missing' ? 'missing' : 'loading'} />;
  }

  const cardMarks = marks.filter((m) => m.card);
  const ownMarks = marks.filter((m) => !m.card);
  const setsInUse = [...new Set(cardMarks.map((m) => m.card!.set))];
  const visibleCardMarks = showAllCardMarks ? cardMarks : cardMarks.slice(0, SHOW_CARD_MARKS);

  async function handleDeleteMark(mark: SeriesMark) {
    const ok = await confirm({
      title: `Delete mark ${mark.name}?`,
      description: 'Starts that sailed a course over it keep their own record of where it was.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteMark.mutateAsync({ seriesId, markId: mark.id });
      setNotice('');
    } catch (e) {
      const issues = e instanceof ValidationApiError ? (e.issues as { code?: string; courses?: string[] } | undefined) : undefined;
      setNotice(
        issues?.code === 'mark-in-use'
          ? `${mark.name} is used by ${issues.courses?.length === 1 ? 'a course' : `${issues.courses?.length ?? 0} courses`}: ${(issues.courses ?? []).join(', ')}. Edit or delete those first.`
          : 'Could not delete the mark.',
      );
    }
  }

  async function handleDeleteCourse(course: SeriesCourse) {
    const ok = await confirm({
      title: `Delete course ${course.name}?`,
      description: 'Starts that sailed it keep their legs and their own record of the course.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    await deleteCourse.mutateAsync({ seriesId, courseId: course.id });
  }

  function describeSequence(course: SeriesCourse): string {
    return course.marks
      .map((cm) => {
        const m = marksById.get(cm.markId);
        const label = m ? (m.card ? m.card.markId : m.name.split(' — ')[0]) : '?';
        return `${label}${cm.side === 'starboard' ? '(s)' : ''}${cm.passing ? '(p)' : ''}`;
      })
      .join(' › ');
  }

  function describeFrom(mark: SeriesMark): string {
    if (!mark.from) return '';
    const origin = marksById.get(mark.from.markId);
    const nm = mark.from.distanceM / 1852;
    return `${nm >= 0.1 ? `${nm.toFixed(2)} NM` : `${Math.round(mark.from.distanceM)} m`} @ ${String(Math.round(mark.from.bearingDeg)).padStart(3, '0')}° from ${origin?.name ?? '?'}`;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          The marks the race committee laid and the club&apos;s charted marks, and the courses built from them.
          A race start picks a course; its legs fill in from there.
        </p>
        {canEdit && (
          <div className="flex gap-2 shrink-0">
            <Button size="sm" variant="outline" onClick={() => setAdopting(true)} data-testid="adopt-card">
              Add marks from a card…
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMarkDialog({ kind: 'new' })} data-testid="new-mark">
              <Plus className="h-4 w-4" />
              New mark
            </Button>
            <Button size="sm" onClick={() => setCourseDialog({ kind: 'new' })} data-testid="new-course">
              <Plus className="h-4 w-4" />
              New course
            </Button>
          </div>
        )}
      </div>
      {notice && <p className="text-sm text-amber-700 dark:text-amber-400" role="status">{notice}</p>}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Marks</h2>
        {marks.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No marks yet. Add the club&apos;s charted marks from its course card, and make the ones the race
              committee laid — the line, the finish, a windward mark — as they are logged.
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {cardMarks.length > 0 && (
              <div>
                <h3 className="text-sm font-medium text-muted-foreground mb-1">
                  From the card{setsInUse.length === 1 ? ` · ${courseCardSetLabel(findCourseCardSet(setsInUse[0]) ?? { club: setsInUse[0], event: '' } as never)}` : ''}
                </h3>
                <MarksTable marks={visibleCardMarks} marksById={marksById} describeFrom={describeFrom} canEdit={canEdit} onEdit={(m) => setMarkDialog({ kind: 'edit', mark: m })} onDelete={handleDeleteMark} />
                {cardMarks.length > SHOW_CARD_MARKS && (
                  <Button variant="link" size="sm" className="px-0" onClick={() => setShowAllCardMarks((v) => !v)}>
                    {showAllCardMarks ? 'Show fewer' : `Show all ${cardMarks.length}`}
                  </Button>
                )}
              </div>
            )}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">This series</h3>
              {ownMarks.length === 0 ? (
                <p className="text-sm text-muted-foreground">None yet — the line, the finish and the laid marks go here.</p>
              ) : (
                <MarksTable marks={ownMarks} marksById={marksById} describeFrom={describeFrom} canEdit={canEdit} onEdit={(m) => setMarkDialog({ kind: 'edit', mark: m })} onDelete={handleDeleteMark} />
              )}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Courses</h2>
        {courses.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No courses yet. Make one from a number on the club&apos;s card, or build one by hand from the marks
              above; a start then picks it from a list.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-md border divide-y">
            {courses.map((course) => {
              const resolved = resolveCourse(course.marks, marksById);
              return (
                <div key={course.id} className="flex items-center gap-3 px-3 py-2 text-sm" data-testid="course-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{course.name}</span>
                      {course.card && (
                        <span className="text-xs text-muted-foreground font-mono">
                          {course.card.courseId}{course.modified ? ' (modified)' : ''}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{describeSequence(course)}</div>
                  </div>
                  <span className="font-mono text-xs text-muted-foreground shrink-0">
                    {resolved.legs.length} legs · {resolved.totalNm.toFixed(2)} NM
                  </span>
                  {canEdit && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${course.name}`}>
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setCourseDialog({ kind: 'edit', course })}>Edit</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setCourseDialog({ kind: 'duplicate', course })}>Duplicate</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setSwapping(course)}>Swap a mark…</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="text-destructive" onSelect={() => void handleDeleteCourse(course)}>Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {marks.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">Drawing</h2>
          <CourseDrawing marks={drawnMarks(marks)} width={640} title="Marks drawing" className="max-w-2xl" />
        </section>
      )}

      <MarkDialog
        mode={markDialog}
        seriesId={seriesId}
        marks={marks}
        naming={naming}
        onSave={async (mark) => {
          await saveMark.mutateAsync(mark);
          setMarkDialog(null);
        }}
        onCancel={() => setMarkDialog(null)}
      />
      <CourseDialog
        mode={courseDialog}
        seriesId={seriesId}
        marks={marks}
        courses={courses}
        naming={naming}
        onSaveMark={(mark) => saveMark.mutateAsync(mark).then(() => undefined)}
        onSaveMarks={(list) => saveMarks.mutateAsync(list)}
        onSave={async (course) => {
          await saveCourse.mutateAsync(course);
          setCourseDialog(null);
        }}
        onCancel={() => setCourseDialog(null)}
      />
      <SwapMarkDialog
        course={swapping}
        marks={marks}
        onSave={async (course) => {
          await saveCourse.mutateAsync(course);
          setSwapping(null);
        }}
        onCancel={() => setSwapping(null)}
      />
      <AdoptCardDialog
        open={adopting}
        seriesId={seriesId}
        marks={marks}
        onAdopt={async (list) => {
          await saveMarks.mutateAsync(list);
          setAdopting(false);
        }}
        onCancel={() => setAdopting(false)}
      />
    </div>
  );
}

function MarksTable({
  marks,
  describeFrom,
  canEdit,
  onEdit,
  onDelete,
}: {
  marks: SeriesMark[];
  marksById: Map<string, SeriesMark>;
  describeFrom: (m: SeriesMark) => string;
  canEdit: boolean;
  onEdit: (m: SeriesMark) => void;
  onDelete: (m: SeriesMark) => void;
}) {
  return (
    <div className="rounded-md border divide-y">
      {marks.map((mark) => (
        <div key={mark.id} className="flex items-center gap-3 px-3 py-1.5 text-sm" data-testid="mark-row">
          <span className="min-w-0 flex-1 truncate">{mark.name}</span>
          <span className="font-mono text-xs text-muted-foreground shrink-0">
            {formatPosition({ lat: mark.lat, lng: mark.lng }, { minuteDecimals: 3 })}
          </span>
          <span className="text-xs text-muted-foreground shrink-0 hidden md:inline">
            {mark.from ? describeFrom(mark) : [mark.shape, mark.color].filter(Boolean).join(', ')}
          </span>
          {canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7" aria-label={`Actions for ${mark.name}`}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(mark)}>Edit</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onSelect={() => onDelete(mark)}>Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      ))}
    </div>
  );
}

/** Swap a mark…: the fastest path to the second course of a race. Picks
 *  one mark of the course and its replacement, and saves the result as a
 *  duplicate — the original stays for the starts that picked it. */
function SwapMarkDialog({
  course,
  marks,
  onSave,
  onCancel,
}: {
  course: SeriesCourse | null;
  marks: SeriesMark[];
  onSave: (course: SeriesCourse) => Promise<void>;
  onCancel: () => void;
}) {
  if (!course) return null;
  return <SwapMarkDialogInner key={course.id} course={course} marks={marks} onSave={onSave} onCancel={onCancel} />;
}

function SwapMarkDialogInner({
  course,
  marks,
  onSave,
  onCancel,
}: {
  course: SeriesCourse;
  marks: SeriesMark[];
  onSave: (course: SeriesCourse) => Promise<void>;
  onCancel: () => void;
}) {
  const byId = new Map(marks.map((m) => [m.id, m]));
  const inCourse = [...new Set(course.marks.map((cm) => cm.markId))].map((id) => byId.get(id)).filter((m): m is SeriesMark => !!m);
  const [fromId, setFromId] = useState(inCourse.find((m) => !m.card)?.id ?? inCourse[0]?.id ?? '');
  const [toId, setToId] = useState('');
  const [name, setName] = useState(course.name);
  const [error, setError] = useState('');
  const swapped = fromId && toId ? course.marks.map((cm) => (cm.markId === fromId ? { ...cm, markId: toId } : cm)) : course.marks;
  const drawing = {
    marks: drawnMarks(marks.filter((m) => swapped.some((cm) => cm.markId === m.id))),
    course: drawnCourse(swapped),
  };

  async function handleSave() {
    if (!fromId || !toId) {
      setError('Pick the mark to replace and its replacement.');
      return;
    }
    if (!name.trim()) {
      setError('Give the new course a name.');
      return;
    }
    await onSave({
      id: crypto.randomUUID(),
      seriesId: course.seriesId,
      name: name.trim(),
      marks: swapped,
      createdAt: Date.now(),
      ...(course.card ? { card: course.card } : {}),
      ...(course.modified ? { modified: true } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]">
        <DialogHeader>
          <DialogTitle>Swap a mark</DialogTitle>
          <DialogDescription>
            A duplicate of {course.name} with one mark exchanged — the second windward mark, the re-laid finish.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 min-h-0 overflow-y-auto pr-1">
          <div className="grid grid-cols-[4rem_1fr] items-center gap-2 text-sm">
            <span>Replace</span>
            <Select value={fromId} onValueChange={(v) => { setFromId(v); setError(''); }}>
              <SelectTrigger className="w-full min-w-0" aria-label="Mark to replace" data-testid="swap-from"><SelectValue /></SelectTrigger>
              <SelectContent>
                {inCourse.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>with</span>
            <Select value={toId} onValueChange={(v) => { setToId(v); setError(''); }}>
              <SelectTrigger className="w-full min-w-0" aria-label="Replacement mark" data-testid="swap-to"><SelectValue placeholder="Pick a mark" /></SelectTrigger>
              <SelectContent>
                {marks.filter((m) => m.id !== fromId).map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span>Name</span>
            <input
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              aria-label="New course name"
            />
          </div>
          <CourseDrawing marks={drawing.marks} course={drawing.course} width={480} title="Course drawing" />
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => void handleSave()} data-testid="swap-save">Save as new course</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Add marks from a card…: adopt a set's charted marks into the library
 *  (idempotent — re-adopting refreshes positions and keeps the scorer's
 *  names). The line is the card's where the club fixes it. */
function AdoptCardDialog(props: {
  open: boolean;
  seriesId: string;
  marks: SeriesMark[];
  onAdopt: (marks: SeriesMark[]) => Promise<void>;
  onCancel: () => void;
}) {
  if (!props.open) return null;
  return <AdoptCardDialogInner {...props} />;
}

function AdoptCardDialogInner({
  seriesId,
  marks,
  onAdopt,
  onCancel,
}: {
  seriesId: string;
  marks: SeriesMark[];
  onAdopt: (marks: SeriesMark[]) => Promise<void>;
  onCancel: () => void;
}) {
  const sets = courseCardSets();
  const [setPath, setSetPath] = useState(sets[0]?.path ?? '');
  const [cardId, setCardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openedAt] = useState(() => Date.now());
  const set = findCourseCardSet(setPath);
  const effectiveCardId = set?.cards.some((c) => c.id === cardId) ? cardId : set?.cards[0]?.id ?? '';

  async function handleAdopt() {
    if (!set || !effectiveCardId) return;
    setBusy(true);
    try {
      const { marks: marksFile, cardFile } = await loadCourseCard(set.path, effectiveCardId);
      await onAdopt(adoptCardMarks(marksFile, cardFile, { set: set.path, release: COURSE_CARDS_RELEASE }, seriesId, marks, openedAt));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load the card.');
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add marks from a card</DialogTitle>
          <DialogDescription>
            The club&apos;s charted marks, at the positions its card gives. Marks laid per race stay yours to make.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Select value={setPath} onValueChange={(v) => { setSetPath(v); setCardId(''); }}>
            <SelectTrigger className="w-full min-w-0" aria-label="Course card set" data-testid="adopt-card-set"><SelectValue /></SelectTrigger>
            <SelectContent>
              {sets.map((s) => (
                <SelectItem key={s.path} value={s.path}>{courseCardSetLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={effectiveCardId} onValueChange={setCardId} disabled={!set}>
            <SelectTrigger className="w-full min-w-0" aria-label="Course card" data-testid="adopt-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(set?.cards ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {set && <p className="text-xs text-muted-foreground">{set.marks.count} marks on the set&apos;s sheet.</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={() => void handleAdopt()} disabled={busy || !set} data-testid="adopt-save">Add marks</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
