'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CourseCardFile, MarksFile } from '@sailscoring/course-cards';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { COURSE_CARDS_RELEASE, courseCardSetLabel, courseCardSets, findCourseCardSet, loadCourseCard } from '@/lib/course-cards';
import {
  adoptCardMarks,
  courseFromCard,
  drawnCourse,
  drawnMarks,
  matchCardCourse,
  proposeCourseName,
  resolveCourse,
  sequenceMatchesCard,
  unplacedEntries,
  type CardCourseEntry,
  type NamingContext,
} from '@/lib/course-geometry';
import type { SeriesCourse, SeriesCourseMark, SeriesMark } from '@/lib/types';

import { CourseDrawing } from './course-drawing';
import { MarkDialog, type MarkDialogMode } from './mark-dialog';
import { SequenceEditor } from './sequence-editor';

export type CourseDialogMode =
  | { kind: 'new' }
  | { kind: 'edit'; course: SeriesCourse }
  | { kind: 'duplicate'; course: SeriesCourse };

const INPUT = 'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm';
const NEW_MARK = '__new__';

/**
 * New / Edit course. From a course on the card — pick the set, the card and
 * the number; the dialog lists exactly the marks the card cannot place
 * itself, each a pick from the library with New mark… at the bottom — or
 * built by hand from an empty sequence. Either way the sequence editor is
 * reachable, and a course edited away from the card's own keeps the number
 * for provenance and says so.
 */
export function CourseDialog({
  mode,
  seriesId,
  marks,
  courses,
  naming,
  onSaveMark,
  onSaveMarks,
  onSave,
  onCancel,
}: {
  mode: CourseDialogMode | null;
  seriesId: string;
  marks: SeriesMark[];
  courses: SeriesCourse[];
  naming: NamingContext;
  /** Save one scorer-made mark (the inline New mark…). */
  onSaveMark: (mark: SeriesMark) => Promise<void>;
  /** Adopt a card set's marks (idempotent). */
  onSaveMarks: (marks: SeriesMark[]) => Promise<void>;
  onSave: (course: SeriesCourse) => Promise<void>;
  onCancel: () => void;
}) {
  if (!mode) return null;
  return (
    <CourseDialogInner
      key={mode.kind === 'new' ? 'new' : `${mode.kind}:${mode.course.id}`}
      mode={mode}
      seriesId={seriesId}
      marks={marks}
      courses={courses}
      naming={naming}
      onSaveMark={onSaveMark}
      onSaveMarks={onSaveMarks}
      onSave={onSave}
      onCancel={onCancel}
    />
  );
}

function CourseDialogInner({
  mode,
  seriesId,
  marks,
  courses,
  naming,
  onSaveMark,
  onSaveMarks,
  onSave,
  onCancel,
}: {
  mode: CourseDialogMode;
  seriesId: string;
  marks: SeriesMark[];
  courses: SeriesCourse[];
  naming: NamingContext;
  onSaveMark: (mark: SeriesMark) => Promise<void>;
  onSaveMarks: (marks: SeriesMark[]) => Promise<void>;
  onSave: (course: SeriesCourse) => Promise<void>;
  onCancel: () => void;
}) {
  const editing = mode.kind === 'edit' ? mode.course : null;
  const seed = mode.kind === 'new' ? null : mode.course;
  const sets = courseCardSets();
  // The card offered first: the one the most recent course was made from.
  const recentCard = [...courses].sort((a, b) => b.createdAt - a.createdAt).find((c) => c.card)?.card;
  // The set offered first is one the library's marks came from. A card course
  // resolves against marks already adopted, so any other set is a choice that
  // cannot work — the dialog would just report marks it can't place. The most
  // recent course's card breaks the tie when the library holds several sets.
  const setsInUse = [...new Set(marks.filter((m) => m.card).map((m) => m.card!.set))];
  const defaultSet =
    (recentCard && setsInUse.includes(recentCard.set) ? recentCard.set : undefined) ??
    setsInUse[0] ??
    recentCard?.set ??
    sets[0]?.path ??
    '';

  const [source, setSource] = useState<'card' | 'hand'>(seed ? (seed.card ? 'card' : 'hand') : sets.length > 0 ? 'card' : 'hand');
  const [setPath, setSetPath] = useState(seed?.card?.set ?? defaultSet);
  const set = findCourseCardSet(setPath);
  const [cardId, setCardId] = useState(seed?.card?.cardId ?? recentCard?.cardId ?? '');
  const effectiveCardId = set?.cards.some((c) => c.id === cardId) ? cardId : set?.cards[0]?.id ?? '';
  const [courseId, setCourseId] = useState(seed?.card?.courseId ?? '');
  const [loaded, setLoaded] = useState<{ key: string; marksFile: MarksFile; cardFile: CourseCardFile } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [placements, setPlacements] = useState<Record<string, string>>({});
  // The name follows the card course until the scorer types one.
  const [typedName, setTypedName] = useState(seed ? (mode.kind === 'duplicate' ? `${seed.name} (copy)` : seed.name) : '');
  const [nameTouched, setNameTouched] = useState(Boolean(seed));
  const [openedAt] = useState(() => Date.now());
  // The sequence as edited by hand; null while it follows the card.
  const [edited, setEdited] = useState<SeriesCourseMark[] | null>(seed ? seed.marks : null);
  const [editorOpen, setEditorOpen] = useState(Boolean(seed && !seed.card));
  const [markDialog, setMarkDialog] = useState<(MarkDialogMode & { forCardMark?: string }) | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  // Load the chosen card.
  const loadKey = source === 'card' && set && effectiveCardId ? `${setPath}/${effectiveCardId}` : '';
  useEffect(() => {
    if (!loadKey || loaded?.key === loadKey) return;
    let cancelled = false;
    loadCourseCard(setPath, effectiveCardId)
      .then((r) => { if (!cancelled) setLoaded({ key: loadKey, marksFile: r.marks, cardFile: r.cardFile }); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Could not load the card.'); });
    return () => { cancelled = true; };
  }, [loadKey, loaded?.key, setPath, effectiveCardId]);
  const card = loaded?.key === loadKey ? loaded : null;

  // The library as it will be once the set's marks are adopted: the rows
  // already there keep their ids, so a course built against this list is
  // valid after the adoption that saving performs.
  const adopted = useMemo(
    () => (card && set ? adoptCardMarks(card.marksFile, card.cardFile, { set: set.path, release: COURSE_CARDS_RELEASE }, seriesId, marks, openedAt) : []),
    [card, set, seriesId, marks, openedAt],
  );
  const library = useMemo(() => {
    const adoptedIds = new Set(adopted.map((m) => m.id));
    return [...marks.filter((m) => !adoptedIds.has(m.id)), ...adopted];
  }, [marks, adopted]);
  const libraryById = useMemo(() => new Map(library.map((m) => [m.id, m])), [library]);

  // The card course matched to the library.
  const entries: CardCourseEntry[] | null = useMemo(() => {
    if (source !== 'card' || !card || !set || !courseId) return null;
    try {
      return matchCardCourse(card.cardFile, card.marksFile, courseId, set.path, library, placements);
    } catch {
      return null;
    }
  }, [source, card, set, courseId, library, placements]);
  const needed = entries ? unplacedEntries(entries) : [];
  const cardSequence: SeriesCourseMark[] | null = useMemo(
    () =>
      entries && entries.every((e) => e.mark)
        ? entries.map((e) => ({ markId: e.mark!.id, ...(e.resolved.entry.side ? { side: e.resolved.entry.side } : {}), ...(e.resolved.entry.passing ? { passing: true } : {}) }))
        : null,
    [entries],
  );
  const sequence: SeriesCourseMark[] = useMemo(() => edited ?? cardSequence ?? [], [edited, cardSequence]);
  const resolved = useMemo(() => resolveCourse(sequence, libraryById), [sequence, libraryById]);
  const modified = source === 'card' && entries && needed.length === 0 && edited
    ? !sequenceMatchesCard(edited, libraryById, entries.map((e) => e.resolved))
    : false;

  const name = nameTouched ? typedName : source === 'card' && courseId ? proposeCourseName(courseId, naming) : '';

  const drawing = useMemo(() => {
    const used = new Set(sequence.map((cm) => cm.markId));
    return { marks: drawnMarks(library.filter((m) => used.has(m.id))), course: drawnCourse(sequence.filter((cm) => libraryById.has(cm.markId))) };
  }, [sequence, library, libraryById]);

  const scorerMarks = library.filter((m) => !m.card);

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Give the course a name.');
      return;
    }
    if (source === 'card' && !edited) {
      if (!entries) {
        setError('Pick a course on the card.');
        return;
      }
      if (needed.length > 0) {
        setError(`Pick a mark for ${needed.map((e) => e.resolved.mark.id).join(', ')}, or make one.`);
        return;
      }
    }
    if (sequence.length < 2) {
      setError('A course needs at least the start line and one mark.');
      return;
    }
    setSaving(true);
    try {
      // Adopt the set's marks the library does not have yet, then the course.
      const have = new Set(marks.map((m) => m.id));
      const usedAdopted = adopted.filter((m) => !have.has(m.id) && sequence.some((cm) => cm.markId === m.id));
      if (usedAdopted.length > 0) await onSaveMarks(usedAdopted);
      const cardRef = source === 'card' && set && entries && !edited
        ? { set: set.path, cardId: effectiveCardId, release: COURSE_CARDS_RELEASE }
        : null;
      const base: SeriesCourse =
        cardRef && entries
          ? courseFromCard(entries, cardRef, courseId, seriesId, trimmed, Date.now())
          : {
              id: crypto.randomUUID(),
              seriesId,
              name: trimmed,
              marks: sequence,
              createdAt: Date.now(),
              ...(source === 'card' && set && courseId
                ? { card: { set: set.path, cardId: effectiveCardId, courseId, release: COURSE_CARDS_RELEASE }, modified }
                : {}),
            };
      await onSave(editing ? { ...base, id: editing.id, createdAt: editing.createdAt, version: editing.version } : base);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the course.');
      setSaving(false);
    }
  }

  const summary = resolved.legs.length > 0 ? `${resolved.legs.length} leg${resolved.legs.length === 1 ? '' : 's'} · ${resolved.totalNm.toFixed(2)} NM` : '';

  return (
    <>
      <Dialog open onOpenChange={(open) => { if (!open && !markDialog) onCancel(); }}>
        <DialogContent
          className="max-w-xl max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]"
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); void handleSave(); } }}
        >
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit course' : mode.kind === 'duplicate' ? 'Duplicate course' : 'New course'}</DialogTitle>
            <DialogDescription>
              A named sequence of marks a start can pick: a course on the club&apos;s card, or one built by hand.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 min-h-0 overflow-y-auto pr-1">
            {!editing && (
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="course-source" checked={source === 'card'} disabled={sets.length === 0} onChange={() => { setSource('card'); setEdited(null); setEditorOpen(false); setError(''); }} />
                  A course on the card
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="radio" name="course-source" checked={source === 'hand'} onChange={() => { setSource('hand'); setEdited(edited ?? []); setEditorOpen(true); setError(''); }} />
                  Build by hand
                </label>
              </div>
            )}
            {source === 'card' && (
              <div className="space-y-2">
                {/* w-full min-w-0 on every trigger below: the select trigger is
                    w-fit and whitespace-nowrap by default, and a card name runs
                    well past half this dialog. In a grid track that overflows
                    the track rather than clamping, so the two triggers draw on
                    top of each other; min-w-0 lets them shrink and the value's
                    line-clamp do its job. */}
                <div className="grid grid-cols-2 gap-2">
                  <Select value={setPath} onValueChange={(v) => { setSetPath(v); setCourseId(''); setPlacements({}); setEdited(null); setError(''); setLoadError(''); }} disabled={Boolean(editing)}>
                    <SelectTrigger className="w-full min-w-0" aria-label="Course card set" data-testid="course-card-set"><SelectValue placeholder="Club and event" /></SelectTrigger>
                    <SelectContent>
                      {sets.map((s) => (
                        <SelectItem key={s.path} value={s.path}>{courseCardSetLabel(s)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={effectiveCardId} onValueChange={(v) => { setCardId(v); setCourseId(''); setPlacements({}); setEdited(null); setError(''); setLoadError(''); }} disabled={Boolean(editing) || !set}>
                    <SelectTrigger className="w-full min-w-0" aria-label="Course card" data-testid="course-card"><SelectValue placeholder="Card" /></SelectTrigger>
                    <SelectContent>
                      {(set?.cards ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {loadError && <p className="text-sm text-destructive">{loadError}</p>}
                <div className="grid grid-cols-[auto_1fr] items-center gap-2 text-sm">
                  <span>Course</span>
                  <Select value={courseId} onValueChange={(v) => { setCourseId(v); setPlacements({}); setEdited(null); setEditorOpen(false); setError(''); }} disabled={!card || Boolean(editing)}>
                    <SelectTrigger className="w-full min-w-0" aria-label="Course number" data-testid="course-number">
                      <SelectValue placeholder={card ? 'Pick the course the committee boat showed' : 'Loading the card…'} />
                    </SelectTrigger>
                    <SelectContent>
                      {(card?.cardFile.courses ?? []).map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          <span className="font-mono">{c.id}</span>
                          <span className="ml-2 text-muted-foreground text-xs">
                            {c.marks.map((m) => `${m.mark}${m.passing ? '(p)' : ''}`).join(' › ')}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {entries && (
                  <div className="space-y-1.5 rounded-md border p-3">
                    <p className="text-xs font-medium">Marks</p>
                    {entries.filter((e) => !e.resolved.placed).map((e) => {
                      const cardMark = e.resolved.mark;
                      const chosen = placements[cardMark.id] ?? '';
                      return (
                        <div key={cardMark.id} className="grid grid-cols-[3rem_1fr] items-center gap-2 text-sm">
                          <span className="font-mono">{cardMark.id}</span>
                          <div>
                            <Select
                              value={chosen}
                              onValueChange={(v) => {
                                if (v === NEW_MARK) {
                                  setMarkDialog({ kind: 'new', proposedBase: cardMark.name && cardMark.name !== cardMark.id ? `${cardMark.id}` : cardMark.id, forCardMark: cardMark.id });
                                } else {
                                  setPlacements((p) => ({ ...p, [cardMark.id]: v }));
                                  setEdited(null);
                                  setError('');
                                }
                              }}
                            >
                              <SelectTrigger className="w-full min-w-0" aria-label={`Mark for ${cardMark.id}`} data-testid={`placement-${cardMark.id}`}>
                                <SelectValue placeholder={`needs one — ${cardMark.placement ?? cardMark.name ?? ''}`} />
                              </SelectTrigger>
                              <SelectContent>
                                {scorerMarks.map((m) => (
                                  <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                ))}
                                <SelectItem value={NEW_MARK}>New mark…</SelectItem>
                              </SelectContent>
                            </Select>
                            {!chosen && cardMark.placement && (
                              <p className="text-xs text-muted-foreground mt-0.5">{cardMark.placement}</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {entries.some((e) => e.resolved.placed) && (
                      <p className="text-xs text-muted-foreground">
                        {[...new Set(entries.filter((e) => e.resolved.placed).map((e) => e.resolved.mark.id))].join(', ')} come from the card.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="course-name">Name</label>
              <input
                id="course-name"
                className={INPUT}
                value={name}
                onChange={(e) => { setTypedName(e.target.value); setNameTouched(true); setError(''); }}
                placeholder="004 outer — 6 Sep R2"
              />
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground" data-testid="course-summary">
                {summary}
                {modified && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">{courseId} (modified)</span>}
              </span>
              {source === 'card' && !editorOpen && (
                <Button type="button" variant="outline" size="sm" disabled={sequence.length === 0} onClick={() => { setEdited(sequence); setEditorOpen(true); }}>
                  Edit sequence…
                </Button>
              )}
            </div>
            {editorOpen && (
              <SequenceEditor
                sequence={sequence}
                marks={library}
                onChange={(next) => { setEdited(next); setError(''); }}
                onNewMark={() => setMarkDialog({ kind: 'new' })}
              />
            )}
            {resolved.missingMarkIds.length > 0 && (
              <p className="text-xs text-destructive">A mark this course used is no longer in the library; its rows are skipped.</p>
            )}
            <CourseDrawing marks={drawing.marks} course={drawing.course} width={520} title="Course drawing" />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="outline" onClick={onCancel}>Cancel</Button>
            <Button onClick={() => void handleSave()} disabled={saving} data-testid="course-save">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
      <MarkDialog
        mode={markDialog}
        seriesId={seriesId}
        marks={library}
        naming={naming}
        onSave={async (mark) => {
          await onSaveMark(mark);
          if (markDialog?.forCardMark) {
            setPlacements((p) => ({ ...p, [markDialog.forCardMark!]: mark.id }));
            setEdited(null);
          } else {
            setEdited([...sequence, { markId: mark.id, side: 'port' }]);
          }
          setMarkDialog(null);
        }}
        onCancel={() => setMarkDialog(null)}
      />
    </>
  );
}
