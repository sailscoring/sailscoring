'use client';

import { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CourseDialog, type CourseDialogMode } from '@/components/course-library/course-dialog';
import { CourseDrawing } from '@/components/course-library/course-drawing';
import { useConfirm } from '@/components/confirm-dialog';
import { useFeatures } from '@/components/features-provider';
import { useSaveSeriesCourse, useSaveSeriesMark, useSaveSeriesMarks, useSeriesCourses, useSeriesMarks } from '@/hooks/use-course-library';
import { useRaceStartsBySeries } from '@/hooks/use-race-starts';
import { useRacesBySeries } from '@/hooks/use-races';
import { seriesMarkRepo } from '@/lib/api-repository';
import { ratingSystemLabel } from '@/lib/competitor-ratings';
import { loadCourseCard } from '@/lib/course-cards';
import {
  courseOutOfDate,
  drawnSnapshot,
  legsForStart,
  legsMatch,
  legsOfWaypoints,
  resolveCourse,
  snapshotOfCourse,
  windForCardCourse,
  type NamingContext,
} from '@/lib/course-geometry';
import { ORC_STANDARD_OPTIONS, orcOptionKind, orcSelectableOptions } from '@/lib/orc-certificate';
import { normalizeTimeInput } from '@/lib/time-parse';
import type { Competitor, Fleet, OrcCourseLeg, RaceStart, RaceStartCourse, SeriesCourse, SeriesMark } from '@/lib/types';

export type RaceStartDialogMode =
  | { kind: 'add' }
  | { kind: 'edit'; start: RaceStart };

export interface RaceStartDraft {
  editingId: string | null;
  startTime?: string;  // omitted for a membership-only start (fleets, no gun time)
  fleetIds: string[];
  /** Course length in NM — a scoring input for time-on-distance fleets. */
  distanceNm?: number;
  /** RC PCS scoring-wind override in kt (ORC rule 402.12). */
  orcScoringWind?: number;
  /** Constructed-course legs (ORC rule 402.5), in sailing order. */
  courseLegs?: OrcCourseLeg[];
  /** The library course those legs came from, as a snapshot. */
  course?: RaceStartCourse;
  /** The ORC scoring option for this start's races — overrides the fleet
   *  default, and decides the method (single number, band, or PCS). */
  orcOption?: string;
}

export interface RaceStartDialogProps {
  /** When non-null, the dialog is open. */
  mode: RaceStartDialogMode | null;
  /** The series, for the course library the start picks from. */
  seriesId: string;
  /** The race's date and number, for the names a course made from here
   *  is proposed under. */
  race?: { date: string; raceNumber: number };
  raceStarts: RaceStart[];
  fleets: Fleet[];
  /** The series' competitors, when the caller has them — the ORC
   *  scoring-option picker offers the certificate-derived rating fields
   *  alongside the standard set. */
  competitors?: Competitor[];
  onSave: (draft: RaceStartDraft) => void | Promise<void>;
  onCancel: () => void;
}

export function RaceStartDialog(props: RaceStartDialogProps) {
  // Remount per open so form state is fresh; no seed effect needed.
  if (!props.mode) return null;
  return (
    <RaceStartDialogInner
      key={props.mode.kind === 'edit' ? props.mode.start.id : 'add'}
      {...props}
      mode={props.mode}
    />
  );
}

function RaceStartDialogInner({
  mode,
  seriesId,
  race,
  raceStarts,
  fleets,
  competitors,
  onSave,
  onCancel,
}: RaceStartDialogProps & { mode: RaceStartDialogMode }) {
  const seed = mode.kind === 'edit' ? mode.start : null;
  const confirm = useConfirm();
  const { has } = useFeatures();
  const [startTimeInput, setStartTimeInput] = useState(seed?.startTime ?? '');
  const [fleetIds, setFleetIds] = useState<string[]>(seed?.fleetIds ?? []);
  const [distanceInput, setDistanceInput] = useState(
    seed?.distanceNm != null ? String(seed.distanceNm) : '',
  );
  const [scoringWindInput, setScoringWindInput] = useState(
    seed?.orcScoringWind != null ? String(seed.orcScoringWind) : '',
  );
  const [error, setError] = useState('');

  // The scoring-option picker: the start's option decides how its races are
  // scored, overriding each ORC fleet's default. Offered whenever the series
  // scores ORC at all; the catalog is the international standard set plus
  // the single-number fields the stored certificates carry.
  const hasOrcFleet = fleets.some((f) => f.scoringSystem === 'orc');
  const certificateOptions = hasOrcFleet ? orcSelectableOptions(competitors ?? []) : [];
  const [orcOptionValue, setOrcOptionValue] = useState(seed?.orcOption ?? '');
  const offerOption = hasOrcFleet || Boolean(seed?.orcOption);
  const selectedKind = orcOptionValue ? orcOptionKind(orcOptionValue) : null;
  // Course distance is a scoring input for ORC time-on-distance (and shown
  // whenever the series scores ORC at all, so the habit forms before the
  // first ToD race rather than during it). The scoring-wind override only
  // applies to Performance Curve Scoring, so it appears when this start or
  // some fleet's default resolves to PCS — or when a value is stored.
  const offerDistance = hasOrcFleet;
  const offerScoringWind =
    selectedKind === 'pcs' ||
    fleets.some((f) => f.scoringSystem === 'orc' && f.orcProfile?.kind === 'pcs') ||
    seed?.orcScoringWind != null;
  // Constructed-course legs, for races scored PCS over the actual course.
  const offerLegs =
    orcOptionValue === 'CC' ||
    fleets.some(
      (f) => f.scoringSystem === 'orc' && f.orcProfile?.kind === 'pcs' && f.orcProfile.option === 'CC',
    ) || Boolean(seed?.courseLegs?.length);
  interface LegRow { distance: string; bearing: string; wind: string }
  const [legRows, setLegRows] = useState<LegRow[]>(
    (seed?.courseLegs ?? []).map((leg) => ({
      distance: String(leg.distanceNm),
      bearing: String(leg.bearingDeg),
      wind: String(leg.windDirectionDeg),
    })),
  );
  const legsTotal = legRows.reduce((sum, r) => sum + (Number(r.distance) || 0), 0);

  // The course library (ORC constructed courses): the start picks a course,
  // and its legs fill in from there — the wind is the start's own. Offered
  // wherever the legs are; the queries only run when they are.
  const offerCourse = offerLegs && has('orc');
  const { data: libraryCourses } = useSeriesCourses(seriesId, { enabled: offerCourse });
  const { data: libraryMarks } = useSeriesMarks(seriesId, { enabled: offerCourse });
  const { data: seriesStarts } = useRaceStartsBySeries(seriesId, { enabled: offerCourse });
  const { data: seriesRaces } = useRacesBySeries(seriesId);
  const marksById = useMemo(() => new Map((libraryMarks ?? []).map((m) => [m.id, m])), [libraryMarks]);
  // Most recently used first: with five starts to get through, the second
  // is two clicks and the third is one.
  const orderedCourses = useMemo(() => {
    const dateByRace = new Map((seriesRaces ?? []).map((r) => [r.id, r.date]));
    const lastUsed = new Map<string, string>();
    for (const s of seriesStarts ?? []) {
      const id = s.course?.courseId;
      if (!id) continue;
      const d = dateByRace.get(s.raceId) ?? '';
      if (d > (lastUsed.get(id) ?? '')) lastUsed.set(id, d);
    }
    return [...(libraryCourses ?? [])].sort(
      (a, b) => (lastUsed.get(b.id) ?? '').localeCompare(lastUsed.get(a.id) ?? '') || b.createdAt - a.createdAt,
    );
  }, [libraryCourses, seriesStarts, seriesRaces]);
  const naming: NamingContext = useMemo(
    () => (race ? { date: race.date, raceNumber: race.raceNumber } : {}),
    [race],
  );
  const saveMark = useSaveSeriesMark();
  const saveMarks = useSaveSeriesMarks();
  const saveCourse = useSaveSeriesCourse();

  const [snapshot, setSnapshot] = useState<RaceStartCourse | undefined>(seed?.course);
  const [windInput, setWindInput] = useState(seed?.course?.windDirectionDeg != null ? String(seed.course.windDirectionDeg) : '');
  const [legsEdited, setLegsEdited] = useState(Boolean(seed?.course?.legsEdited));
  const [legsOpen, setLegsOpen] = useState(!seed?.course);
  const [courseDialog, setCourseDialog] = useState<CourseDialogMode | null>(null);
  const libraryCourse = snapshot?.courseId ? (libraryCourses ?? []).find((c) => c.id === snapshot.courseId) : undefined;
  const outOfDate = snapshot ? courseOutOfDate(snapshot, libraryCourse, marksById) : false;
  const windDeg = windInput.trim() ? Number(windInput.trim()) : undefined;
  const windValid = windDeg == null || (Number.isFinite(windDeg) && windDeg >= 0 && windDeg <= 360);

  /** Fill the leg table from a course at the wind, as a fresh snapshot. */
  function applyCourse(course: SeriesCourse, wind: number | undefined, marks: ReadonlyMap<string, SeriesMark> = marksById) {
    const resolved = resolveCourse(course.marks, marks);
    const legs = legsForStart(resolved.legs, wind ?? 0);
    setSnapshot(snapshotOfCourse(course, marks, wind));
    setLegRows(legs.map((leg) => ({ distance: String(leg.distanceNm), bearing: String(leg.bearingDeg), wind: wind != null ? String(wind) : '' })));
    setLegsEdited(false);
    setLegsOpen(false);
    setError('');
  }

  async function pickCourse(courseId: string, fresh?: { course: SeriesCourse; marks: ReadonlyMap<string, SeriesMark> }) {
    if (courseId === '__none__') {
      setSnapshot(undefined);
      setLegsOpen(true);
      return;
    }
    const course = fresh?.course ?? (libraryCourses ?? []).find((c) => c.id === courseId);
    if (!course) return;
    // Where a card lays the course out for a wind, offer it — unless the
    // scorer has already said what the wind was.
    let wind = windDeg;
    if (wind == null && course.card) {
      try {
        const { cardFile } = await loadCourseCard(course.card.set, course.card.cardId);
        wind = windForCardCourse(cardFile, course.card.courseId);
        if (wind != null) setWindInput(String(wind));
      } catch {
        // The card is a convenience; the course stands without it.
      }
    }
    applyCourse(course, wind, fresh?.marks);
  }

  /** A changed wind rewrites every leg's wind, unless the scorer edited the
   *  legs — a per-leg wind is exactly the kind of edit that must stay. */
  function changeWind(value: string) {
    setWindInput(value);
    setError('');
    const w = value.trim() ? Number(value.trim()) : undefined;
    if (!snapshot) return;
    setSnapshot({ ...snapshot, ...(w != null && Number.isFinite(w) ? { windDirectionDeg: w } : { windDirectionDeg: undefined }) });
    if (!legsEdited && w != null && Number.isFinite(w)) {
      setLegRows((rows) => rows.map((r) => ({ ...r, wind: String(w) })));
    }
  }

  async function recompute() {
    if (!libraryCourse) return;
    const ok = await confirm({
      title: 'Recompute the legs from the course?',
      description: legsEdited
        ? 'The legs you edited by hand — split legs, nudged distances, per-leg winds — will be replaced by the course as it is now in the library.'
        : 'The legs will be replaced by the course as it is now in the library.',
      confirmLabel: 'Recompute',
    });
    if (ok) applyCourse(libraryCourse, windDeg);
  }

  const drawing = useMemo(() => (snapshot ? drawnSnapshot(snapshot) : null), [snapshot]);

  // A gentle nudge when the chosen option needs course data the start lacks;
  // saving is still allowed — the race falls back to scratch until the
  // course is recorded, matching how the engine scores it.
  const optionHint =
    orcOptionValue === 'CC' && legsTotal === 0
      ? 'Constructed-course scoring needs the course legs below.'
      : (selectedKind === 'tod' || (selectedKind === 'pcs' && orcOptionValue !== 'CC')) && !distanceInput.trim()
        ? 'This option needs the course length below to score.'
        : null;
  function setLegRow(i: number, field: keyof LegRow, value: string) {
    setLegRows((rows) => rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));
    if (snapshot) setLegsEdited(true);
    setError('');
  }
  function removeLegRow(i: number) {
    setLegRows((rows) => rows.filter((_, j) => j !== i));
    if (snapshot) setLegsEdited(true);
  }
  function addLegRow() {
    setLegRows((rows) => [...rows, { distance: '', bearing: '', wind: snapshot && windDeg != null ? String(windDeg) : '' }]);
    if (snapshot) setLegsEdited(true);
  }

  function handleSave() {
    // A blank time is allowed: a membership-only start declares which fleets
    // are in the race (scoping #226) without a gun time. A non-blank time must
    // still parse.
    let normalizedStart: string | undefined;
    if (startTimeInput.trim()) {
      const parsed = normalizeTimeInput(startTimeInput);
      if (!parsed) {
        setError('Enter a valid time, e.g. 14:05:00 or 140500 — or leave blank for fleets only.');
        return;
      }
      normalizedStart = parsed;
    }
    if (fleetIds.length === 0) {
      setError('Select at least one fleet.');
      return;
    }
    let distanceNm: number | undefined;
    if (distanceInput.trim()) {
      const parsed = Number(distanceInput.trim());
      if (!Number.isFinite(parsed) || parsed <= 0) {
        setError('Enter the course length as a positive number of nautical miles, e.g. 3.24.');
        return;
      }
      distanceNm = parsed;
    }
    let courseLegs: OrcCourseLeg[] | undefined;
    const nonEmptyLegs = legRows.filter((r) => r.distance.trim() || r.bearing.trim() || r.wind.trim());
    if (nonEmptyLegs.length > 0) {
      courseLegs = [];
      for (const row of nonEmptyLegs) {
        const distance = Number(row.distance.trim());
        const bearing = Number(row.bearing.trim());
        const wind = Number(row.wind.trim());
        if (
          !Number.isFinite(distance) || distance <= 0 ||
          !Number.isFinite(bearing) || bearing < 0 || bearing > 360 ||
          !Number.isFinite(wind) || wind < 0 || wind > 360
        ) {
          setError('Each course leg needs a distance in NM and bearings in degrees (0–360).');
          return;
        }
        courseLegs.push({ distanceNm: distance, bearingDeg: bearing, windDirectionDeg: wind });
      }
    }
    if (!windValid) {
      setError('Enter the wind direction in degrees (0–360).');
      return;
    }
    // Whether the legs still match the course: a flag the scorer's typing
    // sets, confirmed against the arithmetic so a no-op edit is not an edit.
    let course: RaceStartCourse | undefined;
    if (snapshot) {
      const fromCourse = legsForStart(legsOfWaypoints(snapshot.waypoints), windDeg ?? 0);
      const edited = legsEdited && (courseLegs ? !legsMatch(courseLegs, fromCourse) : true);
      course = {
        ...snapshot,
        ...(windDeg != null ? { windDirectionDeg: windDeg } : { windDirectionDeg: undefined }),
        ...(edited ? { legsEdited: true } : { legsEdited: undefined }),
      };
    }
    let orcScoringWind: number | undefined;
    if (scoringWindInput.trim()) {
      const parsed = Number(scoringWindInput.trim());
      if (!Number.isFinite(parsed) || parsed <= 0 || parsed >= 100) {
        setError('Enter the scoring wind as knots, e.g. 14 — or leave blank to use the implied wind.');
        return;
      }
      orcScoringWind = parsed;
    }
    const editingId = mode.kind === 'edit' ? mode.start.id : null;
    const otherStarts = raceStarts.filter((s) => s.id !== editingId);
    const usedFleetIds = new Set(otherStarts.flatMap((s) => s.fleetIds));
    const conflict = fleetIds.find((id) => usedFleetIds.has(id));
    if (conflict) {
      const name = fleets.find((f) => f.id === conflict)?.name ?? conflict;
      setError(`Fleet "${name}" is already in another start group.`);
      return;
    }
    void onSave({
      editingId,
      startTime: normalizedStart,
      fleetIds,
      ...(distanceNm != null ? { distanceNm } : {}),
      ...(orcScoringWind != null ? { orcScoringWind } : {}),
      ...(courseLegs ? { courseLegs } : {}),
      ...(course ? { course } : {}),
      ...(orcOptionValue ? { orcOption: orcOptionValue } : {}),
    });
  }

  return (
    <>
    <Dialog open onOpenChange={(open) => { if (!open && !courseDialog) onCancel(); }}>
      <DialogContent className={`${offerCourse ? 'max-w-lg' : 'max-w-sm'} max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto]`}>
        <DialogHeader>
          <DialogTitle>{mode.kind === 'edit' ? 'Edit start' : 'Add start'}</DialogTitle>
          <DialogDescription>
            Record the gun time for a group of fleets, or leave it blank to just
            declare which fleets are in this race.
          </DialogDescription>
        </DialogHeader>
        {/* The body scrolls: a constructed-course legs list can outgrow the
            viewport, and Save must stay reachable. */}
        <div className="space-y-4 min-h-0 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Gun time <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
              value={startTimeInput}
              onChange={(e) => { setStartTimeInput(e.target.value); setError(''); }}
              placeholder="14:05:00"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>
          {offerOption && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Scoring option <span className="font-normal text-muted-foreground">(this start)</span>
              </label>
              <Select
                value={orcOptionValue || '__default__'}
                onValueChange={(v) => { setOrcOptionValue(v === '__default__' ? '' : v); setError(''); }}
              >
                <SelectTrigger className="w-full" data-testid="start-orc-option">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">Fleet default</SelectItem>
                  {ORC_STANDARD_OPTIONS.map((o) => (
                    <SelectItem key={o.option} value={o.option}>
                      {o.label}
                    </SelectItem>
                  ))}
                  {certificateOptions.map((o) => (
                    <SelectItem key={o.option} value={o.option}>
                      <span className="font-mono text-xs">{o.option}</span>
                    </SelectItem>
                  ))}
                  {orcOptionValue
                    && !ORC_STANDARD_OPTIONS.some((o) => o.option === orcOptionValue)
                    && !certificateOptions.some((o) => o.option === orcOptionValue) && (
                    <SelectItem value={orcOptionValue}>
                      <span className="font-mono text-xs">{orcOptionValue}</span>
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                How this start&apos;s races are scored — the option the race
                committee announced: a certificate single number, a wind band,
                or performance curves. Overrides the fleet&apos;s default;
                changing it later re-scores without re-entering finishes.
              </p>
              {optionHint && <p className="text-xs text-amber-600 dark:text-amber-500">{optionHint}</p>}
            </div>
          )}
          {offerDistance && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="start-distance-nm">
                Course length <span className="font-normal text-muted-foreground">(NM, optional)</span>
              </label>
              <input
                id="start-distance-nm"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
                value={distanceInput}
                onChange={(e) => { setDistanceInput(e.target.value); setError(''); }}
                placeholder="3.24"
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              <p className="text-xs text-muted-foreground">
                Required to score a time-on-distance fleet; record it to 0.01 NM.
              </p>
            </div>
          )}
          {offerCourse && (
            <div className="space-y-1.5" data-testid="start-course">
              <label className="text-sm font-medium">Course</label>
              <div className="flex items-center gap-2">
                <Select value={snapshot?.courseId ?? (snapshot ? '__gone__' : '__none__')} onValueChange={(v) => void pickCourse(v)}>
                  <SelectTrigger className="w-full" data-testid="start-course-picker">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Not recorded</SelectItem>
                    {snapshot && !libraryCourse && (
                      <SelectItem value="__gone__">{snapshot.name} (no longer in the library)</SelectItem>
                    )}
                    {orderedCourses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => setCourseDialog({ kind: 'new' })} data-testid="start-new-course">
                  New course…
                </Button>
              </div>
              {snapshot && (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="font-mono">{legRows.length} legs · {legsTotal.toFixed(2)} NM</span>
                  <label className="flex items-center gap-1">
                    wind
                    <input
                      aria-label="Wind direction"
                      className="flex h-7 w-16 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                      value={windInput}
                      inputMode="decimal"
                      onChange={(e) => changeWind(e.target.value)}
                      placeholder="190"
                    />
                    °
                  </label>
                  {legsEdited && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" data-testid="legs-edited">legs edited</span>
                  )}
                  {outOfDate && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" data-testid="course-out-of-date">course changed since</span>
                  )}
                  {libraryCourse && (legsEdited || outOfDate) && (
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void recompute()} data-testid="recompute-legs">
                      Recompute from course
                    </Button>
                  )}
                </div>
              )}
              {drawing && <CourseDrawing marks={drawing.marks} course={drawing.course} width={440} title="Course drawing" />}
            </div>
          )}
          {offerLegs && (
            <div className="space-y-1.5">
              {offerCourse ? (
                <button
                  type="button"
                  className="flex items-center gap-1 text-sm font-medium"
                  onClick={() => setLegsOpen((v) => !v)}
                  aria-expanded={legsOpen}
                  data-testid="legs-disclosure"
                >
                  <ChevronRight className={`h-3.5 w-3.5 transition-transform ${legsOpen ? 'rotate-90' : ''}`} />
                  Legs ({legRows.length})
                </button>
              ) : (
                <label className="text-sm font-medium">Course legs</label>
              )}
              {(legsOpen || !offerCourse) && (
              <div className="space-y-1">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1 text-xs text-muted-foreground">
                  <span>Distance (NM)</span>
                  <span>Bearing (°)</span>
                  <span>Wind dir (°)</span>
                  <span />
                </div>
                {legRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
                    <input
                      aria-label={`Leg ${i + 1} distance`}
                      className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                      value={row.distance}
                      inputMode="decimal"
                      onChange={(e) => setLegRow(i, 'distance', e.target.value)}
                    />
                    <input
                      aria-label={`Leg ${i + 1} bearing`}
                      className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                      value={row.bearing}
                      inputMode="decimal"
                      onChange={(e) => setLegRow(i, 'bearing', e.target.value)}
                    />
                    <input
                      aria-label={`Leg ${i + 1} wind direction`}
                      className="flex h-8 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                      value={row.wind}
                      inputMode="decimal"
                      onChange={(e) => setLegRow(i, 'wind', e.target.value)}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      aria-label={`Remove leg ${i + 1}`}
                      onClick={() => removeLegRow(i)}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <div className="flex items-center justify-between">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addLegRow}
                  >
                    Add leg
                  </Button>
                  {legsTotal > 0 && (
                    <span className="text-xs text-muted-foreground font-mono">
                      {legsTotal.toFixed(2)} NM total
                    </span>
                  )}
                </div>
              </div>
              )}
              {(legsOpen || !offerCourse) && (
                <p className="text-xs text-muted-foreground">
                  One row per leg, in sailing order; split a leg into two rows when
                  the wind shifts along it. The course distance is the total.
                </p>
              )}
            </div>
          )}
          {offerScoringWind && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="start-scoring-wind">
                Scoring wind <span className="font-normal text-muted-foreground">(kt, optional)</span>
              </label>
              <input
                id="start-scoring-wind"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
                value={scoringWindInput}
                onChange={(e) => { setScoringWindInput(e.target.value); setError(''); }}
                placeholder="14"
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              <p className="text-xs text-muted-foreground">
                Overrides the winner&apos;s implied wind for performance-curve scoring
                — set only when the implied wind doesn&apos;t fairly represent the race.
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Fleets in this start</label>
            <div className="space-y-1.5">
              {/* Round-owned fleets are managed by the split-fleet ceremonies;
                  offer them only when this start already includes one. */}
              {fleets.filter((f) => !f.splitRoundId || fleetIds.includes(f.id)).map((f) => (
                <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fleetIds.includes(f.id)}
                    onChange={(e) => {
                      setFleetIds((prev) =>
                        e.target.checked ? [...prev, f.id] : prev.filter((id) => id !== f.id),
                      );
                      setError('');
                    }}
                    className="h-4 w-4 rounded border"
                  />
                  {f.name}
                  {f.scoringSystem !== 'scratch' && (
                    <span className="text-xs text-muted-foreground">({ratingSystemLabel(f)})</span>
                  )}
                </label>
              ))}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
    {offerCourse && (
      <CourseDialog
        mode={courseDialog}
        seriesId={seriesId}
        marks={libraryMarks ?? []}
        courses={libraryCourses ?? []}
        naming={naming}
        onSaveMark={(m) => saveMark.mutateAsync(m).then(() => undefined)}
        onSaveMarks={(list) => saveMarks.mutateAsync(list)}
        onSave={async (course) => {
          const saved = await saveCourse.mutateAsync(course);
          setCourseDialog(null);
          // The new course is picked and its legs filled against the marks
          // as the server has them now — the render's cache may predate the
          // marks the dialog just adopted.
          const marks = await seriesMarkRepo.listBySeries(seriesId);
          void pickCourse(saved.id, { course: saved, marks: new Map(marks.map((m) => [m.id, m])) });
        }}
        onCancel={() => setCourseDialog(null)}
      />
    )}
    </>
  );
}
