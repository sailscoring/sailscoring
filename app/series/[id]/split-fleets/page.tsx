'use client';

// Split Fleets — the guided championship workflow.
// See docs/design/ux/flows/split-fleets.md.
//
// Every stage word on this page comes from `words(config)`: sailing
// instructions use two vocabularies that share terms for different stages, so
// writing "qualifying series" or "medal race" into a string here makes the
// page wrong for half its users. `tests/split-fleets-vocabulary.test.ts`
// enforces it.

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Ban, ChevronRight, Loader2, Trash2 } from 'lucide-react';

import { FinaliseResultsDialog } from '@/components/finalise-results-dialog';
import { PreviewDialog } from '@/components/preview-dialog';
import { PublishDialog } from '@/components/publish-dialog';
import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { SplitFleetEditor } from '@/components/split-fleets-editor';
import { useSeriesReadOnly } from '@/components/series-read-only';
import { useFeatures } from '@/components/features-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useSeriesData } from '@/hooks/use-series-data';
import { queryKeys } from '@/hooks/query-keys';
import {
  useAbandonSplitStart,
  useAddSplitStageRaces,
  useApplySplitOverride,
  useCommitSplitRound,
  useDeleteSplitRound,
  useSaveSplitFleetConfig,
  useSplitFleetState,
} from '@/hooks/use-split-fleets';
import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { useConfirm } from '@/components/confirm-dialog';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { competitorRepo, type SplitRoundCommit } from '@/lib/api-repository';
import {
  assignByRankPattern,
  capitaliseStage,
  finalBlockSizes,
  fleetMembers,
  logicalRaces,
  orderForAssignment,
  physicalRaceCompleted,
  pickableFleets,
  provisionalCutIndexes,
  roundsForStage,
  qualifyingRaceCount,
  resolveVocabulary,
  assignFromInitialFleet,
  seedOrder,
  splitFleetStandings,
  stageRaceLabel,
  stageRaceRefs,
  type SeedOrder,
  type SeedTailOrder,
  type SeriesStage,
  type SplitFleetConfig,
  type SplitFleetData,
  type SplitRound,
  type SplitStandingRow,
  type StageRaceRef,
} from '@/lib/split-fleets';
import { compareSailNumbersIgnoringPrefix } from '@/lib/sail-number-sort';
import { isSyntheticFleetName } from '@/lib/publishing';
import { worldSailingProfileUrl } from '@/lib/world-sailing';

interface NextAction { label: string; href?: string }

/** The one obvious next step: the first incomplete physical race, else the
 *  pending ceremony. Advisory — never a rules judgement. */
function computeNextAction(
  data: SplitFleetData,
  config: SplitFleetConfig,
  qualifyingRounds: SplitRound[],
  splitRound: SplitRound | null,
  medalRound: SplitRound | null,
  fleetMeta: Map<string, { label: string; color: string }>,
): NextAction | null {
  const w = words(config);
  if (qualifyingRounds.length === 0) {
    return { label: `seed Round 1 (create the ${w.qualifying.fleetNoun}s)` };
  }
  const stageOrder: SeriesStage[] = ['qualifying', 'final', 'medal'];
  const pending = stageRaceRefs(data)
    .sort(
      (a, b) =>
        stageOrder.indexOf(a.start.stage!) - stageOrder.indexOf(b.start.stage!) ||
        (a.start.stageRaceNumber ?? 0) - (b.start.stageRaceNumber ?? 0),
    )
    .find((ref) => !physicalRaceCompleted(ref, data.competitors, data.finishes));
  if (pending) {
    const fleet = fleetMeta.get(pending.fleetId)?.label ?? '';
    return {
      label: `enter finishes for ${raceLabel(data, pending.start.stage!, pending.start.stageRaceNumber!)} · ${fleet}`,
      href: `/series/${pending.race.seriesId}/races/${pending.race.id}`,
    };
  }
  if (!splitRound) {
    return {
      label: `end the ${w.qualifying.name} and split into ${w.final.fleetNoun}s (when the SIs are satisfied)`,
    };
  }
  if (config.medal && !medalRound) return { label: `select the ${w.medal.fleetNoun}` };
  return null;
}

function DayStrip({ data, config }: { data: SplitFleetData; config: SplitFleetConfig }) {
  // Planned schedule chips reconciled against reality: each planned day
  // shows its races; completed ones tick.
  const stageOrder: SeriesStage[] = ['qualifying', 'final', 'medal'];
  const sorted = stageRaceRefs(data).sort(
    (a, b) =>
      stageOrder.indexOf(a.start.stage!) - stageOrder.indexOf(b.start.stage!) ||
      (a.start.stageRaceNumber ?? 0) - (b.start.stageRaceNumber ?? 0) ||
      a.fleetId.localeCompare(b.fleetId),
  );
  // One chip per logical race (stage+number), ticked when all its physical
  // races are complete.
  const chips: { key: string; label: string; state: 'done' | 'part' | 'todo' }[] = [];
  const seen = new Set<string>();
  for (const ref of sorted) {
    const key = `${ref.start.stage}:${ref.start.stageRaceNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const group = sorted.filter((x) => `${x.start.stage}:${x.start.stageRaceNumber}` === key);
    const done = group.filter((x) => physicalRaceCompleted(x, data.competitors, data.finishes)).length;
    chips.push({
      key,
      label: raceLabel(data, ref.start.stage!, ref.start.stageRaceNumber!),
      state: done === group.length ? 'done' : done > 0 ? 'part' : 'todo',
    });
  }
  const plannedTotal = config.plannedDays.reduce((n, d) => n + d.races, 0);
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-testid="sf-day-strip">
      {chips.map((c) => (
        <span
          key={c.key}
          className={`rounded-md border px-2 py-0.5 text-xs font-medium ${
            c.state === 'done'
              ? 'border-green-600/40 bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'
              : c.state === 'part'
                ? 'border-amber-300 bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                : 'text-muted-foreground'
          }`}
        >
          {c.label}
          {c.state === 'done' ? ' ✓' : c.state === 'part' ? ' ◐' : ''}
        </span>
      ))}
      {plannedTotal > chips.length && (
        <span className="text-xs text-muted-foreground">
          · {plannedTotal - chips.length} more planned
        </span>
      )}
    </div>
  );
}

/** The medal phase is complete when the medal fleet has sailed at least the
 *  planned race count and every medal-stage race (incl. the companion last
 *  race) is complete. */
function medalPhaseComplete(
  data: SplitFleetData,
  medalRound: SplitRound,
  config: SplitFleetConfig,
): boolean {
  const medalRefs = stageRaceRefs(data, 'medal');
  if (medalRefs.length === 0) return false;
  if (!medalRefs.every((ref) => physicalRaceCompleted(ref, data.competitors, data.finishes))) {
    return false;
  }
  const medalFleetRefs = medalRefs.filter((ref) => ref.fleetId === medalRound.fleetIds[0]);
  return medalFleetRefs.length >= (config.medal?.raceCount ?? 1);
}

/** How many logical races the first round covers: the planned first day's
 *  count (default 2). */
function plannedFirstRaces(config: SplitFleetConfig): number[] {
  const n = Math.max(1, config.plannedDays[0]?.races ?? 2);
  return Array.from({ length: n }, (_, i) => i + 1);
}
import type { Competitor, CompetitorFieldKey, Finish, Fleet, Race } from '@/lib/types';

// ─── Demo data ──────────────────────────────────────────────────────────────

const DEMO_NAMES = [
  'Aoife Brennan', 'Cian Walsh', 'Fiadh O’Connor', 'Tom Vasseur',
  'Marit Bouwmeester', 'Elena Vorobeva', 'Jon Emmett', 'Pavlos Kontides',
  'Anne-Marie Rindom', 'Matt Wearn', 'Agata Barwinska', 'Micky Beckett',
  'Tonci Stipanovic', 'Sarah Douglas', 'Philipp Buhl', 'Line Flem Host',
  'Kaarle Tapper', 'Marie Barrue', 'Duko Bos', 'Eve McMahon',
  'Finn Lynch', 'Ewan McMahon', 'Zoe Thomson', 'Lorenzo Chiavarini',
];
const DEMO_NATIONS = ['IRL', 'GBR', 'FRA', 'ESP', 'ITA', 'GER', 'NED', 'DEN'];

function buildDemoCompetitors(seriesId: string, defaultFleetId: string | null): Competitor[] {
  return DEMO_NAMES.map((name, i) => ({
    id: crypto.randomUUID(),
    seriesId,
    fleetIds: defaultFleetId ? [defaultFleetId] : [],
    // Digits-only: finish-entry lookup matches sail numbers from the start
    // of the string, so a country prefix would defeat number-only entry.
    sailNumber: `${210001 + i * 137}`,
    names: [name],
    club: '',
    nationality: DEMO_NATIONS[i % DEMO_NATIONS.length],
    gender: '',
    age: null,
    createdAt: Date.now() + i,
  }));
}

// ─── Shared bits ────────────────────────────────────────────────────────────

/** The stage words this series uses (see `Vocabulary`), plus the two forms
 *  the page needs: `title` for a heading, and each stage's own nouns. */
function words(config: SplitFleetConfig) {
  const vocab = resolveVocabulary(config);
  return {
    /** Stages 1 and 2 together. */
    series: vocab.seriesName,
    qualifying: vocab.stages.qualifying,
    final: vocab.stages.final,
    medal: vocab.stages.medal,
    title: (stage: SeriesStage) => capitaliseStage(vocab.stages[stage].name),
  };
}

/** The Format section's collapsed one-liner. */
function formatSummary(config: SplitFleetConfig): string {
  const w = words(config);
  const carry =
    config.carry === 'points'
      ? 'one continuous series'
      : config.carry === 'net-plus-net'
        ? 'two series added together'
        : `${w.qualifying.name} position carried forward`;
  return [
    `${config.qualifyingFleets.map((f) => f.label).join('/')} → ${config.finalFleets.map((f) => f.label).join('/')}`,
    carry,
    config.medal ? `${w.medal.name} ×${config.medal.multiplier}` : `no ${w.medal.raceNoun}`,
  ].join(' · ');
}

/** A race's label as the notice board writes it, per the series' numbering. */
function raceLabel(data: SplitFleetData, stage: SeriesStage, n: number): string {
  return stageRaceLabel(data.config, stage, n, qualifyingRaceCount(data));
}

interface FleetMeta {
  label: string;
  color: string;
}

/** fleetId → label/colour, resolved from the rounds + config. */
function buildFleetMeta(
  data: SplitFleetData,
  fleets: Fleet[],
): Map<string, FleetMeta> {
  const byId = new Map(fleets.map((f) => [f.id, f]));
  const meta = new Map<string, FleetMeta>();
  for (const round of data.rounds) {
    round.fleetIds.forEach((fid, i) => {
      const palette =
        round.stage === 'qualifying'
          ? data.config.qualifyingFleets
          : round.stage === 'final'
            ? data.config.finalFleets
            : [
                { label: capitaliseStage(words(data.config).medal.name), color: '#f59e0b' },
                { label: 'Last race', color: '#94a3b8' },
              ];
      meta.set(fid, {
        label: byId.get(fid)?.name ?? palette[i]?.label ?? '?',
        color: palette[Math.min(i, palette.length - 1)]?.color ?? '#94a3b8',
      });
    });
  }
  return meta;
}

/** The bare fleet marker: a small flat-colour dot, bordered so pale fleet
 *  colours hold up against the cell tint behind it. */
function FleetDot({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="mr-1 inline-block h-1.5 w-1.5 rounded-full border border-foreground/30 align-middle"
      style={{ backgroundColor: color }}
    />
  );
}

function FleetChip({ meta, count }: { meta: FleetMeta; count?: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium"
      style={{ borderColor: meta.color }}
    >
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
      {count !== undefined && <span className="text-muted-foreground">{count}</span>}
    </span>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function SplitFleetsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: seriesId } = use(params);
  const data = useSeriesData(seriesId, { finishes: true, raceStarts: true });
  const { data: sfState } = useSplitFleetState(seriesId);
  const readOnly = useSeriesReadOnly();
  const { can } = useWorkspacePermissions();
  const qc = useQueryClient();
  const [showPublish, setShowPublish] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showFinalise, setShowFinalise] = useState(false);
  const { has } = useFeatures();

  // The scorer bounces between this view and finish entry all day; the
  // global 30s staleTime would otherwise show a just-entered sheet as
  // still pending on return.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: queryKeys.finishes.bySeries(seriesId) });
  }, [qc, seriesId]);

  // Same keys as the Standings tab this page replaces on split-fleet series.
  const canPublish = can('score');
  useShortcuts([
    ...(canPublish
      ? [{ key: 'p', description: 'Publish results', section: 'Split Fleets', handler: () => setShowPublish(true) }]
      : []),
    { key: 'x', description: 'Preview results', section: 'Split Fleets', handler: () => setShowPreview(true) },
  ]);

  if (data.status !== 'ready' || sfState === undefined) {
    return <SeriesTabFallback status={data.status === 'missing' ? 'missing' : 'loading'} />;
  }

  const canManage = !readOnly && can('manage-series');
  // Results lifecycle mirrors the Standings page: the chip and finalise
  // affordance are feature-gated, but a series already marked final always
  // shows its state.
  const isFinal = data.series.resultsStatus === 'final';
  const showResultsStatus = has('results-status') || isFinal;
  const { competitors, fleets, races } = data;
  const allFinishes = data.finishes ?? [];
  const raceStarts = data.raceStarts ?? [];

  if (!sfState.config) {
    // Normally unreachable — the tab only shows for configured series. A
    // direct URL lands here before setup: point at the enable paths.
    return (
      <div className="bg-card border rounded-lg p-5 max-w-xl">
        <p className="text-sm text-muted-foreground">
          Split fleets isn&rsquo;t set up for this series. Enable it from the
          series setup wizard or the Split-fleet championship card in{' '}
          <Link href={`/series/${seriesId}/settings`} className="underline">Settings</Link>.
        </p>
      </div>
    );
  }

  const sfData: SplitFleetData = {
    config: sfState.config,
    rounds: sfState.rounds,
    fleets,
    competitors,
    races,
    raceStarts,
    finishes: allFinishes,
  };

  const fleetMeta = buildFleetMeta(sfData, fleets);
  const qualifyingRounds = roundsForStage(sfState.rounds, 'qualifying');
  const splitRound = roundsForStage(sfState.rounds, 'final')[0] ?? null;
  const medalRound = roundsForStage(sfState.rounds, 'medal')[0] ?? null;
  const standings = splitFleetStandings(sfData);

  const nextAction = computeNextAction(sfData, sfState.config, qualifyingRounds, splitRound, medalRound, fleetMeta);

  return (
    <div className="space-y-6">
      {competitors.length === 0 && canManage && (
        <DemoCompetitorsCard seriesId={seriesId} defaultFleetId={fleets[0]?.id ?? null} />
      )}
      <DayStrip data={sfData} config={sfState.config} />
      {nextAction && (
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-4 py-2 text-sm" data-testid="sf-next-action">
          <span>
            <span className="text-muted-foreground">Next:</span> {nextAction.label}
          </span>
          {nextAction.href && (
            <Link href={nextAction.href} className="text-sm font-medium underline">
              Open
            </Link>
          )}
        </div>
      )}
      <StageSection
        title="Format"
        status={formatSummary(sfState.config)}
        defaultOpen={false}
      >
        <SplitFleetEditor
          seriesId={seriesId}
          config={sfState.config}
          competitorCount={competitors.length}
          canEdit={canManage}
          locked={allFinishes.length > 0}
          layout="wide"
        />
        {allFinishes.length > 0 && (
          <p className="text-xs text-muted-foreground">
            The fleet count and the way scores carry are settled now that racing
            has started — changing them would re-deal fleets that have already
            sailed. Everything else re-scores as you change it.
          </p>
        )}
      </StageSection>
      <StageSection
        title={words(sfState.config).title('qualifying')}
        status={
          qualifyingRounds.length === 0
            ? 'Not started'
            : splitRound
              ? 'Complete'
              : 'In progress'
        }
        defaultOpen={!splitRound}
      >
        <QualifyingSection
          seriesId={seriesId}
          data={sfData}
          fleetMeta={fleetMeta}
          rounds={qualifyingRounds}
          split={splitRound !== null}
          canManage={canManage}
        />
      </StageSection>

      <StageSection
        title={words(sfState.config).title('final')}
        status={splitRound ? (medalRound ? 'Complete' : 'In progress') : 'Not started'}
        defaultOpen={!!splitRound && !medalRound}
      >
        {splitRound ? (
          <FinalSection
            seriesId={seriesId}
            data={sfData}
            fleetMeta={fleetMeta}
            round={splitRound}
            medalRound={medalRound}
            standings={standings}
            canManage={canManage}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            The {words(sfState.config).final.name} begins when the{' '}
            {words(sfState.config).qualifying.name} ends and the fleet is split.
          </p>
        )}
      </StageSection>

      {sfState.config.medal && (
        <StageSection
          title={words(sfState.config).title('medal')}
          status={
            medalRound
              ? medalPhaseComplete(sfData, medalRound, sfState.config)
                ? 'Complete'
                : 'In progress'
              : 'Not started'
          }
          defaultOpen={!!medalRound && !medalPhaseComplete(sfData, medalRound, sfState.config)}
        >
          {medalRound ? (
            <MedalSection
              seriesId={seriesId}
              data={sfData}
              fleetMeta={fleetMeta}
              round={medalRound}
              canManage={canManage}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              The top {sfState.config.medal.size} after the {words(sfState.config).series}{' '}
              sail the {words(sfState.config).medal.name}.
            </p>
          )}
        </StageSection>
      )}

      <StandingsSection
        data={sfData}
        fleetMeta={fleetMeta}
        standings={standings}
        splitRound={splitRound}
        enabledFields={data.series.enabledCompetitorFields ?? []}
        onPublish={can('manage-workspace') || can('score') ? () => setShowPublish(true) : undefined}
        onPreview={() => setShowPreview(true)}
        entryListPublishable={has('entry-list')}
        resultsStatus={
          showResultsStatus
            ? {
                isFinal,
                finalisedAt: data.series.finalisedAt,
                onMarkFinal:
                  can('score') && !readOnly && !isFinal
                    ? () => setShowFinalise(true)
                    : undefined,
              }
            : undefined
        }
      />
      {/* The round fleets are internal — the published output is the
          championship page + the per-race results page + the assignments
          page, so both dialogs run in single-default-page mode (empty fleet
          list) and the build emits the split-fleet pages itself. */}
      <PreviewDialog
        series={data.series}
        fleets={[]}
        open={showPreview}
        onClose={() => setShowPreview(false)}
        onPublish={can('score') ? () => { setShowPreview(false); setShowPublish(true); } : undefined}
      />
      <PublishDialog
        series={data.series}
        fleets={[]}
        open={showPublish}
        onClose={() => setShowPublish(false)}
        canFtp={false}
        lonePageName="Championship"
        extraPages={['Race results', 'Fleet assignments']}
      />
      <FinaliseResultsDialog
        series={data.series}
        races={races}
        finishes={allFinishes}
        raceStarts={raceStarts}
        open={showFinalise}
        onClose={() => setShowFinalise(false)}
      />

    </div>
  );
}

// ─── Demo competitors ───────────────────────────────────────────────────────

function DemoCompetitorsCard({
  seriesId,
  defaultFleetId,
}: {
  seriesId: string;
  defaultFleetId: string | null;
}) {
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addDemo = async () => {
    setSeeding(true);
    setError(null);
    try {
      await competitorRepo.saveMany(buildDemoCompetitors(seriesId, defaultFleetId));
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSeeding(false);
    }
  };

  return (
    <div className="bg-card border rounded-lg p-4 flex flex-wrap items-center gap-3">
      <p className="text-sm text-muted-foreground">
        No competitors yet — import or add them on the Competitors tab, or try
        the workflow with demo entries.
      </p>
      <Button variant="outline" size="sm" disabled={seeding} onClick={addDemo}>
        {seeding && <Loader2 className="h-4 w-4 animate-spin" />}
        Add {DEMO_NAMES.length} demo competitors
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

// ─── Phase section shell ────────────────────────────────────────────────────

function StageSection({
  title,
  status,
  defaultOpen,
  children,
}: {
  title: string;
  status: string;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  // `defaultOpen` tracks which phase is active, so the section follows it
  // (the Final section auto-expands right after the split commits) until the
  // scorer explicitly toggles, which takes over from then on.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? defaultOpen;
  return (
    <section className="bg-card border rounded-lg">
      <button
        type="button"
        className="flex w-full items-center justify-between px-5 py-3 text-left"
        onClick={() => setUserOpen(!open)}
      >
        <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide">
          <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
          {title}
        </span>
        <span className="text-xs text-muted-foreground">{status}</span>
      </button>
      {open && <div className="border-t px-5 py-4 space-y-4">{children}</div>}
    </section>
  );
}

// ─── Qualifying ─────────────────────────────────────────────────────────────

function QualifyingSection({
  seriesId,
  data,
  fleetMeta,
  rounds,
  split,
  canManage,
}: {
  seriesId: string;
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  rounds: SplitRound[];
  split: boolean;
  canManage: boolean;
}) {
  const [dialog, setDialog] = useState<'seed' | 'reassign' | 'split' | null>(null);
  const confirm = useConfirm();
  const deleteRound = useDeleteSplitRound(seriesId);
  const addRaces = useAddSplitStageRaces(seriesId);
  const lrs = logicalRaces(data, 'qualifying');
  const currentRound = rounds[rounds.length - 1] ?? null;
  const nextStageRace = lrs.length ? Math.max(...lrs.map((l) => l.stageRaceNumber)) + 1 : 1;
  const validCount = lrs.filter((l) => l.valid).length;

  return (
    <div className="space-y-4">
      {rounds.map((round, i) => {
        const covered = lrs.filter(
          (lr) =>
            lr.round?.id === round.id ||
            // logical races covered by this round (not superseded)
            (lr.stageRaceNumber >= round.fromStageRace &&
              (i === rounds.length - 1 || lr.stageRaceNumber < rounds[i + 1].fromStageRace)),
        );
        const isLatest = i === rounds.length - 1;
        return (
          <div key={round.id} className="space-y-2 rounded-lg border bg-muted/30 p-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">
                Round {i + 1} · {raceLabel(data, 'qualifying', round.fromStageRace)}
                {' onward'}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {round.method === 'seeded'
                    ? 'Initial assignment'
                    : round.method === 'manual' && !round.basis
                      ? 'Initial assignment · from the entry list'
                      : round.basis
                        ? `From ranking after ${raceLabel(data, 'qualifying', round.basis.throughStageRace)} · captured ${new Date(round.basis.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                        : 'Manual'}
                </span>
                {round.publishedAt && (
                  <span
                    className="inline-flex items-center rounded-full border border-green-600/40 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-500/40 dark:bg-green-950/40 dark:text-green-400"
                    title={`Assignment list published ${new Date(round.publishedAt).toLocaleDateString()}`}
                  >
                    Published
                  </span>
                )}
                {canManage && isLatest && !split && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label="Delete round"
                    disabled={deleteRound.isPending}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this round?',
                        description:
                          'Everything it created goes with it — its fleets, races, and finishes.',
                        confirmLabel: 'Delete round',
                        destructive: true,
                      });
                      if (ok) deleteRound.mutate(round.id);
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {round.fleetIds.map((fid) => (
                <FleetChip
                  key={fid}
                  meta={fleetMeta.get(fid) ?? { label: '?', color: '#888' }}
                  count={fleetMembers(data.competitors, fid).length}
                />
              ))}
            </div>
            <div className="space-y-1.5">
              {covered.map((lr) => (
                <LogicalRaceRow
                  key={lr.stageRaceNumber}
                  seriesId={seriesId}
                  data={data}
                  fleetMeta={fleetMeta}
                  round={round}
                  stage="qualifying"
                  stageRaceNumber={lr.stageRaceNumber}
                  canManage={canManage && !split}
                />
              ))}
            </div>
          </div>
        );
      })}

      {canManage && !split && (
        <div className="flex flex-wrap items-center gap-2">
          {rounds.length === 0 ? (
            <Button onClick={() => setDialog('seed')}>
              Assign {words(data.config).qualifying.fleetNoun}s
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setDialog('reassign')}>
                Assign Round {rounds.length + 1}
              </Button>
              <Button
                variant="outline"
                disabled={addRaces.isPending}
                onClick={() =>
                  currentRound &&
                  addRaces.mutate({
                    roundId: currentRound.id,
                    stageRaceNumbers: [nextStageRace],
                  })
                }
              >
                Add race {raceLabel(data, 'qualifying', nextStageRace)}
              </Button>
              <Button onClick={() => setDialog('split')} disabled={validCount === 0}>
                End the {words(data.config).qualifying.name} → split fleets
              </Button>
              <span className="text-xs text-muted-foreground">
                {validCount} of {lrs.length} {words(data.config).qualifying.raceNoun}s count
                {data.config.discardThresholds[0]
                  ? ` · SIs typically require ≥${data.config.discardThresholds[0].minRaces}`
                  : ''}
              </span>
            </>
          )}
        </div>
      )}

      {dialog === 'seed' && (
        <SeedRoundDialog seriesId={seriesId} data={data} onClose={() => setDialog(null)} />
      )}
      {dialog === 'reassign' && currentRound && (
        <ReassignDialog
          seriesId={seriesId}
          data={data}
          fleetMeta={fleetMeta}
          roundNumber={rounds.length + 1}
          fromStageRace={nextStageRace}
          throughStageRace={validCount}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'split' && (
        <SplitDialog
          seriesId={seriesId}
          data={data}
          throughStageRace={validCount}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function LogicalRaceRow({
  seriesId,
  data,
  fleetMeta,
  round,
  stage,
  stageRaceNumber,
  canManage,
}: {
  seriesId: string;
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  round: SplitRound;
  stage: SeriesStage;
  stageRaceNumber: number;
  canManage: boolean;
}) {
  const confirm = useConfirm();
  const abandon = useAbandonSplitStart(seriesId);
  const addRaces = useAddSplitStageRaces(seriesId);
  const refs = new Map(
    stageRaceRefs(data, stage)
      .filter((ref) => ref.start.stageRaceNumber === stageRaceNumber)
      .map((ref) => [ref.fleetId, ref]),
  );
  const missing = round.fleetIds.filter((fid) => {
    const ref = refs.get(fid);
    return !ref || !physicalRaceCompleted(ref, data.competitors, data.finishes);
  });
  const valid = missing.length === 0;
  return (
    <div
      className="flex flex-wrap items-center gap-2 text-sm"
      data-testid={`logical-race-${stage}-${stageRaceNumber}`}
    >
      <span className="w-8 font-medium">{raceLabel(data, stage, stageRaceNumber)}</span>
      {round.fleetIds.map((fid) => {
        const ref = refs.get(fid);
        const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
        if (!ref) {
          // Abandoned (or never created): offer the catch-up race — its own
          // one-start sequence, usually sailed first the next day.
          return (
            <span key={fid} className="inline-flex items-center gap-1">
              <span className="rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
                {meta.label} — no race
              </span>
              {canManage && (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={addRaces.isPending}
                  onClick={() =>
                    addRaces.mutate({
                      roundId: round.id,
                      stageRaceNumbers: [stageRaceNumber],
                      fleetIds: [fid],
                    })
                  }
                >
                  Add catch-up race
                </Button>
              )}
            </span>
          );
        }
        const done = physicalRaceCompleted(ref, data.competitors, data.finishes);
        return (
          <span key={fid} className="inline-flex items-center gap-0.5">
            <Link
              href={`/series/${seriesId}/races/${ref.race.id}`}
              className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-background/70"
              style={{
                borderColor: meta.color,
                backgroundColor: done ? `${meta.color}33` : undefined,
              }}
            >
              {meta.label} {done ? '✓' : '· enter finishes'}
            </Link>
            {canManage && !done && (
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Abandon ${meta.label}'s race`}
                title={`Abandon ${meta.label}'s race`}
                disabled={abandon.isPending}
                onClick={async () => {
                  const ok = await confirm({
                    title: `Abandon ${meta.label}'s ${raceLabel(data, stage, stageRaceNumber)}?`,
                    description: `This removes ${meta.label} from the start sequence and voids any of its rows on the sheet; the other fleets stand. Re-race it with “Add catch-up race”.`,
                    confirmLabel: 'Abandon',
                    destructive: true,
                  });
                  if (ok) abandon.mutate({ raceId: ref.race.id, fleetId: fid });
                }}
              >
                <Ban className="h-3 w-3" />
              </Button>
            )}
          </span>
        );
      })}
      {stage === 'qualifying' && (
        <span className={`text-xs ${valid ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
          {valid ? 'counts' : 'does not count yet'}
        </span>
      )}
    </div>
  );
}

// ─── Ceremony dialogs ───────────────────────────────────────────────────────

/** A ceremony's basis as the dialog knows it — which races the ranking was
 *  taken over. When it was taken is not the dialog's to say. */
type CeremonyPayload = Omit<SplitRoundCommit, 'basis'> & {
  basis: { throughStageRace: number } | null;
};

function useCommit(seriesId: string, onClose: () => void) {
  const commit = useCommitSplitRound(seriesId);
  /** The snapshot time is stamped here, at the moment of commit — the SIs'
   *  "the ranking available at 2000 that day". Reading the clock in a dialog
   *  body instead would put it in render, where a re-render moves it. */
  const run = async (payload: CeremonyPayload) => {
    try {
      await commit.mutateAsync({
        ...payload,
        basis: payload.basis ? { ...payload.basis, capturedAt: Date.now() } : null,
      });
      onClose();
    } catch {
      // error surfaced via commit.isError below
    }
  };
  return { commit, run };
}

function CeremonyDialog({
  title,
  description,
  error,
  pending,
  commitLabel,
  blockedReason,
  onCommit,
  onClose,
  children,
}: {
  title: string;
  description: string;
  error: string | null;
  pending: boolean;
  commitLabel: string;
  /** Why the ceremony can't commit yet — shown by the button, which is
   *  disabled while it is set. */
  blockedReason?: string | null;
  onCommit: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-3 overflow-y-auto">{children}</div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <DialogFooter>
          {blockedReason && (
            <p className="mr-auto self-center text-sm text-amber-700 dark:text-amber-400">
              {blockedReason}
            </p>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending || !!blockedReason} onClick={onCommit}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {commitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Non-round fleets a ceremony may offer to delete: owned by no round and
 *  referenced by no race start (a series converted to a championship after
 *  racing keeps its old starts, and those fleets must stay). */
function deletableLeftoverFleets(data: SplitFleetData): Fleet[] {
  return pickableFleets(data.fleets).filter(
    (f) => !data.raceStarts.some((s) => s.fleetIds.includes(f.id)),
  );
}

/** A ceremony's offer to shed pre-championship fleets — the "Default" an
 *  entry-list import leaves behind, or a converted series' old fleets. The
 *  server strips memberships and deletes the rows in the same transaction as
 *  the round commit. Offered on every ceremony until the series is clean. */
function DeleteLeftoverFleetsChoice({
  fleets,
  checked,
  onChange,
}: {
  fleets: Fleet[];
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  if (fleets.length === 0) return null;
  const names = fleets.map((f) => `“${f.name}”`).join(', ');
  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        Also remove the {fleets.length === 1 ? 'fleet' : 'fleets'} {names}.
        Assignment rounds deal this championship&rsquo;s fleets, so{' '}
        {fleets.length === 1 ? 'it' : 'they'} would sit unused; no boat loses a
        round assignment.
      </span>
    </label>
  );
}

/** Whether every leftover carries one of the app's own synthetic names — the
 *  case the offer pre-checks. Real fleet names (a series that raced as fleets
 *  before becoming a championship) start unchecked: the scorer's call. */
function allSyntheticNames(fleets: Fleet[]): boolean {
  return fleets.length > 0 && fleets.every((f) => isSyntheticFleetName(f.name));
}

function AssignmentPreviewTable({
  rows,
  fleetLabels,
  allowUnassigned,
  onMove,
}: {
  rows: { id: string; sail: string; name: string; rank?: number; from?: string; to: string; moved?: boolean; overridden?: boolean }[];
  /** When set (with onMove), each row gets a fleet select — the editable
   *  preview: hand-moves are recorded as overrides on commit. */
  fleetLabels?: string[];
  /** Offer an empty choice, for a boat the entry list placed nowhere. Such a
   *  row carries `to: ''` until the scorer picks. */
  allowUnassigned?: boolean;
  onMove?: (competitorId: string, toLabel: string) => void;
}) {
  const hasFrom = rows.some((r) => r.from !== undefined);
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 pr-2 font-medium">#</th>
          <th className="py-1 pr-2 font-medium">Sail</th>
          <th className="py-1 pr-2 font-medium">Name</th>
          {hasFrom && <th className="py-1 pr-2 font-medium">From</th>}
          <th className="py-1 font-medium">Fleet</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id}>
            {/* The standings rank where one exists (shared on a tie A8 could
                not break); the row's list position otherwise — a seeding has
                no ranking yet. Never the deal position: numbering a tied pair
                140/141 here would present the deal's choice as a ranking. */}
            <td className="py-1 pr-2 text-muted-foreground">{r.rank ?? i + 1}</td>
            <td className="py-1 pr-2 whitespace-nowrap">{r.sail}</td>
            <td className="py-1 pr-2">{r.name}</td>
            {hasFrom && <td className="py-1 pr-2 text-muted-foreground">{r.from}</td>}
            <td className={`py-1 ${r.moved ? 'font-semibold' : ''}`}>
              {fleetLabels && onMove ? (
                <select
                  className={`rounded border bg-background px-1 py-0.5 text-xs${
                    r.to ? '' : ' border-amber-500 text-amber-700 dark:text-amber-400'
                  }`}
                  aria-label={`Fleet for ${r.sail}`}
                  value={r.to}
                  onChange={(e) => onMove(r.id, e.target.value)}
                >
                  {allowUnassigned && <option value="">— not assigned —</option>}
                  {fleetLabels.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              ) : (
                r.to
              )}
              {r.overridden && (
                <span className="ml-1 rounded-full border border-amber-400 px-1 text-[10px] text-amber-600 dark:text-amber-400">
                  moved by hand
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SeedRoundDialog({
  seriesId,
  data,
  onClose,
}: {
  seriesId: string;
  data: SplitFleetData;
  onClose: () => void;
}) {
  const { commit, run } = useCommit(seriesId, onClose);
  /** Where the assignment comes from. `imported` is not an order at all — it
   *  is the assignment the seeding committee already made, carried on the
   *  entry list; the rest are orders dealt through the reassignment
   *  pattern. */
  const [source, setSource] = useState<'imported' | SeedOrder>(() =>
    data.competitors.some((c) => c.initialFleet) ? 'imported' : 'seed-rank',
  );
  const order: SeedOrder = source === 'imported' ? 'seed-rank' : source;
  // Sailors the ranking didn't reach sort below it either way; this decides
  // the order within that tail. Defaulted to sail number to agree with
  // `seedOrder` — when *no one* carries a seeding rank, "seeding rank" order
  // is the tail order and nothing else, and that is no place to spring a
  // different assignment on a scorer. Spreading by nation is the better
  // choice at a charter event, so it's offered, not assumed.
  const [tailOrder, setTailOrder] = useState<SeedTailOrder>('sail-number');
  const [moves, setMoves] = useState<Record<string, number | null>>({});
  const qFleets = data.config.qualifyingFleets;
  const anyImported = data.competitors.some((c) => c.initialFleet);
  const leftovers = useMemo(() => deletableLeftoverFleets(data), [data]);
  const [dropLeftovers, setDropLeftovers] = useState(() => allSyntheticNames(leftovers));

  const preview = useMemo(() => {
    const byId = new Map(data.competitors.map((c) => [c.id, c]));
    const computed: Record<string, number> = {};
    let ordered: string[];
    let unknownLabels: string[] = [];
    if (source === 'imported') {
      const read = assignFromInitialFleet(data.competitors, qFleets);
      Object.assign(computed, read.assignments);
      unknownLabels = read.unknownLabels;
      // Fleet order, then sail number within each — how the committee's own
      // lists read, and how the scorer checks them. Boats it placed nowhere
      // come last, where they can't be missed.
      ordered = [...data.competitors]
        .sort(
          (a, b) =>
            (computed[a.id] ?? qFleets.length) - (computed[b.id] ?? qFleets.length) ||
            compareSailNumbersIgnoringPrefix(a.sailNumber, b.sailNumber),
        )
        .map((c) => c.id);
    } else {
      ordered = seedOrder(data.competitors, order, tailOrder);
      assignByRankPattern(ordered, qFleets.length).forEach((ids, i) =>
        ids.forEach((cid) => (computed[cid] = i)),
      );
    }
    // Hand-moves layer on top; a move to "not assigned" is stored as null.
    const assignments: Record<string, number> = { ...computed };
    for (const [cid, idx] of Object.entries(moves)) {
      if (idx == null) delete assignments[cid];
      else assignments[cid] = idx;
    }
    const unassigned = ordered.filter((cid) => assignments[cid] == null);
    return {
      assignments,
      unassigned,
      unknownLabels,
      rows: ordered.map((cid) => {
        const c = byId.get(cid)!;
        const idx = assignments[cid];
        return {
          id: cid,
          sail: c.sailNumber,
          name: c.names.join(' & '),
          to: idx == null ? '' : qFleets[idx].label,
          overridden: moves[cid] !== undefined,
        };
      }),
      sizes: qFleets.map((_, i) => Object.values(assignments).filter((v) => v === i).length),
    };
  }, [data.competitors, source, order, tailOrder, moves, qFleets]);

  return (
    <CeremonyDialog
      title={`Assign ${words(data.config).qualifying.fleetNoun}s (Round 1)`}
      description="Make the initial assignment — normally from the seeding committee's ranking — and create the first day's races."
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit Round 1 (${preview.sizes.join(' / ')})`}
      blockedReason={
        preview.unassigned.length > 0
          ? `${preview.unassigned.length} ${preview.unassigned.length === 1 ? 'boat is' : 'boats are'} in no fleet — place ${preview.unassigned.length === 1 ? 'it' : 'them'} to commit.`
          : null
      }
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'qualifying',
          fromStageRace: 1,
          // The committee's own assignment is not a seeding this app
          // performed, and the round says so.
          method: source === 'imported' ? 'manual' : 'seeded',
          basis: null,
          fleets: qFleets,
          assignments: preview.assignments,
          overrideCompetitorIds: Object.keys(moves).filter((cid) => moves[cid] != null),
          stageRaceNumbers: plannedFirstRaces(data.config),
          deleteFleetIds: dropLeftovers ? leftovers.map((f) => f.id) : [],
        })
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm" htmlFor="sf-seed-order">
          Assign from
        </label>
        <select
          id="sf-seed-order"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={source}
          onChange={(e) => { setSource(e.target.value as 'imported' | SeedOrder); setMoves({}); }}
        >
          {anyImported && <option value="imported">The entry list&rsquo;s initial fleet</option>}
          <option value="seed-rank">Seeding rank</option>
          <option value="nationality-spread">Nationality, then sail number</option>
          <option value="sail-number">Sail number</option>
        </select>
        {source === 'imported' && (
          <span className="text-xs text-muted-foreground">
            Taken as given — the pattern deals the other three.
          </span>
        )}
        {source === 'seed-rank' && data.competitors.some((c) => c.seed == null) && (
          <>
            <label className="text-sm" htmlFor="sf-seed-tail">
              Sailors with no seeding rank
            </label>
            <select
              id="sf-seed-tail"
              className="rounded-md border bg-background px-2 py-1 text-sm"
              value={tailOrder}
              onChange={(e) => { setTailOrder(e.target.value as SeedTailOrder); setMoves({}); }}
            >
              <option value="sail-number">Sail number</option>
              <option value="nationality-spread">Nationality, then sail number</option>
            </select>
          </>
        )}
      </div>
      {source === 'imported' && preview.unknownLabels.length > 0 && (
        <p className="rounded-md border border-amber-400 bg-amber-50 p-2 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          No fleet is called{' '}
          {preview.unknownLabels.map((l) => `“${l}”`).join(', ')} — those boats
          are listed below with no fleet. Place them by hand, or rename the
          fleets on the Settings tab to match the entry list.
        </p>
      )}
      <DeleteLeftoverFleetsChoice
        fleets={leftovers}
        checked={dropLeftovers}
        onChange={setDropLeftovers}
      />
      <AssignmentPreviewTable
        rows={preview.rows}
        fleetLabels={qFleets.map((f) => f.label)}
        allowUnassigned={source === 'imported'}
        onMove={(cid, label) =>
          setMoves((m) => ({
            ...m,
            [cid]: label ? qFleets.findIndex((f) => f.label === label) : null,
          }))
        }
      />
    </CeremonyDialog>
  );
}

function ReassignDialog({
  seriesId,
  data,
  fleetMeta,
  roundNumber,
  fromStageRace,
  throughStageRace,
  onClose,
}: {
  seriesId: string;
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  roundNumber: number;
  fromStageRace: number;
  throughStageRace: number;
  onClose: () => void;
}) {
  const { commit, run } = useCommit(seriesId, onClose);
  const [moves, setMoves] = useState<Record<string, number>>({});
  const qFleets = data.config.qualifyingFleets;
  const leftovers = useMemo(() => deletableLeftoverFleets(data), [data]);
  const [dropLeftovers, setDropLeftovers] = useState(() => allSyntheticNames(leftovers));
  const preview = useMemo(() => {
    const rows = orderForAssignment(splitFleetStandings(data), data);
    const ordered = rows.map((r) => r.competitor.id);
    const byFleet = assignByRankPattern(ordered, qFleets.length);
    const dealt: Record<string, number> = {};
    byFleet.forEach((ids, i) => ids.forEach((cid) => (dealt[cid] = i)));
    // A shared rank the pattern splits across fleets: the boats' order within
    // the tie — not the ranking — decided who got which, and the scorer must
    // see that before committing.
    const tieWarnings: string[] = [];
    for (let i = 0; i < rows.length; ) {
      let j = i + 1;
      while (j < rows.length && rows[j].rank === rows[i].rank) j++;
      const group = rows.slice(i, j);
      const fleets = [...new Set(group.map((r) => qFleets[dealt[r.competitor.id]].label))];
      if (group.length > 1 && fleets.length > 1) {
        tieWarnings.push(
          `${group.map((r) => r.competitor.sailNumber).join(', ')} share rank ${rows[i].rank} and RRS A8 cannot separate them — ${
            data.config.reassignmentTieOrder === 'fleet-order'
              ? 'current fleet order'
              : 'entry order'
          } decides who is dealt ${fleets.join('/')}, not the ranking. Move a boat by hand if the committee assigns otherwise.`,
        );
      }
      i = j;
    }
    const assignments: Record<string, number> = { ...dealt, ...moves };
    let moved = 0;
    const table = rows.map((r) => {
      const currentFleetId = r.competitor.fleetIds.findLast((fid) => fleetMeta.has(fid));
      const from = currentFleetId ? fleetMeta.get(currentFleetId)?.label : undefined;
      const to = qFleets[assignments[r.competitor.id]].label;
      const didMove = from !== undefined && from !== to;
      if (didMove) moved++;
      return {
        id: r.competitor.id,
        sail: r.competitor.sailNumber,
        name: r.competitor.names.join(' & '),
        rank: r.rank,
        from,
        to,
        moved: didMove,
        overridden: moves[r.competitor.id] != null,
      };
    });
    return { assignments, table, moved, tieWarnings };
  }, [data, qFleets, fleetMeta, moves]);

  return (
    <CeremonyDialog
      title={`Assign Round ${roundNumber} · ${raceLabel(data, 'qualifying', fromStageRace)} onward`}
      description={`From the ranking after ${raceLabel(data, 'qualifying', throughStageRace)} — the races completed by all fleets. Captured now; later rescoring will not change this assignment. Hand-moves (late entries, committee instructions) are recorded as overrides.`}
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit Round ${roundNumber} (${preview.moved} boats change fleet)`}
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'qualifying',
          fromStageRace,
          method: 'rank-pattern',
          basis: { throughStageRace },
          fleets: qFleets,
          assignments: preview.assignments,
          overrideCompetitorIds: Object.keys(moves),
          stageRaceNumbers: [fromStageRace, fromStageRace + 1],
          deleteFleetIds: dropLeftovers ? leftovers.map((f) => f.id) : [],
        })
      }
    >
      <DeleteLeftoverFleetsChoice
        fleets={leftovers}
        checked={dropLeftovers}
        onChange={setDropLeftovers}
      />
      {preview.tieWarnings.map((t) => (
        <p key={t} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ {t}
        </p>
      ))}
      <AssignmentPreviewTable
        rows={preview.table}
        fleetLabels={qFleets.map((f) => f.label)}
        onMove={(cid, label) =>
          setMoves((m) => ({ ...m, [cid]: qFleets.findIndex((f) => f.label === label) }))
        }
      />
    </CeremonyDialog>
  );
}

function SplitDialog({
  seriesId,
  data,
  throughStageRace,
  onClose,
}: {
  seriesId: string;
  data: SplitFleetData;
  throughStageRace: number;
  onClose: () => void;
}) {
  const { commit, run } = useCommit(seriesId, onClose);
  const fFleets = data.config.finalFleets;
  const rows = useMemo(() => splitFleetStandings(data), [data]);
  const defaultTop =
    data.config.split.kind === 'fixed-top'
      ? Math.min(data.config.split.topSize, rows.length)
      : finalBlockSizes(rows.length, fFleets.length)[0];
  const [topSize, setTopSize] = useState(defaultTop);
  const [moves, setMoves] = useState<Record<string, number>>({});
  const leftovers = useMemo(() => deletableLeftoverFleets(data), [data]);
  const [dropLeftovers, setDropLeftovers] = useState(() => allSyntheticNames(leftovers));

  const preview = useMemo(() => {
    // Top fleet takes `topSize`; the remainder splits near-equally. The deal
    // runs over the assignment order: the ranking, with each shared rank
    // ordered per the configured tie order.
    const dealt = orderForAssignment(rows, data);
    const rest = finalBlockSizes(Math.max(0, rows.length - topSize), Math.max(1, fFleets.length - 1));
    const sizes = [topSize, ...rest];
    let assignments: Record<string, number> = {};
    let idx = 0;
    sizes.forEach((size, fleetIdx) => {
      for (let k = 0; k < size && idx < dealt.length; k++, idx++) {
        assignments[dealt[idx].competitor.id] = fleetIdx;
      }
    });
    assignments = { ...assignments, ...moves };
    const table = dealt.map((r) => ({
      id: r.competitor.id,
      sail: r.competitor.sailNumber,
      name: r.competitor.names.join(' & '),
      rank: r.rank,
      to: fFleets[assignments[r.competitor.id]].label,
      overridden: moves[r.competitor.id] != null,
    }));
    // Boundary-tie diagnostics: equal nets across a fleet boundary. A shared
    // rank means RRS A8 could not separate the boats — the boundary between
    // them is a choice, not a ranking, and the scorer must see which rule
    // made it.
    const boundaryTies: string[] = [];
    let cum = 0;
    for (let i = 0; i < sizes.length - 1; i++) {
      cum += sizes[i];
      const a = dealt[cum - 1];
      const b = dealt[cum];
      if (!a || !b || a.net !== b.net) continue;
      const boundary = `${fFleets[i].label}/${fFleets[i + 1].label}`;
      boundaryTies.push(
        a.rank === b.rank
          ? `${a.competitor.sailNumber} and ${b.competitor.sailNumber} tie on ${a.net} and RRS A8 cannot separate them — the last ${boundary} place is dealt by ${
              data.config.reassignmentTieOrder === 'fleet-order'
                ? 'current fleet order'
                : 'entry order'
            }, not by the ranking. Move a boat by hand if the SIs direct otherwise.`
          : `Ranks ${cum}/${cum + 1} (${a.competitor.sailNumber}, ${b.competitor.sailNumber}) tie on ${a.net} — separated by RRS A8; the ${boundary} boundary depends on it.`,
      );
    }
    const counted = Object.values(assignments);
    return {
      assignments,
      table,
      sizes: fFleets.map((_, i) => counted.filter((v) => v === i).length),
      boundaryTies,
    };
  }, [rows, data, topSize, moves, fFleets]);

  return (
    <CeremonyDialog
      title={`Split into ${words(data.config).final.fleetNoun}s`}
      description={`Basis: the ${words(data.config).qualifying.name} ranking after ${raceLabel(data, 'qualifying', throughStageRace)}. The split is frozen once committed — later rescoring will not change it (a redress decision may promote). Creates the ${words(data.config).final.fleetNoun}s and the first ${words(data.config).final.raceNoun}.`}
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit split (${preview.sizes.join(' / ')})`}
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'final',
          fromStageRace: 1,
          method: 'split',
          basis: { throughStageRace },
          fleets: fFleets,
          assignments: preview.assignments,
          overrideCompetitorIds: Object.keys(moves),
          stageRaceNumbers: [1],
          deleteFleetIds: dropLeftovers ? leftovers.map((f) => f.id) : [],
        })
      }
    >
      <DeleteLeftoverFleetsChoice
        fleets={leftovers}
        checked={dropLeftovers}
        onChange={setDropLeftovers}
      />
      <div className="flex items-center gap-2">
        <label className="text-sm" htmlFor="sf-top-size">
          {fFleets[0]?.label ?? 'Gold'} fleet size
        </label>
        <input
          id="sf-top-size"
          type="number"
          min={1}
          max={rows.length}
          className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
          value={topSize}
          onChange={(e) => { setTopSize(Number(e.target.value)); setMoves({}); }}
        />
        <span className="text-xs text-muted-foreground">
          {data.config.split.kind === 'fixed-top' ? 'fixed-size preset' : 'near-equal blocks; adjust if the SIs direct'}
        </span>
      </div>
      {preview.boundaryTies.map((t) => (
        <p key={t} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          ⚠ {t}
        </p>
      ))}
      <AssignmentPreviewTable
        rows={preview.table}
        fleetLabels={fFleets.map((f) => f.label)}
        onMove={(cid, label) =>
          setMoves((m) => ({ ...m, [cid]: fFleets.findIndex((f) => f.label === label) }))
        }
      />
    </CeremonyDialog>
  );
}

// ─── Stage 2: fleets locked (the "final"/Elimination series) ────────────────

function FinalSection({
  seriesId,
  data,
  fleetMeta,
  round,
  medalRound,
  standings,
  canManage,
}: {
  seriesId: string;
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  round: SplitRound;
  medalRound: SplitRound | null;
  standings: SplitStandingRow[];
  canManage: boolean;
}) {
  const confirm = useConfirm();
  const abandon = useAbandonSplitStart(seriesId);
  const addRaces = useAddSplitStageRaces(seriesId);
  const override = useApplySplitOverride(seriesId);
  const [medalOpen, setMedalOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [overrideWarning, setOverrideWarning] = useState<string | null>(null);
  const medalConfig = data.config.medal;
  const perFleet = data.config.finishSheets === 'per-fleet';
  const w = words(data.config);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Split committed{' '}
        {round.basis
          ? `from the ${w.qualifying.name} ranking after ${raceLabel(data, 'qualifying', round.basis.throughStageRace)}`
          : ''}
        . {capitaliseStage(w.final.fleetNoun)}s{' '}
        {perFleet
          ? 'start in sequence and each finishes onto a sheet of its own'
          : 'usually start in sequence and finish onto one combined sheet'}
        , but need not complete the same number of races — a fleet a race behind simply
        sails its own next number in the sequence.
        {medalRound
          ? ` The ${w.medal.name} boats have left these fleets’ racing, so a race added now is for the rest — which is what sailing instructions mean by one more race for the boats who did not qualify.`
          : ''}
      </p>
      {canManage && (
        <Button
          variant="outline"
          size="xs"
          disabled={addRaces.isPending}
          onClick={() =>
            addRaces.mutate({
              roundId: round.id,
              // Every fleet's next race at once — each start at its own next
              // stage race number, so out-of-step fleets stay out of step. One
              // race carrying them all, or a race each where the sheets are
              // per-fleet; the handler gives the round the shape it was
              // committed with.
              starts: round.fleetIds.map((fid) => {
                const ns = stageRaceRefs(data, 'final')
                  .filter((ref) => ref.fleetId === fid)
                  .map((ref) => ref.start.stageRaceNumber ?? 0);
                return { fleetId: fid, stageRaceNumber: (ns.length ? Math.max(...ns) : 0) + 1 };
              }),
            })
          }
        >
          {perFleet ? 'Add next race · one for each fleet' : 'Add next race · all fleets in one sequence'}
        </Button>
      )}
      {round.fleetIds.map((fid) => {
        const refs = stageRaceRefs(data, 'final')
          .filter((ref) => ref.fleetId === fid)
          .sort((a, b) => (a.start.stageRaceNumber ?? 0) - (b.start.stageRaceNumber ?? 0));
        const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
        const nextN = refs.length
          ? Math.max(...refs.map((ref) => ref.start.stageRaceNumber ?? 0)) + 1
          : 1;
        return (
          <div key={fid} className="flex flex-wrap items-center gap-2">
            <span className="w-40">
              <FleetChip meta={meta} count={fleetMembers(data.competitors, fid).length} />
            </span>
            {refs.map((ref) => {
              const done = physicalRaceCompleted(ref, data.competitors, data.finishes);
              return (
                <span key={ref.start.id} className="inline-flex items-center gap-0.5">
                  <Link
                    href={`/series/${seriesId}/races/${ref.race.id}`}
                    className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-background/70"
                    style={{
                      borderColor: meta.color,
                      backgroundColor: done ? `${meta.color}33` : undefined,
                    }}
                  >
                    {raceLabel(data, 'final', ref.start.stageRaceNumber ?? 0)}{' '}
                    {done ? '✓' : '· enter finishes'}
                  </Link>
                  {canManage && !done && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Abandon ${meta.label}'s F${ref.start.stageRaceNumber}`}
                      title={`Abandon ${meta.label}'s F${ref.start.stageRaceNumber}`}
                      disabled={abandon.isPending}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Abandon ${meta.label}'s F${ref.start.stageRaceNumber}?`,
                          description: `This removes ${meta.label} from the start sequence and voids any of its rows on the sheet; the other fleets stand.`,
                          confirmLabel: 'Abandon',
                          destructive: true,
                        });
                        if (ok) abandon.mutate({ raceId: ref.race.id, fleetId: fid });
                      }}
                    >
                      <Ban className="h-3 w-3" />
                    </Button>
                  )}
                </span>
              );
            })}
            {canManage && (
              <Button
                variant="outline"
                size="xs"
                disabled={addRaces.isPending}
                onClick={() =>
                  addRaces.mutate({
                    roundId: round.id,
                    stageRaceNumbers: [nextN],
                    fleetIds: [fid],
                  })
                }
              >
                Add {raceLabel(data, 'final', nextN)}
              </Button>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && medalConfig && !medalRound && (
          <Button variant="outline" onClick={() => setMedalOpen(true)}>
            Select {words(data.config).medal.fleetNoun}…
          </Button>
        )}
        {canManage && (
          <Button variant="ghost" size="sm" onClick={() => setPromoteOpen(true)}>
            Promote (redress)…
          </Button>
        )}
      </div>
      {overrideWarning && (
        <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
          {overrideWarning}
        </p>
      )}
      {medalOpen && medalConfig && (
        <MedalSelectDialog
          seriesId={seriesId}
          data={data}
          fleetMeta={fleetMeta}
          round={round}
          standings={standings}
          onClose={() => setMedalOpen(false)}
        />
      )}
      {promoteOpen && (
        <Dialog open onOpenChange={(o) => !o && setPromoteOpen(false)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Promote a boat (redress)</DialogTitle>
              <DialogDescription>
                A redress decision may promote a boat to a higher fleet; nobody
                is demoted to make room, so fleets may end unequal. Clean before
                the first {w.final.raceNoun}; after that the boat&rsquo;s existing
                scores in the {w.final.name} need the protest committee&rsquo;s
                direction.
              </DialogDescription>
            </DialogHeader>
            <PromoteForm
              data={data}
              fleetMeta={fleetMeta}
              round={round}
              pending={override.isPending}
              onSubmit={async (competitorId, toFleetId) => {
                const res = await override.mutateAsync({ roundId: round.id, competitorId, toFleetId });
                setOverrideWarning(res.warning);
                setPromoteOpen(false);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function PromoteForm({
  data,
  fleetMeta,
  round,
  pending,
  onSubmit,
}: {
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  round: SplitRound;
  pending: boolean;
  onSubmit: (competitorId: string, toFleetId: string) => Promise<void>;
}) {
  const [competitorId, setCompetitorId] = useState('');
  const [toFleetId, setToFleetId] = useState(round.fleetIds[0] ?? '');
  const candidates = data.competitors.filter((c) => !c.fleetIds.includes(toFleetId));
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <label className="text-sm" htmlFor="sf-promote-fleet">Promote into</label>
        <select
          id="sf-promote-fleet"
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          value={toFleetId}
          onChange={(e) => { setToFleetId(e.target.value); setCompetitorId(''); }}
        >
          {round.fleetIds.map((fid) => (
            <option key={fid} value={fid}>{fleetMeta.get(fid)?.label ?? fid}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-sm" htmlFor="sf-promote-boat">Boat</label>
        <select
          id="sf-promote-boat"
          className="w-full rounded-md border bg-background px-2 py-1 text-sm"
          value={competitorId}
          onChange={(e) => setCompetitorId(e.target.value)}
        >
          <option value="">Choose…</option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>{c.sailNumber} {c.names.join(' & ')}</option>
          ))}
        </select>
      </div>
      <DialogFooter>
        <Button disabled={!competitorId || pending} onClick={() => void onSubmit(competitorId, toFleetId)}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          Promote
        </Button>
      </DialogFooter>
    </div>
  );
}

function MedalSelectDialog({
  seriesId,
  data,
  fleetMeta,
  round,
  standings,
  onClose,
}: {
  seriesId: string;
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  round: SplitRound;
  standings: SplitStandingRow[];
  onClose: () => void;
}) {
  const { commit, run } = useCommit(seriesId, onClose);
  const medalConfig = data.config.medal!;
  const w = words(data.config);
  const [size, setSize] = useState(medalConfig.size);
  const leftovers = useMemo(() => deletableLeftoverFleets(data), [data]);
  const [dropLeftovers, setDropLeftovers] = useState(() => allSyntheticNames(leftovers));
  const goldId = round.fleetIds[0];
  const goldRows = standings.filter((r) => r.finalFleetId === goldId);
  const medalists = goldRows.slice(0, size);
  const goldLabel = fleetMeta.get(goldId)?.label ?? 'Gold';

  // The ceremony deals one fleet and one only. Selecting the medal boats
  // does not move anyone else: the boats who miss the cut stay in the fleet
  // they are in and sail its remaining race there.
  const scoredBelow = medalConfig.companionRace === 'scored-below';
  const medalAssignments = useMemo(() => {
    const assignments: Record<string, number> = {};
    for (const r of medalists) assignments[r.competitor.id] = 0;
    return assignments;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standings, size, goldId]);

  return (
    <CeremonyDialog
      title={`Select the ${w.medal.fleetNoun}`}
      description={`The top boats of the ${w.series} sail the ${w.medal.name} (points ×${medalConfig.multiplier}, never discardable); everyone else stays in their fleet and sails its remaining races${
        scoredBelow ? `, ${goldLabel}'s scored from ${size + 1}` : ''
      }. Based on the ranking as it stands — the SIs fix a cutoff time the jury may extend.`}
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit ${w.medal.fleetNoun} (top ${size})`}
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'medal',
          fromStageRace: 1,
          method: 'medal-select',
          basis: { throughStageRace: 0 },
          fleets: [{ label: capitaliseStage(w.medal.name), color: '#f59e0b' }],
          assignments: medalAssignments,
          stageRaceNumbers: [1],
          deleteFleetIds: dropLeftovers ? leftovers.map((f) => f.id) : [],
        })
      }
    >
      <DeleteLeftoverFleetsChoice
        fleets={leftovers}
        checked={dropLeftovers}
        onChange={setDropLeftovers}
      />
      <div className="flex items-center gap-2">
        <label className="text-sm" htmlFor="sf-medal-size">
          {capitaliseStage(w.medal.fleetNoun)} size
        </label>
        <input
          id="sf-medal-size"
          type="number"
          min={2}
          max={goldRows.length}
          className="w-20 rounded-md border bg-background px-2 py-1 text-sm"
          value={size}
          onChange={(e) => setSize(Number(e.target.value))}
        />
        <span className="text-xs text-muted-foreground">SIs usually say ten; juries vary it</span>
      </div>
      <AssignmentPreviewTable
        rows={medalists.map((r) => ({
          id: r.competitor.id,
          sail: r.competitor.sailNumber,
          name: r.competitor.names.join(' & '),
          to: capitaliseStage(w.medal.name),
        }))}
      />
    </CeremonyDialog>
  );
}

// ─── Medal ──────────────────────────────────────────────────────────────────

function MedalSection({
  seriesId,
  data,
  fleetMeta,
  round,
  canManage,
}: {
  seriesId: string;
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  round: SplitRound;
  canManage: boolean;
}) {
  const addRaces = useAddSplitStageRaces(seriesId);
  const medalConfig = data.config.medal;
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {words(data.config).title('medal')} score ×{medalConfig?.multiplier ?? 2} and cannot be
        discarded.{' '}
        {`The boats who missed the cut sail on with their own fleet — add that race from the ${words(data.config).final.name} section.`}
        {medalConfig?.companionRace === 'scored-below'
          ? ` In the fleet they left it scores from ${(medalConfig?.size ?? 10) + 1} — first finisher ${(medalConfig?.size ?? 10) + 1}, second ${(medalConfig?.size ?? 10) + 2}, and so on — since that many boats are elsewhere; the other fleets score it from 1.`
          : ''}
      </p>
      {round.fleetIds.map((fid, i) => {
        const refs = stageRaceRefs(data, 'medal')
          .filter((ref) => ref.fleetId === fid)
          .sort((a, b) => (a.start.stageRaceNumber ?? 0) - (b.start.stageRaceNumber ?? 0));
        const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
        const nextN = refs.length
          ? Math.max(...refs.map((ref) => ref.start.stageRaceNumber ?? 0)) + 1
          : 1;
        const isMedal = i === 0;
        // raceCount is a planning hint, not a limit: a two-race medal series
        // is just two adds.
        const canAddMore = isMedal || refs.length < 1;
        return (
          <div key={fid} className="flex flex-wrap items-center gap-2">
            <span className="w-40">
              <FleetChip meta={meta} count={fleetMembers(data.competitors, fid).length} />
            </span>
            {refs.map((ref) => {
              const done = physicalRaceCompleted(ref, data.competitors, data.finishes);
              return (
                <Link
                  key={ref.start.id}
                  href={`/series/${seriesId}/races/${ref.race.id}`}
                  className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-background/70"
                  style={{
                    borderColor: meta.color,
                    backgroundColor: done ? `${meta.color}33` : undefined,
                  }}
                >
                  {raceLabel(data, 'medal', ref.start.stageRaceNumber ?? 0)}{' '}
                  {isMedal ? `·×${medalConfig?.multiplier ?? 2}` : ''}{' '}
                  {done ? '✓' : '· enter finishes'}
                </Link>
              );
            })}
            {canManage && canAddMore && (
              <Button
                variant="outline"
                size="xs"
                disabled={addRaces.isPending}
                onClick={() =>
                  addRaces.mutate({
                    roundId: round.id,
                    stageRaceNumbers: [nextN],
                    fleetIds: [fid],
                  })
                }
              >
                Add {isMedal ? `race ${raceLabel(data, 'medal', nextN)}` : 'last race'}
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Standings ──────────────────────────────────────────────────────────────

function StandingsSection({
  data,
  fleetMeta,
  standings,
  splitRound,
  enabledFields,
  onPublish,
  onPreview,
  entryListPublishable,
  resultsStatus,
}: {
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  standings: SplitStandingRow[];
  splitRound: SplitRound | null;
  enabledFields: CompetitorFieldKey[];
  onPublish?: () => void;
  onPreview?: () => void;
  /** Whether the competitor list can be published. A split-fleet series has no
   *  Standings tab, so this section is the only place publishing is reachable
   *  — including before the first race, when the entry list is the sole page
   *  there is to publish. */
  entryListPublishable?: boolean;
  /** Results-lifecycle surface (the Standings tab is hidden on split-fleet
   *  series, so the chip + finalise affordance live here instead). */
  resultsStatus?: { isFinal: boolean; finalisedAt?: number; onMarkFinal?: () => void };
}) {
  const columns = useMemo(() => {
    const seen = new Map<string, { stage: SeriesStage; n: number }>();
    for (const row of standings) {
      for (const cell of row.cells) {
        seen.set(`${cell.stage}:${cell.stageRaceNumber}`, {
          stage: cell.stage,
          n: cell.stageRaceNumber,
        });
      }
    }
    const order: SeriesStage[] = ['qualifying', 'final', 'medal'];
    return [...seen.values()].sort(
      (a, b) => order.indexOf(a.stage) - order.indexOf(b.stage) || a.n - b.n,
    );
  }, [standings]);

  if (columns.length === 0) {
    return (
      <section className="bg-card border rounded-lg p-5 space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Standings</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Standings appear once the first race is sailed.
          {entryListPublishable && ' The competitor list can be published now.'}
        </p>
        {entryListPublishable && (
          <div className="flex gap-2">
            {onPreview && (
              <Button variant="outline" size="sm" onClick={onPreview}>Preview</Button>
            )}
            {onPublish && (
              <Button size="sm" onClick={onPublish}>Publish…</Button>
            )}
          </div>
        )}
      </section>
    );
  }

  const cuts = splitRound
    ? []
    : provisionalCutIndexes(standings.length, data.config.finalFleets.length);


  // Code-only in the live UI — flags are reserved for the published pages so
  // this view doesn't pull the flag dataset into the bundle.
  const showNationality =
    enabledFields.includes('nationality') &&
    standings.some((r) => r.competitor.nationality);

  // Pre-split, the combined table carries a Fleet column with the current
  // round's assignment; after the split the per-fleet headings say it.
  const latestRound = splitRound
    ? null
    : ([...data.rounds].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null);
  const currentFleetOf = (row: SplitStandingRow): FleetMeta | null => {
    const fid = latestRound?.fleetIds.find((f) => row.competitor.fleetIds.includes(f));
    return fid ? (fleetMeta.get(fid) ?? null) : null;
  };

  // The legend: one chip per fleet that actually appears in the cells, deduped
  // by label (a later round's fleets reuse the labels under new ids).
  const cellFleetIds = new Set(standings.flatMap((r) => r.cells.map((c) => c.fleetId)));
  const legendLabels = new Set<string>();
  const legendFleets = [...fleetMeta.entries()].filter(
    ([fid, meta]) =>
      cellFleetIds.has(fid) && !legendLabels.has(meta.label) && !!legendLabels.add(meta.label),
  );

  const renderRows = (rows: SplitStandingRow[], withCuts: boolean) =>
    rows.map((row, i) => {
      const cellByKey = new Map(
        row.cells.map((c) => [`${c.stage}:${c.stageRaceNumber}`, c]),
      );
      return (
        <FragmentRow
          key={row.competitor.id}
          config={data.config}
          row={row}
          columns={columns}
          cellByKey={cellByKey}
          fleetMeta={fleetMeta}
          currentFleet={latestRound ? currentFleetOf(row) : undefined}
          showNationality={showNationality}
          cutAfter={withCuts && cuts.includes(i)}
          cutLabel={
            withCuts && cuts.includes(i)
              ? `${data.config.finalFleets[cuts.indexOf(i)]?.label} / ${data.config.finalFleets[cuts.indexOf(i) + 1]?.label} cut if the ${words(data.config).qualifying.name} ended now${
                  // A shared rank across the line: the ranking does not place
                  // this cut, and the line must not pretend it does.
                  rows[i + 1]?.rank === row.rank
                    ? ' — the boats either side are tied; the ranking does not decide this cut'
                    : ''
                }`
              : null
          }
        />
      );
    });

  return (
    <section className="bg-card border rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide">Standings</h2>
          {resultsStatus && (
            <span
              className={
                resultsStatus.isFinal
                  ? 'inline-flex items-center rounded-full border border-green-600/40 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 dark:border-green-500/40 dark:bg-green-950/40 dark:text-green-400'
                  : 'inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300'
              }
              title={
                resultsStatus.isFinal && resultsStatus.finalisedAt
                  ? `Final since ${new Date(resultsStatus.finalisedAt).toLocaleDateString()}`
                  : undefined
              }
              data-testid="results-status-chip"
            >
              {resultsStatus.isFinal ? 'Final results' : 'Provisional'}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {resultsStatus?.onMarkFinal && (
            <Button variant="outline" size="sm" onClick={resultsStatus.onMarkFinal}>
              Mark as final
            </Button>
          )}
          {onPreview && (
            <Button variant="outline" size="sm" onClick={onPreview}>Preview</Button>
          )}
          {onPublish && (
            <Button size="sm" onClick={onPublish}>Publish…</Button>
          )}
        </div>
      </div>
      {legendFleets.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          Race cells are marked with the fleet the race was sailed in:
          {legendFleets.map(([fid, meta]) => (
            <FleetChip key={fid} meta={meta} />
          ))}
        </p>
      )}
      <div className="overflow-x-auto">
        {splitRound ? (
          splitRound.fleetIds.map((fid) => {
            const rows = standings.filter((r) => r.finalFleetId === fid);
            const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
            if (rows.length === 0) return null;
            return (
              <div key={fid} className="mb-6">
                <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold">
                  <FleetChip meta={meta} /> fleet
                </h3>
                <StandingsTable data={data} columns={columns} showNationality={showNationality}>{renderRows(rows, false)}</StandingsTable>
              </div>
            );
          })
        ) : (
          <StandingsTable data={data} columns={columns} showNationality={showNationality} showFleet={latestRound !== null}>{renderRows(standings, true)}</StandingsTable>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        A {words(data.config).qualifying.raceNoun} counts only once every fleet has
        completed it (greyed cells don&rsquo;t count); discarded scores are in
        parentheses.
      </p>
    </section>
  );
}

function StandingsTable({
  data,
  columns,
  showNationality,
  showFleet,
  children,
}: {
  data: SplitFleetData;
  columns: { stage: SeriesStage; n: number }[];
  showNationality: boolean;
  showFleet?: boolean;
  children: React.ReactNode;
}) {
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 pr-2 font-medium">Rank</th>
          {showFleet && <th className="py-1 pr-2 font-medium">Fleet</th>}
          {showNationality && <th className="py-1 pr-2 font-medium">Nat</th>}
          <th className="py-1 pr-2 font-medium">Sail</th>
          <th className="py-1 pr-2 font-medium">Name</th>
          {columns.map((c) => (
            <th key={`${c.stage}:${c.n}`} className="px-1.5 py-1 text-center font-medium">
              {raceLabel(data, c.stage, c.n)}
            </th>
          ))}
          <th className="px-1.5 py-1 text-right font-medium">Total</th>
          <th className="px-1.5 py-1 text-right font-medium">Nett</th>
        </tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}

function FragmentRow({
  config,
  row,
  columns,
  cellByKey,
  fleetMeta,
  currentFleet,
  showNationality,
  cutAfter,
  cutLabel,
}: {
  config: SplitFleetConfig;
  row: SplitStandingRow;
  columns: { stage: SeriesStage; n: number }[];
  cellByKey: Map<string, import('@/lib/split-fleets').CellScore>;
  fleetMeta: Map<string, FleetMeta>;
  /** The current round's assignment, shown as a Fleet column on the combined
   *  qualifying table. Undefined = no column (post-split, the section heading
   *  names the fleet instead). */
  currentFleet?: FleetMeta | null;
  showNationality: boolean;
  cutAfter: boolean;
  cutLabel: string | null;
}) {
  const w = words(config);
  return (
    <>
      <tr className="border-t">
        <td className="py-1 pr-2">{row.rank}</td>
        {currentFleet !== undefined && (
          <td className="py-1 pr-2 whitespace-nowrap">
            {currentFleet && <FleetDot color={currentFleet.color} />}
            {currentFleet?.label ?? ''}
          </td>
        )}
        {showNationality && (
          <td className="py-1 pr-2 font-mono text-xs">{row.competitor.nationality ?? ''}</td>
        )}
        <td className="py-1 pr-2 whitespace-nowrap">{row.competitor.sailNumber}</td>
        <td className="py-1 pr-2 whitespace-nowrap">
          {/* No WS ID column on this table — with an ID on file, the name
              links to the World Sailing bio instead. */}
          {row.competitor.worldSailingId ? (
            <a
              href={worldSailingProfileUrl(row.competitor.worldSailingId)}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {row.competitor.names.join(' & ')}
            </a>
          ) : (
            row.competitor.names.join(' & ')
          )}
          {row.medal && (
            <span className="ml-1 rounded-full border border-amber-400 px-1.5 text-[10px] text-amber-600 dark:text-amber-400">
              medal
            </span>
          )}
        </td>
        {columns.map((c) => {
          const cell = cellByKey.get(`${c.stage}:${c.n}`);
          if (!cell) {
            return (
              <td key={`${c.stage}:${c.n}`} className="px-1.5 py-1 text-center text-muted-foreground">
                –
              </td>
            );
          }
          const meta = fleetMeta.get(cell.fleetId);
          const color = meta?.color ?? '#888';
          const text = `${cell.points}${cell.code ? ` ${cell.code}` : ''}`;
          const note = cell.counts
            ? cell.carriedRank
              ? `${capitaliseStage(w.qualifying.name)} position, carried into the ${w.final.name}`
              : cell.carriedTransform
                ? `${capitaliseStage(w.series)} score, compressed and carried into the ${w.medal.name}`
                : undefined
            : cell.superseded
              ? 'Replaced by the carried score'
              : cell.excludedAsExtra
                ? `Excluded so every boat has the same number of ${w.qualifying.name} scores`
                : 'Does not yet count — race incomplete across fleets';
          return (
            <td
              key={`${c.stage}:${c.n}`}
              className={`px-1.5 py-1 text-center text-xs whitespace-nowrap ${
                cell.counts ? '' : 'text-muted-foreground opacity-60'
              }`}
              style={{ backgroundColor: `${color}${cell.counts ? '2e' : '14'}` }}
              title={
                [meta ? `${meta.label} fleet` : null, note].filter(Boolean).join(' — ') ||
                undefined
              }
            >
              {meta && <FleetDot color={color} />}
              {cell.discarded ? `(${text})` : text}
            </td>
          );
        })}
        <td className="px-1.5 py-1 text-right">{row.total}</td>
        <td className="px-1.5 py-1 text-right font-semibold">{row.net}</td>
      </tr>
      {cutAfter && (
        <tr aria-hidden>
          <td
            colSpan={
              columns.length + (showNationality ? 6 : 5) + (currentFleet !== undefined ? 1 : 0)
            }
            className="py-0"
          >
            <div className="my-0.5 border-t-2 border-dashed border-amber-400 text-center text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {cutLabel}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
