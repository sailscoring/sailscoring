'use client';

import { useCallback, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import type { Position } from '@sailscoring/course-cards';
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
import { ConstructedCourseImport } from '@/components/constructed-course/constructed-course-import';
import { CourseDrawing } from '@/components/constructed-course/course-drawing';
import {
  BearingRefControl,
  LegTable,
  emptyLegRow,
  figureField,
  rowBearingTrue,
  rowWindTrue,
  rowsInRef,
  storedFigure,
  type BearingDisplay,
  type KeptFigure,
  type LegTableRow,
} from '@/components/constructed-course/leg-table';
import { useConfirm } from '@/components/confirm-dialog';
import { useFeatures } from '@/components/features-provider';
import { useRaceStartsBySeries } from '@/hooks/use-race-starts';
import { useSeries } from '@/hooks/use-series';
import { OrcOptionItems, OrcOptionValue } from '@/components/orc-option-items';
import { OrcOptionPicker } from '@/components/orc-option-picker';
import { orcOptionChoices } from '@/lib/orc-option-choices';
import { courseVariation, todayIso, type BearingRef, type Variation } from '@/lib/bearings';
import { ratingSystemLabel } from '@/lib/competitor-ratings';
import {
  drawnRaceStartCourse,
  legDistance,
  legsForStart,
  legsMatch,
  seriesChartSet,
  startCoursePositions,
} from '@/lib/course-geometry';
import {
  DEFAULT_ORC_PROFILE,
  ORC_STANDARD_OPTIONS,
  orcConstructedOption,
  orcFleetProfile,
  orcOptionKind,
  orcOptionLabel,
  orcRaceProfile,
  orcRecordedWindOption,
  orcSelectableOptions,
} from '@/lib/orc-certificate';
import {
  importedCourseLegs,
  snapshotOfImportedCourse,
  type ConstructedCourse,
} from '@/lib/orc-constructed-course';
import { normalizeTimeInput } from '@/lib/time-parse';
import type { Competitor, Fleet, OrcCourseLeg, RaceStart, RaceStartCourse } from '@/lib/types';

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
  /** The course those legs came from: its name, wind and anchor. */
  course?: RaceStartCourse;
  /** The ORC scoring option for this start's races — overrides the fleet
   *  default, and decides the method (single number, band, or PCS). */
  orcOption?: string;
}

export interface RaceStartDialogProps {
  /** When non-null, the dialog is open. */
  mode: RaceStartDialogMode | null;
  /** The series, for its venue position and the chart its courses sit on. */
  seriesId: string;
  /** The race's date, for the variation the course's figures are shown at. */
  race?: { date: string };
  raceStarts: RaceStart[];
  fleets: Fleet[];
  /** The series' competitors, when the caller has them — the ORC
   *  scoring-option picker offers the certificate-derived rating fields
   *  alongside the standard set. */
  competitors?: Competitor[];
  /** The ORC option a new start begins with — the previous start's — or
   *  none for the fleet default. Ignored when editing a start. */
  copiedOrcOption?: string;
  onSave: (draft: RaceStartDraft) => void | Promise<void>;
  onCancel: () => void;
}

export function RaceStartDialog(props: RaceStartDialogProps) {
  // The venue position places a course with no marks for its variation, and
  // the rows are filled in that reference when the dialog opens — so it
  // waits for the series, which the race page has already loaded.
  const { data: series } = useSeries(props.seriesId);
  // Remount per open so form state is fresh; no seed effect needed.
  if (!props.mode || series === undefined) return null;
  return (
    <RaceStartDialogInner
      key={props.mode.kind === 'edit' ? props.mode.start.id : 'add'}
      {...props}
      mode={props.mode}
      venuePosition={series?.venuePosition}
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
  copiedOrcOption,
  onSave,
  onCancel,
  venuePosition,
}: RaceStartDialogProps & { mode: RaceStartDialogMode; venuePosition?: Position }) {
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
  // Named and grouped by the certificates' own catalog, as on the Fleets
  // card — one list, one order, wherever an option is chosen (#602). The
  // series is loaded for nothing else here.
  const { data: series } = useSeries(seriesId, { enabled: hasOrcFleet });
  const orcCatalog = series?.orcScoringOptions;
  const certificateOptions = hasOrcFleet
    ? orcSelectableOptions(competitors ?? [], orcCatalog)
    : [];
  const [orcOptionValue, setOrcOptionValue] = useState(
    (mode.kind === 'edit' ? seed?.orcOption : copiedOrcOption) ?? '',
  );
  // The row "This start" still needs, while it is incomplete.
  const [orcPending, setOrcPending] = useState<string | null>(null);
  // Chosen in rows wherever every option can be taken apart — the catalog
  // names them all, and a stored option is one of them. Otherwise the flat
  // list, which shows whatever the start holds.
  const orcChoices = orcOptionChoices(certificateOptions, orcCatalog);
  const stagedPicker =
    certificateOptions.every((o) => orcCatalog?.[o.option])
    && (!orcOptionValue || orcChoices.some((c) => c.option === orcOptionValue));
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
  // Constructed-course legs, for races scored over the actual course.
  const orcFleetOptions = fleets
    .filter((f) => f.scoringSystem === 'orc')
    .map((f) => f.orcProfile?.option ?? '');
  const offerLegs =
    orcConstructedOption(orcOptionValue) ||
    orcFleetOptions.some(orcConstructedOption) ||
    Boolean(seed?.courseLegs?.length);
  // The wind speed is a scoring input only where the option scores at the
  // wind the race committee recorded; PCS derives the wind instead, and
  // offering a speed there would invite the scorer to fill in a number
  // nothing reads.
  const optionScoresRecordedWind =
    orcRecordedWindOption(orcOptionValue) ||
    (!orcOptionValue && orcFleetOptions.some(orcRecordedWindOption));
  // Bearings and winds are stored true and shown in magnetic, at the
  // variation where the course is — its marks, else the venue — on the
  // race's day. A start with neither stays in true, unless its course was
  // imported in magnetic, when it stays in magnetic: either way there is
  // nothing to convert by, and the figures are shown as stored.
  const raceDate = race?.date || todayIso();
  const [bearingRef, setBearingRef] = useState<BearingRef>('M');
  const displayAt = (v: Variation | undefined): BearingDisplay => (v ? { ref: bearingRef, variation: v } : { ref: 'T' });
  const [seedDisplay] = useState<BearingDisplay>(() =>
    seed?.course?.north === 'magnetic'
      ? { ref: 'M' }
      : displayAt(courseVariation(startCoursePositions(seed?.course), venuePosition, raceDate)),
  );
  const [legRows, setLegRows] = useState<LegTableRow[]>(() =>
    (seed?.courseLegs ?? []).map((leg) => {
      const b = figureField(leg.bearingDeg, seedDisplay);
      const w = figureField(leg.windDirectionDeg, seedDisplay);
      return emptyLegRow({
        name: leg.name ?? '',
        distance: String(leg.distanceNm),
        bearing: b.text,
        bearingKept: b.kept,
        wind: w.text,
        windKept: w.kept,
        windSpeed: leg.windSpeedKts != null ? String(leg.windSpeedKts) : '',
        ...(leg.currentSpeedKts != null && leg.currentDirectionDeg != null
          ? { current: { speedKts: leg.currentSpeedKts, directionDeg: leg.currentDirectionDeg } }
          : {}),
      });
    }),
  );
  const legsTotal = legRows.reduce((sum, r) => sum + (Number(r.distance) || 0), 0);
  // A start whose ORC fleets are all scored on a constructed course is
  // scored over its legs, and nothing reads the course length: resolved per
  // fleet as scoring resolves it, the start's own option else the fleet's.
  const startOrcFleets = fleets.filter((f) => f.scoringSystem === 'orc' && fleetIds.includes(f.id));
  // The fleet default "This start" begins from, and names: the start's own
  // ORC fleets', or every ORC fleet's before any is ticked.
  const defaultFleets = startOrcFleets.length > 0 ? startOrcFleets : fleets.filter((f) => f.scoringSystem === 'orc');
  const defaultOptions = [...new Set(defaultFleets.map((f) => orcFleetProfile(f).option))];
  const fleetDefaultOption = defaultOptions[0] ?? DEFAULT_ORC_PROFILE.option;
  const fleetDefaultLabel = defaultOptions.length > 1
    ? 'each fleet’s own option'
    : orcOptionLabel(fleetDefaultOption, orcCatalog);
  const distanceUnused =
    startOrcFleets.length > 0 &&
    startOrcFleets.every((f) =>
      orcConstructedOption(orcRaceProfile(f, { orcOption: orcOptionValue || undefined }).option),
    );
  // Also wherever a leg already has a speed — one typed under another
  // option, or a course that arrived with the recorded wind — so a figure
  // that is saved is never one the scorer can't see.
  const offerWindSpeed = optionScoresRecordedWind || legRows.some((r) => r.windSpeed.trim() !== '');
  // The race committee's names for the legs, where the course came with them.
  const [showLegNames, setShowLegNames] = useState(() => (seed?.courseLegs ?? []).some((leg) => leg.name));
  const [importOpen, setImportOpen] = useState(false);

  // The start's course (ORC constructed courses): its summary, its wind and
  // its drawing, wherever the legs are. The series' other starts say which
  // chart its courses sit on, where more than one covers a course.
  const offerCourse = offerLegs && has('orc');
  const { data: seriesStarts } = useRaceStartsBySeries(seriesId, { enabled: offerCourse });
  const chartSet = useMemo(() => seriesChartSet(seriesStarts ?? []), [seriesStarts]);

  const [snapshot, setSnapshot] = useState<RaceStartCourse | undefined>(seed?.course);
  const [seedWind] = useState(() =>
    seed?.course?.windDirectionDeg != null ? figureField(seed.course.windDirectionDeg, seedDisplay) : undefined,
  );
  const [windInput, setWindInput] = useState(seedWind?.text ?? '');
  const [windKept, setWindKept] = useState<KeptFigure | undefined>(seedWind?.kept);
  const [windSpeedInput, setWindSpeedInput] = useState(
    seed?.course?.windSpeedKts != null ? String(seed.course.windSpeedKts) : '',
  );
  const [legsEdited, setLegsEdited] = useState(Boolean(seed?.course?.legsEdited));
  // Where the course is: where its first leg starts, else the venue.
  const snapshotAnchor = snapshot?.anchor;
  const variation = useMemo(
    () => courseVariation(snapshotAnchor ? [snapshotAnchor] : [], venuePosition, raceDate),
    [snapshotAnchor, venuePosition, raceDate],
  );
  // A course kept in magnetic stays in magnetic, even once a venue position
  // would give a variation: its figures were never converted, and
  // converting them now would be at a place nobody recorded.
  const magnetic = snapshot?.north === 'magnetic';
  const display = useMemo<BearingDisplay>(
    () => (magnetic ? { ref: 'M' } : variation ? { ref: bearingRef, variation } : { ref: 'T' }),
    [magnetic, variation, bearingRef],
  );
  // The course's wind as stored: null where the field doesn't read.
  const windTrue = windInput.trim() ? storedFigure(windInput, display, windKept) : undefined;
  const windDeg = windTrue ?? undefined;
  const windValid = windTrue !== null;
  const windKt = windSpeedInput.trim() ? Number(windSpeedInput.trim()) : undefined;
  const windSpeedValid = windKt == null || (Number.isFinite(windKt) && windKt > 0 && windKt < 100);

  /** The variation an imported course's magnetic figures are converted at:
   *  where its first leg starts, else the venue, on the race's day. */
  const importVariationAt = useCallback(
    (anchor: Position | undefined) => courseVariation(anchor ? [anchor] : [], venuePosition, raceDate),
    [venuePosition, raceDate],
  );

  /** Fill the leg table from an imported ORC constructed course, as the
   *  start's course: the document is the course. Legs already in the
   *  table are replaced, which the scorer is asked about first. With no
   *  variation, the course is kept in magnetic as the document gives it. */
  async function applyImportedCourse(course: ConstructedCourse, v: Variation | undefined) {
    const filled = legRows.filter((r) => r.distance.trim() || r.bearing.trim()).length;
    if (filled > 0) {
      const ok = await confirm({
        title: 'Replace the legs?',
        description: `This start's ${filled} leg${filled === 1 ? '' : 's'} will be replaced by the ${course.legs.length} leg${course.legs.length === 1 ? '' : 's'} of ${course.name ?? 'the imported course'}.`,
        confirmLabel: 'Replace',
      });
      if (!ok) return;
    }
    const legs = importedCourseLegs(course, v);
    const next = snapshotOfImportedCourse(course, legs, v ? undefined : 'magnetic');
    const at: BearingDisplay = v ? displayAt(v) : { ref: 'M' };
    setSnapshot(next);
    const w = next.windDirectionDeg != null ? figureField(next.windDirectionDeg, at) : undefined;
    setWindInput(w?.text ?? '');
    setWindKept(w?.kept);
    setWindSpeedInput(next.windSpeedKts != null ? String(next.windSpeedKts) : '');
    setLegRows(legs.map((leg) => {
      const b = figureField(leg.bearingDeg, at);
      const wind = leg.windDirectionDeg != null ? figureField(leg.windDirectionDeg, at) : undefined;
      return emptyLegRow({
        name: leg.name ?? '',
        distance: String(leg.distanceNm),
        bearing: b.text,
        bearingKept: b.kept,
        wind: wind?.text ?? '',
        ...(wind ? { windKept: wind.kept } : {}),
        windSpeed: leg.windSpeedKts != null ? String(leg.windSpeedKts) : '',
        ...(leg.currentSpeedKts != null && leg.currentDirectionDeg != null
          ? { current: { speedKts: leg.currentSpeedKts, directionDeg: leg.currentDirectionDeg } }
          : {}),
      });
    }));
    setShowLegNames(legs.some((leg) => leg.name));
    setLegsEdited(false);
    setImportOpen(false);
    setError('');
  }

  /** A changed wind rewrites every leg's wind, unless the scorer edited the
   *  legs — a per-leg wind is exactly the kind of edit that must stay. */
  function changeWind(value: string) {
    setWindInput(value);
    setError('');
    const w = value.trim() ? storedFigure(value, display, windKept) : null;
    if (!snapshot) return;
    setSnapshot({ ...snapshot, ...(w != null ? { windDirectionDeg: w } : { windDirectionDeg: undefined }) });
    if (!legsEdited && w != null) {
      const f = figureField(w, display);
      setLegRows((rows) => rows.map((r) => ({ ...r, wind: f.text, windKept: f.kept })));
    }
  }

  /** Show every figure in another reference or at another variation: the
   *  scorer's choice of north, or a course that sits somewhere else. */
  function redisplay(next: BearingDisplay) {
    setLegRows((rows) => rowsInRef(rows, display, next));
    if (windDeg != null) {
      const f = figureField(windDeg, next);
      setWindInput(f.text);
      setWindKept(f.kept);
    }
  }

  /** The same for the wind speed: one figure for the course, spread over
   *  every leg, and a leg the scorer has since given its own keeps it. */
  function changeWindSpeed(value: string) {
    setWindSpeedInput(value);
    setError('');
    const kt = value.trim() ? Number(value.trim()) : undefined;
    const valid = kt != null && Number.isFinite(kt);
    if (!legsEdited) {
      setLegRows((rows) => rows.map((r) => ({ ...r, windSpeed: valid ? String(kt) : '' })));
    }
    if (!snapshot) return;
    setSnapshot({ ...snapshot, ...(valid ? { windSpeedKts: kt } : { windSpeedKts: undefined }) });
  }

  /** Take the course off the start, legs and all. */
  async function removeCourse() {
    const ok = await confirm({
      title: 'Remove the course?',
      description: `${snapshot?.name ?? 'The course'} and its ${legRows.length} leg${legRows.length === 1 ? '' : 's'} are taken off this start.`,
      confirmLabel: 'Remove',
    });
    if (!ok) return;
    setLegRows([]);
    setWindInput('');
    setWindKept(undefined);
    setShowLegNames(false);
    setLegsEdited(false);
    setSnapshot(undefined);
  }

  // The picture the published page will show: the legs as typed, from
  // where the first leg starts where the course says. Rows that don't parse
  // yet are left out — the drawing follows the typing, and saving is where a
  // bad row is refused.
  const drawing = useMemo(() => {
    const legs = legRows
      .map((r) => ({ distanceNm: Number(r.distance.trim()), bearingDeg: rowBearingTrue(r, display) ?? NaN }))
      .filter((l) => l.distanceNm > 0 && l.bearingDeg >= 0 && l.bearingDeg <= 360);
    return legs.length > 0 ? drawnRaceStartCourse(snapshot, legs, chartSet) : null;
  }, [snapshot, legRows, display, chartSet]);

  // A gentle nudge when the chosen option needs course data the start lacks;
  // saving is still allowed — the race falls back to scratch until the
  // course is recorded, matching how the engine scores it.
  const optionHint =
    orcConstructedOption(orcOptionValue) && legsTotal === 0
      ? 'Constructed-course scoring needs the course legs below.'
      : orcRecordedWindOption(orcOptionValue) && legRows.some((r) => !r.windSpeed.trim())
        ? 'This option scores at the recorded wind, so every leg needs its wind speed.'
        : (selectedKind === 'tod' || selectedKind === 'pcs')
          && !orcConstructedOption(orcOptionValue)
          && !distanceInput.trim()
          ? 'This option needs the course length below to score.'
          : null;
  // One choice of north for the whole dialog — the course's wind and every
  // leg — shown with the variation it applies.
  const refControl = (
    <BearingRefControl
      display={display}
      onChange={(ref) => {
        redisplay({ ...display, ref });
        setBearingRef(ref);
      }}
      missing={magnetic
        ? 'The course was imported in magnetic with nowhere to read the variation at, so this start keeps it in magnetic.'
        : 'Set the venue position in the series settings to enter them in magnetic.'}
    />
  );

  /** Any change to the table is the scorer's own: a start's course is
   *  flagged as edited once its legs are no longer the ones it gave. */
  function changeLegRows(rows: LegTableRow[]) {
    setLegRows(rows);
    if (snapshot) setLegsEdited(true);
    setError('');
  }

  // Round-owned fleets are managed by the split-fleet ceremonies, so they are
  // offered only when this start already includes one; fleets another start
  // group has already claimed are offered but can't be saved, so select-all
  // steps over them rather than walking the scorer into the error.
  const editingId = mode.kind === 'edit' ? mode.start.id : null;
  const offeredFleets = fleets.filter((f) => !f.splitRoundId || fleetIds.includes(f.id));
  const claimedFleetIds = useMemo(
    () => new Set(raceStarts.filter((s) => s.id !== editingId).flatMap((s) => s.fleetIds)),
    [raceStarts, editingId],
  );
  const selectableFleets = offeredFleets.filter(
    (f) => !claimedFleetIds.has(f.id) || fleetIds.includes(f.id),
  );
  const allFleetsSelected =
    selectableFleets.length > 0 && selectableFleets.every((f) => fleetIds.includes(f.id));

  function toggleAllFleets() {
    setFleetIds((prev) =>
      allFleetsSelected ? [] : [...new Set([...prev, ...selectableFleets.map((f) => f.id)])],
    );
    setError('');
  }

  function handleSave() {
    // A blank time is allowed: a membership-only start declares which fleets
    // are in the race (scoping #226) without a gun time. A non-blank time must
    // still parse.
    let normalizedStart: string | undefined;
    if (startTimeInput.trim()) {
      const parsed = normalizeTimeInput(startTimeInput);
      if (!parsed) {
        setError('Enter a valid time, e.g. 14:05, 14:05:00 or 1405 — or leave blank for fleets only.');
        return;
      }
      normalizedStart = parsed;
    }
    if (fleetIds.length === 0) {
      setError('Select at least one fleet.');
      return;
    }
    if (orcPending) {
      setError(`Choose ${orcPending} for this start’s scoring option, or use the fleet default.`);
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
    const nonEmptyLegs = legRows.filter(
      (r) => r.distance.trim() || r.bearing.trim() || r.wind.trim() || r.windSpeed.trim(),
    );
    if (nonEmptyLegs.length > 0) {
      courseLegs = [];
      for (const row of nonEmptyLegs) {
        const distance = Number(row.distance.trim());
        const bearing = rowBearingTrue(row, display);
        const wind = rowWindTrue(row, display);
        if (!Number.isFinite(distance) || distance <= 0 || bearing == null || wind == null) {
          setError('Each course leg needs a distance in NM and bearings in degrees (0–360).');
          return;
        }
        let legWindSpeed: number | undefined;
        if (row.windSpeed.trim()) {
          const kt = Number(row.windSpeed.trim());
          if (!Number.isFinite(kt) || kt <= 0 || kt >= 100) {
            setError("Enter each leg's wind speed in knots, e.g. 9 — or leave it blank.");
            return;
          }
          legWindSpeed = kt;
        }
        const name = row.name.trim().slice(0, 80);
        courseLegs.push({
          // Recorded at ORC's own precision whoever typed it, so the figure
          // the results page prints is the one the curve was read at.
          distanceNm: legDistance(distance),
          bearingDeg: bearing,
          windDirectionDeg: wind,
          ...(legWindSpeed != null ? { windSpeedKts: legWindSpeed } : {}),
          ...(row.current ? { currentSpeedKts: row.current.speedKts, currentDirectionDeg: row.current.directionDeg } : {}),
          ...(name ? { name } : {}),
        });
      }
    }
    if (!windValid) {
      setError('Enter the wind direction in degrees (0–360).');
      return;
    }
    if (!windSpeedValid) {
      setError('Enter the wind speed in knots, e.g. 9.');
      return;
    }
    // Whether the legs still match the course: a flag the scorer's typing
    // sets, confirmed against the arithmetic so a no-op edit is not an edit.
    let course: RaceStartCourse | undefined;
    if (snapshot) {
      // The legs the course gave are what an edit is measured against. A
      // course edited before it was kept has none, so it stays edited.
      const fromCourse = legsForStart(snapshot.legs ?? [], windDeg ?? 0, windKt);
      const edited = legsEdited && (courseLegs ? !legsMatch(courseLegs, fromCourse) : true);
      course = {
        ...snapshot,
        ...(windDeg != null ? { windDirectionDeg: windDeg } : { windDirectionDeg: undefined }),
        ...(windKt != null ? { windSpeedKts: windKt } : { windSpeedKts: undefined }),
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
    const conflict = fleetIds.find((id) => claimedFleetIds.has(id));
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
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
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
            <label className="text-sm font-medium" htmlFor="start-gun-time">Gun time <span className="font-normal text-muted-foreground">(optional)</span></label>
            <input
              id="start-gun-time"
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
              value={startTimeInput}
              onChange={(e) => { setStartTimeInput(e.target.value); setError(''); }}
              placeholder="HH:MM:SS"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          </div>
          {offerOption && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Scoring option <span className="font-normal text-muted-foreground">(this start)</span>
              </label>
              {stagedPicker ? (
                <OrcOptionPicker
                  choices={orcChoices}
                  value={orcOptionValue}
                  fleetDefaultOption={fleetDefaultOption}
                  fleetDefaultLabel={fleetDefaultLabel}
                  onChange={(option, pending) => { setOrcOptionValue(option); setOrcPending(pending); setError(''); }}
                />
              ) : (
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
                    <OrcOptionItems options={certificateOptions} catalog={orcCatalog} />
                    {orcOptionValue
                      && !ORC_STANDARD_OPTIONS.some((o) => o.option === orcOptionValue)
                      && !certificateOptions.some((o) => o.option === orcOptionValue) && (
                      <SelectItem value={orcOptionValue}>
                        <OrcOptionValue option={orcOptionValue} catalog={orcCatalog} />
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              )}
              <p className="text-xs text-muted-foreground">
                How this start&apos;s races are scored — the option the race
                committee announced. Overrides the fleet&apos;s default;
                changing it later re-scores without re-entering finishes.
              </p>
              {optionHint && <p className="text-xs text-amber-600 dark:text-amber-500">{optionHint}</p>}
            </div>
          )}
          {/* Kept while a length is stored or typed, so the scorer can see it
              isn't used and clear it. */}
          {offerDistance && (!distanceUnused || seed?.distanceNm != null || distanceInput.trim() !== '') && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="start-distance-nm">
                Course length <span className="font-normal text-muted-foreground">(NM, optional)</span>
              </label>
              <input
                id="start-distance-nm"
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm font-mono shadow-sm"
                value={distanceInput}
                onChange={(e) => { setDistanceInput(e.target.value); setError(''); }}
                inputMode="decimal"
                onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
              />
              {distanceUnused ? (
                <p className="text-xs text-amber-600 dark:text-amber-500" data-testid="distance-unused">
                  Not used: this start is scored on its constructed course, over its legs
                  {legsTotal > 0 && <> ({legsTotal.toFixed(2)} NM)</>}. Clear it unless the
                  start will be scored another way.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Required to score a time-on-distance fleet; record it to 0.01 NM.
                </p>
              )}
            </div>
          )}
          {offerCourse && (snapshot || drawing) && (
            <div className="space-y-1.5" data-testid="start-course">
              {snapshot && (
                <>
                  <p className="text-sm font-medium">
                    Course <span className="font-normal text-muted-foreground" data-testid="start-course-name">{snapshot.name}</span>
                  </p>
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
                      />
                      °{display.ref}
                    </label>
                    {legsEdited && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300" data-testid="legs-edited">legs edited</span>
                    )}
                    <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => void removeCourse()} data-testid="remove-course">
                      Remove course
                    </Button>
                  </div>
                </>
              )}
              {drawing && (
                <>
                  <CourseDrawing
                    marks={drawing.marks}
                    course={drawing.course}
                    set={drawing.set}
                    variation={display.ref === 'M' ? display.variation : undefined}
                    north={magnetic ? 'magnetic' : undefined}
                    width={440}
                    title="Course drawing"
                  />
                  {drawing.anchored ? (
                    <p className="text-xs text-muted-foreground" data-testid="course-drawing-caption">
                      Drawn from the legs, from where the first leg starts —
                      the only recorded position; the rest is where the
                      bearings and distances lead.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground" data-testid="course-drawing-caption">
                      Drawn from the legs — the shape and the direction
                      are the committee&apos;s; there are no positions behind it.
                      {magnetic && ' Magnetic north is up.'}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {offerLegs && (
            <div className="space-y-1.5">
              {refControl}
              {/* Above the table, because this is a scoring input rather than
                  a detail of one leg. */}
              {offerWindSpeed && (
                <label className="flex items-center gap-1 text-xs text-muted-foreground">
                  Wind speed
                  <input
                    aria-label="Wind speed"
                    className="flex h-7 w-16 rounded-md border border-input bg-transparent px-2 text-sm font-mono"
                    value={windSpeedInput}
                    inputMode="decimal"
                    onChange={(e) => changeWindSpeed(e.target.value)}
                  />
                  kt — put on every leg
                </label>
              )}
              <label className="text-sm font-medium">Course legs</label>
              <div className="space-y-1">
                <LegTable
                  rows={legRows}
                  display={display}
                  onChange={changeLegRows}
                  showWindSpeed={offerWindSpeed}
                  showName={showLegNames}
                  actions={(
                    <button
                      type="button"
                      className="flex items-center gap-1 text-xs text-muted-foreground"
                      onClick={() => setImportOpen((v) => !v)}
                      aria-expanded={importOpen}
                      data-testid="import-course-disclosure"
                    >
                      <ChevronRight className={`h-3 w-3 transition-transform ${importOpen ? 'rotate-90' : ''}`} />
                      Import a course
                    </button>
                  )}
                  newRow={{
                    ...(snapshot && windDeg != null
                      ? { wind: figureField(windDeg, display).text, windKept: figureField(windDeg, display).kept }
                      : { wind: '' }),
                    windSpeed: offerWindSpeed && windKt != null ? String(windKt) : '',
                  }}
                >
                  <p className="text-xs text-muted-foreground">
                    One row per leg, in sailing order; split a leg into two rows when
                    the wind shifts along it. The course distance is the total.
                    {optionScoresRecordedWind && ' This option scores at the wind recorded here, so every leg needs a speed.'}
                  </p>
                </LegTable>
                {importOpen && (
                  <ConstructedCourseImport
                    variationAt={importVariationAt}
                    chartSet={chartSet}
                    onUse={(course, v) => void applyImportedCourse(course, v)}
                    onCancel={() => setImportOpen(false)}
                  />
                )}
              </div>
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
                placeholder="implied wind"
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
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm font-medium">Fleets in this start</label>
              {offeredFleets.length > 1 && (
                <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={toggleAllFleets}>
                  {allFleetsSelected ? 'Clear all' : 'Select all'}
                </Button>
              )}
            </div>
            <div className="space-y-1.5">
              {offeredFleets.map((f) => (
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
  );
}
