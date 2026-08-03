'use client';

// Split Fleets — the guided qualifying/final-series workflow (PROTOTYPE).
// See docs/design/ux/flows/split-fleets.md. Known prototype shortcuts:
// finish entry is not fleet-scoped, no equalisation modes, no promotion,
// no assignment-list publishing, standings ignore penalties/redress.

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
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { competitorRepo, type SplitRoundCommit } from '@/lib/api-repository';
import {
  assignByRankPattern,
  finalBlockSizes,
  fleetMembers,
  logicalRaces,
  physicalRaceCompleted,
  provisionalCutIndexes,
  roundsForStage,
  seedOrder,
  splitFleetStandings,
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
  if (qualifyingRounds.length === 0) return { label: 'seed Round 1 (create the qualifying fleets)' };
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
    const prefix = pending.start.stage === 'qualifying' ? 'Q' : pending.start.stage === 'final' ? 'F' : 'M';
    return {
      label: `enter finishes for ${prefix}${pending.start.stageRaceNumber} · ${fleet}`,
      href: `/series/${pending.race.seriesId}/races/${pending.race.id}`,
    };
  }
  if (!splitRound) return { label: 'end qualifying and split into final fleets (when the SIs are satisfied)' };
  if (config.medal && !medalRound) return { label: 'select the medal fleet' };
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
    const prefix = ref.start.stage === 'qualifying' ? 'Q' : ref.start.stage === 'final' ? 'F' : 'M';
    chips.push({
      key,
      label: `${prefix}${ref.start.stageRaceNumber}`,
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

const STAGE_TITLES: Record<SeriesStage, string> = {
  qualifying: 'Qualifying series',
  final: 'Final series',
  medal: 'Medal races',
};

/** The Format section's collapsed one-liner. */
function formatSummary(config: SplitFleetConfig): string {
  const carry =
    config.carry === 'points'
      ? 'one continuous series'
      : config.carry === 'net-plus-net'
        ? 'two series added together'
        : 'qualifying position carried forward';
  return [
    `${config.qualifyingFleets.map((f) => f.label).join('/')} → ${config.finalFleets.map((f) => f.label).join('/')}`,
    carry,
    config.medal ? `medal race ×${config.medal.multiplier}` : 'no medal race',
  ].join(' · ');
}

function stagePrefix(stage: SeriesStage): string {
  return stage === 'qualifying' ? 'Q' : stage === 'final' ? 'F' : 'M';
}

/** Standings column heading. Stage race 0 in the final series is the carried
 *  qualifying position (`rank-seed` carry), not a race. */
function columnLabel(stage: SeriesStage, n: number): string {
  return stage === 'final' && n === 0 ? 'QS' : `${stagePrefix(stage)}${n}`;
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
            : [{ label: 'Medal', color: '#f59e0b' }, { label: 'Last race', color: '#94a3b8' }];
      meta.set(fid, {
        label: byId.get(fid)?.name ?? palette[i]?.label ?? '?',
        color: palette[Math.min(i, palette.length - 1)]?.color ?? '#94a3b8',
      });
    });
  }
  return meta;
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
        title={STAGE_TITLES.qualifying}
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
        title={STAGE_TITLES.final}
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
            The final series begins when qualifying ends and the fleet is split.
          </p>
        )}
      </StageSection>

      {sfState.config.medal && (
        <StageSection
          title={STAGE_TITLES.medal}
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
              The top {sfState.config.medal.size} after the opening series sail the medal
              race{sfState.config.medal.raceCount > 1 ? 's' : ''}.
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
          championship page + the assignments page, so both dialogs run in
          single-default-page mode (empty fleet list) and the build emits the
          split-fleet pages itself. */}
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
      />
      <FinaliseResultsDialog
        series={data.series}
        races={races}
        finishes={allFinishes}
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
                Round {i + 1} · {stagePrefix('qualifying')}
                {round.fromStageRace}
                {' onward'}
              </h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {round.method === 'seeded'
                    ? 'Initial assignment'
                    : round.basis
                      ? `From ranking after Q${round.basis.throughStageRace} · captured ${new Date(round.basis.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
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
                    onClick={() => {
                      if (confirm('Delete this round and everything it created (fleets, races, finishes)?')) {
                        deleteRound.mutate(round.id);
                      }
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
            <Button onClick={() => setDialog('seed')}>Assign qualifying fleets</Button>
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
                Add race Q{nextStageRace}
              </Button>
              <Button onClick={() => setDialog('split')} disabled={validCount === 0}>
                End qualifying → split fleets
              </Button>
              <span className="text-xs text-muted-foreground">
                {validCount} of {lrs.length} qualifying races count
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
      <span className="w-8 font-medium">
        {stagePrefix(stage)}
        {stageRaceNumber}
      </span>
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
                onClick={() => {
                  if (
                    confirm(
                      `Abandon ${meta.label}'s ${stagePrefix(stage)}${stageRaceNumber}? ` +
                        `Removes ${meta.label} from this start sequence and voids any of its rows ` +
                        `on the sheet; the other fleets stand. Re-race it with "Add catch-up race".`,
                    )
                  ) {
                    abandon.mutate({ raceId: ref.race.id, fleetId: fid });
                  }
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

function useCommit(seriesId: string, onClose: () => void) {
  const commit = useCommitSplitRound(seriesId);
  const run = async (payload: SplitRoundCommit) => {
    try {
      await commit.mutateAsync(payload);
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
  onCommit,
  onClose,
  children,
}: {
  title: string;
  description: string;
  error: string | null;
  pending: boolean;
  commitLabel: string;
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={onCommit}>
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            {commitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignmentPreviewTable({
  rows,
  fleetLabels,
  onMove,
}: {
  rows: { id: string; sail: string; name: string; from?: string; to: string; moved?: boolean; overridden?: boolean }[];
  /** When set (with onMove), each row gets a fleet select — the editable
   *  preview: hand-moves are recorded as overrides on commit. */
  fleetLabels?: string[];
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
            <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
            <td className="py-1 pr-2 whitespace-nowrap">{r.sail}</td>
            <td className="py-1 pr-2">{r.name}</td>
            {hasFrom && <td className="py-1 pr-2 text-muted-foreground">{r.from}</td>}
            <td className={`py-1 ${r.moved ? 'font-semibold' : ''}`}>
              {fleetLabels && onMove ? (
                <select
                  className="rounded border bg-background px-1 py-0.5 text-xs"
                  aria-label={`Fleet for ${r.sail}`}
                  value={r.to}
                  onChange={(e) => onMove(r.id, e.target.value)}
                >
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
  const [order, setOrder] = useState<SeedOrder>('seed-rank');
  // Sailors the ranking didn't reach sort below it either way; this decides
  // the order within that tail. Defaulted to sail number to agree with
  // `seedOrder` — when *no one* carries a seeding rank, "seeding rank" order
  // is the tail order and nothing else, and that is no place to spring a
  // different assignment on a scorer. Spreading by nation is the better
  // choice at a charter event, so it's offered, not assumed.
  const [tailOrder, setTailOrder] = useState<SeedTailOrder>('sail-number');
  const [moves, setMoves] = useState<Record<string, number>>({});
  const qFleets = data.config.qualifyingFleets;

  const preview = useMemo(() => {
    const byId = new Map(data.competitors.map((c) => [c.id, c]));
    let assignments: Record<string, number> = {};
    const ordered = seedOrder(data.competitors, order, tailOrder);
    const byFleet = assignByRankPattern(ordered, qFleets.length);
    byFleet.forEach((ids, i) => ids.forEach((cid) => (assignments[cid] = i)));
    // Hand-moves layer on top.
    assignments = { ...assignments, ...moves };
    return {
      assignments,
      rows: ordered.map((cid) => {
        const c = byId.get(cid)!;
        return {
          id: cid,
          sail: c.sailNumber,
          name: c.names.join(' & '),
          to: qFleets[assignments[cid]].label,
          overridden: moves[cid] != null,
        };
      }),
      sizes: qFleets.map((_, i) => Object.values(assignments).filter((v) => v === i).length),
    };
  }, [data.competitors, order, tailOrder, moves, qFleets]);

  return (
    <CeremonyDialog
      title="Assign qualifying fleets (Round 1)"
      description="Make the initial assignment — normally from the seeding committee's ranking — and create the first day's races."
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit Round 1 (${preview.sizes.join(' / ')})`}
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'qualifying',
          fromStageRace: 1,
          method: 'seeded',
          basis: null,
          fleets: qFleets,
          assignments: preview.assignments,
          overrideCompetitorIds: Object.keys(moves),
          stageRaceNumbers: plannedFirstRaces(data.config),
        })
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm" htmlFor="sf-seed-order">
          Seeding order
        </label>
        <select
          id="sf-seed-order"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={order}
          onChange={(e) => { setOrder(e.target.value as SeedOrder); setMoves({}); }}
        >
          <option value="seed-rank">Seeding rank</option>
          <option value="nationality-spread">Nationality, then sail number</option>
          <option value="sail-number">Sail number</option>
        </select>
        {order === 'seed-rank' && data.competitors.some((c) => c.seed == null) && (
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
      <AssignmentPreviewTable
        rows={preview.rows}
        fleetLabels={qFleets.map((f) => f.label)}
        onMove={(cid, label) =>
          setMoves((m) => ({ ...m, [cid]: qFleets.findIndex((f) => f.label === label) }))
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
  const preview = useMemo(() => {
    const rows = splitFleetStandings(data);
    const ordered = rows.map((r) => r.competitor.id);
    const byFleet = assignByRankPattern(ordered, qFleets.length);
    let assignments: Record<string, number> = {};
    byFleet.forEach((ids, i) => ids.forEach((cid) => (assignments[cid] = i)));
    assignments = { ...assignments, ...moves };
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
        from,
        to,
        moved: didMove,
        overridden: moves[r.competitor.id] != null,
      };
    });
    return { assignments, table, moved };
  }, [data, qFleets, fleetMeta, moves]);

  return (
    <CeremonyDialog
      title={`Assign Round ${roundNumber} · Q${fromStageRace} onward`}
      description={`From the ranking after Q${throughStageRace} — the races completed by all fleets. Captured now; later rescoring will not change this assignment. Hand-moves (late entries, committee instructions) are recorded as overrides.`}
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit Round ${roundNumber} (${preview.moved} boats change fleet)`}
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'qualifying',
          fromStageRace,
          method: 'rank-pattern',
          basis: { throughStageRace, capturedAt: Date.now() },
          fleets: qFleets,
          assignments: preview.assignments,
          overrideCompetitorIds: Object.keys(moves),
          stageRaceNumbers: [fromStageRace, fromStageRace + 1],
        })
      }
    >
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

  const preview = useMemo(() => {
    // Top fleet takes `topSize`; the remainder splits near-equally.
    const rest = finalBlockSizes(Math.max(0, rows.length - topSize), Math.max(1, fFleets.length - 1));
    const sizes = [topSize, ...rest];
    let assignments: Record<string, number> = {};
    let idx = 0;
    sizes.forEach((size, fleetIdx) => {
      for (let k = 0; k < size && idx < rows.length; k++, idx++) {
        assignments[rows[idx].competitor.id] = fleetIdx;
      }
    });
    assignments = { ...assignments, ...moves };
    const table = rows.map((r) => ({
      id: r.competitor.id,
      sail: r.competitor.sailNumber,
      name: r.competitor.names.join(' & '),
      to: fFleets[assignments[r.competitor.id]].label,
      overridden: moves[r.competitor.id] != null,
    }));
    // Boundary-tie diagnostics: equal nets across a fleet boundary.
    const boundaryTies: string[] = [];
    let cum = 0;
    for (let i = 0; i < sizes.length - 1; i++) {
      cum += sizes[i];
      const a = rows[cum - 1];
      const b = rows[cum];
      if (a && b && a.net === b.net) {
        boundaryTies.push(
          `Ranks ${cum}/${cum + 1} (${a.competitor.sailNumber}, ${b.competitor.sailNumber}) tie on ${a.net} — separated by RRS A8 (then ${
            data.config.reassignmentTieOrder === 'fleet-order' ? 'fleet order' : 'entry order'
          }); the ${fFleets[i].label}/${fFleets[i + 1].label} boundary depends on it.`,
        );
      }
    }
    const counted = Object.values(assignments);
    return {
      assignments,
      table,
      sizes: fFleets.map((_, i) => counted.filter((v) => v === i).length),
      boundaryTies,
    };
  }, [rows, topSize, moves, fFleets, data.config.reassignmentTieOrder]);

  return (
    <CeremonyDialog
      title="Split into final fleets"
      description={`Basis: the qualifying ranking after Q${throughStageRace}. The split is frozen once committed — later rescoring will not change it (a redress decision may promote). Creates the final fleets and the first final race.`}
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit split (${preview.sizes.join(' / ')})`}
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'final',
          fromStageRace: 1,
          method: 'split',
          basis: { throughStageRace, capturedAt: Date.now() },
          fleets: fFleets,
          assignments: preview.assignments,
          overrideCompetitorIds: Object.keys(moves),
          stageRaceNumbers: [1],
        })
      }
    >
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

// ─── Final series ───────────────────────────────────────────────────────────

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
  const abandon = useAbandonSplitStart(seriesId);
  const addRaces = useAddSplitStageRaces(seriesId);
  const override = useApplySplitOverride(seriesId);
  const [medalOpen, setMedalOpen] = useState(false);
  const [promoteOpen, setPromoteOpen] = useState(false);
  const [overrideWarning, setOverrideWarning] = useState<string | null>(null);
  const medalConfig = data.config.medal;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Split committed{' '}
        {round.basis
          ? `from the qualifying ranking after Q${round.basis.throughStageRace}`
          : ''}
        . Final fleets usually start in sequence and finish onto one combined
        sheet, but need not complete the same number of races — a fleet a race
        behind simply sails its own next number in the sequence.
      </p>
      {canManage && (
        <Button
          variant="outline"
          size="xs"
          disabled={addRaces.isPending}
          onClick={() =>
            addRaces.mutate({
              roundId: round.id,
              // One race, all fleets in sequence — each start at its own next
              // stage race number, so out-of-step fleets stay out of step.
              starts: round.fleetIds.map((fid) => {
                const ns = stageRaceRefs(data, 'final')
                  .filter((ref) => ref.fleetId === fid)
                  .map((ref) => ref.start.stageRaceNumber ?? 0);
                return { fleetId: fid, stageRaceNumber: (ns.length ? Math.max(...ns) : 0) + 1 };
              }),
            })
          }
        >
          Add next race · all fleets in one sequence
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
                    F{ref.start.stageRaceNumber} {done ? '✓' : '· enter finishes'}
                  </Link>
                  {canManage && !done && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Abandon ${meta.label}'s F${ref.start.stageRaceNumber}`}
                      title={`Abandon ${meta.label}'s F${ref.start.stageRaceNumber}`}
                      disabled={abandon.isPending}
                      onClick={() => {
                        if (
                          confirm(
                            `Abandon ${meta.label}'s F${ref.start.stageRaceNumber}? ` +
                              `Removes ${meta.label} from this start sequence and voids any of its ` +
                              `rows on the sheet; the other fleets stand.`,
                          )
                        ) {
                          abandon.mutate({ raceId: ref.race.id, fleetId: fid });
                        }
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
                Add F{nextN}
              </Button>
            )}
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-2">
        {canManage && medalConfig && !medalRound && (
          <Button variant="outline" onClick={() => setMedalOpen(true)}>
            Select medal fleet…
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
                the first final race; after that the boat&rsquo;s existing
                final scores need the protest committee&rsquo;s direction.
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
  const [size, setSize] = useState(medalConfig.size);
  const goldId = round.fleetIds[0];
  const goldRows = standings.filter((r) => r.finalFleetId === goldId);
  const medalists = goldRows.slice(0, size);
  const rest = goldRows.slice(size);
  const goldLabel = fleetMeta.get(goldId)?.label ?? 'Gold';

  const medalAssignments = useMemo(() => {
    const assignments: Record<string, number> = {};
    for (const r of medalists) assignments[r.competitor.id] = 0;
    for (const r of rest) assignments[r.competitor.id] = 1;
    return assignments;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [standings, size, goldId]);

  return (
    <CeremonyDialog
      title="Select the medal fleet"
      description={`The top boats of the opening series sail the medal race${medalConfig.raceCount > 1 ? 's' : ''} (points ×${medalConfig.multiplier}, never discardable); the rest of ${goldLabel} sail the companion last race, scored from ${size + 1}. Based on the ranking as it stands — the SIs fix a cutoff time the jury may extend.`}
      error={commit.isError ? String(commit.error) : null}
      pending={commit.isPending}
      commitLabel={`Commit medal fleet (top ${size})`}
      onClose={onClose}
      onCommit={() =>
        run({
          stage: 'medal',
          fromStageRace: 1,
          method: 'medal-select',
          basis: { throughStageRace: 0, capturedAt: Date.now() },
          fleets: [
            { label: 'Medal', color: '#f59e0b' },
            { label: `${goldLabel} last race`, color: '#94a3b8' },
          ],
          assignments: medalAssignments,
          stageRaceNumbers: [1],
        })
      }
    >
      <div className="flex items-center gap-2">
        <label className="text-sm" htmlFor="sf-medal-size">Medal fleet size</label>
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
        rows={[
          ...medalists.map((r) => ({ id: r.competitor.id, sail: r.competitor.sailNumber, name: r.competitor.names.join(' & '), to: 'Medal' })),
          ...rest.map((r) => ({ id: r.competitor.id, sail: r.competitor.sailNumber, name: r.competitor.names.join(' & '), to: `${goldLabel} last race` })),
        ]}
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
        Medal races score ×{medalConfig?.multiplier ?? 2} and cannot be discarded; the
        companion race scores from {(medalConfig?.size ?? 10) + 1} points (first
        finisher = {(medalConfig?.size ?? 10) + 1}).
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
        // raceCount is a planning hint, not a limit: the 2026 two-race medal
        // series is just two adds. Companion fleets sail one last race.
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
                  M{ref.start.stageRaceNumber} {isMedal ? `·×${medalConfig?.multiplier ?? 2}` : ''}{' '}
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
                Add {isMedal ? `medal race M${nextN}` : 'last race'}
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
  resultsStatus,
}: {
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  standings: SplitStandingRow[];
  splitRound: SplitRound | null;
  enabledFields: CompetitorFieldKey[];
  onPublish?: () => void;
  onPreview?: () => void;
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
      <section className="bg-card border rounded-lg p-5">
        <h2 className="text-sm font-semibold uppercase tracking-wide">Standings</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Standings appear once the first race is sailed.
        </p>
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

  const renderRows = (rows: SplitStandingRow[], withCuts: boolean) =>
    rows.map((row, i) => {
      const cellByKey = new Map(
        row.cells.map((c) => [`${c.stage}:${c.stageRaceNumber}`, c]),
      );
      return (
        <FragmentRow
          key={row.competitor.id}
          row={row}
          columns={columns}
          cellByKey={cellByKey}
          fleetMeta={fleetMeta}
          showNationality={showNationality}
          cutAfter={withCuts && cuts.includes(i)}
          cutLabel={
            withCuts && cuts.includes(i)
              ? `${data.config.finalFleets[cuts.indexOf(i)]?.label} / ${data.config.finalFleets[cuts.indexOf(i) + 1]?.label} cut if qualifying ended now`
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
                <StandingsTable columns={columns} showNationality={showNationality}>{renderRows(rows, false)}</StandingsTable>
              </div>
            );
          })
        ) : (
          <StandingsTable columns={columns} showNationality={showNationality}>{renderRows(standings, true)}</StandingsTable>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        A qualifying race counts only once every fleet has completed it
        (greyed cells don&rsquo;t count); discarded scores are in parentheses.
      </p>
    </section>
  );
}

function StandingsTable({
  columns,
  showNationality,
  children,
}: {
  columns: { stage: SeriesStage; n: number }[];
  showNationality: boolean;
  children: React.ReactNode;
}) {
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 pr-2 font-medium">Rank</th>
          {showNationality && <th className="py-1 pr-2 font-medium">Nat</th>}
          <th className="py-1 pr-2 font-medium">Sail</th>
          <th className="py-1 pr-2 font-medium">Name</th>
          {columns.map((c) => (
            <th key={`${c.stage}:${c.n}`} className="px-1.5 py-1 text-center font-medium">
              {columnLabel(c.stage, c.n)}
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
  row,
  columns,
  cellByKey,
  fleetMeta,
  showNationality,
  cutAfter,
  cutLabel,
}: {
  row: SplitStandingRow;
  columns: { stage: SeriesStage; n: number }[];
  cellByKey: Map<string, import('@/lib/split-fleets').CellScore>;
  fleetMeta: Map<string, FleetMeta>;
  showNationality: boolean;
  cutAfter: boolean;
  cutLabel: string | null;
}) {
  return (
    <>
      <tr className="border-t">
        <td className="py-1 pr-2">{row.rank}</td>
        {showNationality && (
          <td className="py-1 pr-2 font-mono text-xs">{row.competitor.nationality ?? ''}</td>
        )}
        <td className="py-1 pr-2 whitespace-nowrap">{row.competitor.sailNumber}</td>
        <td className="py-1 pr-2 whitespace-nowrap">
          {row.competitor.names.join(' & ')}
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
          const color = fleetMeta.get(cell.fleetId)?.color ?? '#888';
          const text = `${cell.points}${cell.code ? ` ${cell.code}` : ''}`;
          return (
            <td
              key={`${c.stage}:${c.n}`}
              className={`px-1.5 py-1 text-center text-xs whitespace-nowrap ${
                cell.counts ? '' : 'text-muted-foreground opacity-60'
              }`}
              style={{ backgroundColor: `${color}${cell.counts ? '2e' : '14'}` }}
              title={
                cell.counts
                  ? cell.carriedRank
                    ? 'Qualifying-series position, carried into the final series'
                    : undefined
                  : cell.superseded
                    ? 'Replaced by the carried qualifying position'
                    : 'Does not yet count — race incomplete across fleets'
              }
            >
              {cell.discarded ? `(${text})` : text}
            </td>
          );
        })}
        <td className="px-1.5 py-1 text-right">{row.total}</td>
        <td className="px-1.5 py-1 text-right font-semibold">{row.net}</td>
      </tr>
      {cutAfter && (
        <tr aria-hidden>
          <td colSpan={columns.length + (showNationality ? 6 : 5)} className="py-0">
            <div className="my-0.5 border-t-2 border-dashed border-amber-400 text-center text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {cutLabel}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
