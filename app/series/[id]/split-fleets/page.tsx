'use client';

// Split Fleets — the guided qualifying/final-series workflow (PROTOTYPE).
// See docs/design/ux/flows/split-fleets.md. Known prototype shortcuts:
// finish entry is not fleet-scoped, no equalisation modes, no promotion,
// no assignment-list publishing, standings ignore penalties/redress.

import { use, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Trash2 } from 'lucide-react';

import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { useSeriesReadOnly } from '@/components/series-read-only';
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
  useAddSplitStageRaces,
  useCommitSplitRound,
  useDeleteSplitRound,
  useSaveSplitFleetConfig,
  useSplitFleetState,
} from '@/hooks/use-split-fleets';
import { useWorkspacePermissions } from '@/hooks/use-workspace-permissions';
import { competitorRepo, type SplitRoundCommit } from '@/lib/api-repository';
import {
  assignByRankPattern,
  defaultSplitFleetConfig,
  finalBlockSizes,
  fleetMembers,
  logicalRaces,
  provisionalCutIndexes,
  raceCompleted,
  roundsForStage,
  seedOrder,
  splitFleetStandings,
  type SeedOrder,
  type SeriesStage,
  type SplitFleetData,
  type SplitRound,
  type SplitStandingRow,
} from '@/lib/split-fleets';
import type { Competitor, Finish, Fleet, Race } from '@/lib/types';

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

function stagePrefix(stage: SeriesStage): string {
  return stage === 'qualifying' ? 'Q' : stage === 'final' ? 'F' : 'M';
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

  // The scorer bounces between this view and finish entry all day; the
  // global 30s staleTime would otherwise show a just-entered sheet as
  // still pending on return.
  useEffect(() => {
    qc.invalidateQueries({ queryKey: queryKeys.finishes.bySeries(seriesId) });
  }, [qc, seriesId]);

  if (data.status !== 'ready' || sfState === undefined) {
    return <SeriesTabFallback status={data.status === 'missing' ? 'missing' : 'loading'} />;
  }

  const canManage = !readOnly && can('manage-series');
  const { competitors, fleets, races } = data;
  const allFinishes = data.finishes ?? [];
  const raceStarts = data.raceStarts ?? [];

  if (!sfState.config) {
    return (
      <SetupCard
        seriesId={seriesId}
        competitorCount={competitors.length}
        defaultFleetId={fleets[0]?.id ?? null}
        canManage={canManage}
      />
    );
  }

  const raceFleetIds: Record<string, string> = {};
  for (const start of raceStarts) {
    if (start.fleetIds.length === 1) raceFleetIds[start.raceId] = start.fleetIds[0];
  }

  const sfData: SplitFleetData = {
    config: sfState.config,
    rounds: sfState.rounds,
    fleets,
    competitors,
    races: races.filter((r) => r.stage),
    raceFleetIds,
    finishes: allFinishes,
  };

  const fleetMeta = buildFleetMeta(sfData, fleets);
  const qualifyingRounds = roundsForStage(sfState.rounds, 'qualifying');
  const splitRound = roundsForStage(sfState.rounds, 'final')[0] ?? null;
  const medalRound = roundsForStage(sfState.rounds, 'medal')[0] ?? null;
  const standings = splitFleetStandings(sfData);

  return (
    <div className="space-y-6">
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
          status={medalRound ? 'In progress' : 'Not started'}
          defaultOpen={!!medalRound}
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
      />
    </div>
  );
}

// ─── Setup ──────────────────────────────────────────────────────────────────

function SetupCard({
  seriesId,
  competitorCount,
  defaultFleetId,
  canManage,
}: {
  seriesId: string;
  competitorCount: number;
  defaultFleetId: string | null;
  canManage: boolean;
}) {
  const saveConfig = useSaveSplitFleetConfig(seriesId);
  const [fleetCount, setFleetCount] = useState(3);
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
    <div className="bg-card border rounded-lg p-5 space-y-4 max-w-xl">
      <h2 className="text-sm font-medium">Set up split fleets</h2>
      <p className="text-sm text-muted-foreground">
        Run this series as a qualifying/final championship: competitors race in
        qualifying fleets reshuffled by rank each day, then split into
        Gold/Silver{fleetCount > 2 ? '/Bronze' : ''} for the final series.
        Preset: ILCA World Championship (largest-fleet score codes, 1 discard
        from 4 races, medal race for the top 10).
      </p>
      <div className="flex items-center gap-3">
        <label className="text-sm" htmlFor="sf-fleet-count">
          Qualifying fleets
        </label>
        <select
          id="sf-fleet-count"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={fleetCount}
          onChange={(e) => setFleetCount(Number(e.target.value))}
        >
          <option value={2}>2 — Yellow, Blue</option>
          <option value={3}>3 — Yellow, Blue, Red</option>
          <option value={4}>4 — Yellow, Blue, Red, Green</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <Button
          disabled={!canManage || saveConfig.isPending}
          onClick={() => saveConfig.mutate(defaultSplitFleetConfig(fleetCount))}
        >
          {saveConfig.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Enable split fleets
        </Button>
        {competitorCount === 0 && (
          <Button variant="outline" disabled={!canManage || seeding} onClick={addDemo}>
            {seeding && <Loader2 className="h-4 w-4 animate-spin" />}
            Add {DEMO_NAMES.length} demo competitors
          </Button>
        )}
      </div>
      {competitorCount > 0 && (
        <p className="text-xs text-muted-foreground">{competitorCount} competitors entered.</p>
      )}
      {saveConfig.isError && (
        <p className="text-sm text-destructive">{String(saveConfig.error)}</p>
      )}
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
                    ? 'Seeded'
                    : round.basis
                      ? `From ranking after Q${round.basis.throughStageRace} · captured ${new Date(round.basis.capturedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                      : 'Manual'}
                </span>
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
                />
              ))}
            </div>
          </div>
        );
      })}

      {canManage && !split && (
        <div className="flex flex-wrap items-center gap-2">
          {rounds.length === 0 ? (
            <Button onClick={() => setDialog('seed')}>Create Round 1</Button>
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
}: {
  seriesId: string;
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  round: SplitRound;
  stage: SeriesStage;
  stageRaceNumber: number;
}) {
  const refs = new Map(
    data.races
      .filter((r) => r.stage === stage && r.stageRaceNumber === stageRaceNumber)
      .map((r) => [data.raceFleetIds[r.id], r]),
  );
  const missing = round.fleetIds.filter((fid) => {
    const race = refs.get(fid);
    return !race || !raceCompleted(race, data.finishes);
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
        const race = refs.get(fid);
        const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
        if (!race) {
          return (
            <span key={fid} className="rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">
              {meta.label} — no race
            </span>
          );
        }
        const done = raceCompleted(race, data.finishes);
        return (
          <Link
            key={fid}
            href={`/series/${seriesId}/races/${race.id}`}
            className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-background/70"
            style={{
              borderColor: meta.color,
              backgroundColor: done ? `${meta.color}33` : undefined,
            }}
          >
            {meta.label} {done ? '✓' : '· enter finishes'}
          </Link>
        );
      })}
      {stage === 'qualifying' && (
        <span className={`text-xs ${valid ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
          {valid
            ? 'counts'
            : `awaiting ${missing.map((f) => fleetMeta.get(f)?.label ?? '?').join(', ')}`}
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
}: {
  rows: { sail: string; name: string; from?: string; to: string; moved?: boolean }[];
}) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 pr-2 font-medium">#</th>
          <th className="py-1 pr-2 font-medium">Sail</th>
          <th className="py-1 pr-2 font-medium">Name</th>
          {rows.some((r) => r.from !== undefined) && <th className="py-1 pr-2 font-medium">From</th>}
          <th className="py-1 font-medium">Fleet</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t">
            <td className="py-1 pr-2 text-muted-foreground">{i + 1}</td>
            <td className="py-1 pr-2 whitespace-nowrap">{r.sail}</td>
            <td className="py-1 pr-2">{r.name}</td>
            {rows.some((x) => x.from !== undefined) && (
              <td className="py-1 pr-2 text-muted-foreground">{r.from}</td>
            )}
            <td className={`py-1 ${r.moved ? 'font-semibold' : ''}`}>{r.to}</td>
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
  const [order, setOrder] = useState<SeedOrder>('sail-number');
  const qFleets = data.config.qualifyingFleets;
  const preview = useMemo(() => {
    const ordered = seedOrder(data.competitors, order);
    const byFleet = assignByRankPattern(ordered, qFleets.length);
    const byId = new Map(data.competitors.map((c) => [c.id, c]));
    const assignments: Record<string, number> = {};
    byFleet.forEach((ids, i) => ids.forEach((cid) => (assignments[cid] = i)));
    return {
      assignments,
      rows: ordered.map((cid) => {
        const c = byId.get(cid)!;
        return {
          sail: c.sailNumber,
          name: c.names.join(' & '),
          to: qFleets[assignments[cid]].label,
        };
      }),
      sizes: byFleet.map((ids) => ids.length),
    };
  }, [data.competitors, order, qFleets]);

  return (
    <CeremonyDialog
      title="Create Round 1"
      description="Seed the initial qualifying fleets and create the first day's races (Q1–Q2)."
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
          stageRaceNumbers: [1, 2],
        })
      }
    >
      <div className="flex items-center gap-3">
        <label className="text-sm" htmlFor="sf-seed-order">
          Seeding order
        </label>
        <select
          id="sf-seed-order"
          className="rounded-md border bg-background px-2 py-1 text-sm"
          value={order}
          onChange={(e) => setOrder(e.target.value as SeedOrder)}
        >
          <option value="sail-number">Sail number</option>
          <option value="nationality-spread">Nationality, then sail number</option>
          <option value="entry-order">Entry order</option>
        </select>
      </div>
      <AssignmentPreviewTable rows={preview.rows} />
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
  const qFleets = data.config.qualifyingFleets;
  const preview = useMemo(() => {
    const rows = splitFleetStandings(data);
    const ordered = rows.map((r) => r.competitor.id);
    const byFleet = assignByRankPattern(ordered, qFleets.length);
    const assignments: Record<string, number> = {};
    byFleet.forEach((ids, i) => ids.forEach((cid) => (assignments[cid] = i)));
    let moved = 0;
    const table = rows.map((r) => {
      const currentFleetId = r.competitor.fleetIds.findLast((fid) => fleetMeta.has(fid));
      const from = currentFleetId ? fleetMeta.get(currentFleetId)?.label : undefined;
      const to = qFleets[assignments[r.competitor.id]].label;
      const didMove = from !== undefined && from !== to;
      if (didMove) moved++;
      return {
        sail: r.competitor.sailNumber,
        name: r.competitor.names.join(' & '),
        from,
        to,
        moved: didMove,
      };
    });
    return { assignments, table, moved };
  }, [data, qFleets, fleetMeta]);

  return (
    <CeremonyDialog
      title={`Assign Round ${roundNumber} · Q${fromStageRace} onward`}
      description={`From the ranking after Q${throughStageRace} — the races completed by all fleets. Captured now; later rescoring will not change this assignment.`}
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
          stageRaceNumbers: [fromStageRace, fromStageRace + 1],
        })
      }
    >
      <AssignmentPreviewTable rows={preview.table} />
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
  const preview = useMemo(() => {
    const rows = splitFleetStandings(data);
    const sizes = finalBlockSizes(rows.length, fFleets.length);
    const assignments: Record<string, number> = {};
    let idx = 0;
    const table: { sail: string; name: string; to: string }[] = [];
    sizes.forEach((size, fleetIdx) => {
      for (let k = 0; k < size; k++, idx++) {
        const r = rows[idx];
        assignments[r.competitor.id] = fleetIdx;
        table.push({
          sail: r.competitor.sailNumber,
          name: r.competitor.names.join(' & '),
          to: fFleets[fleetIdx].label,
        });
      }
    });
    return { assignments, table, sizes };
  }, [data, fFleets]);

  return (
    <CeremonyDialog
      title="Split into final fleets"
      description={`Basis: the qualifying ranking after Q${throughStageRace}. The split is frozen once committed — later rescoring will not change it. Creates the final fleets and the first final race (F1).`}
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
          stageRaceNumbers: [1],
        })
      }
    >
      <AssignmentPreviewTable rows={preview.table} />
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
  const addRaces = useAddSplitStageRaces(seriesId);
  const commitRound = useCommitSplitRound(seriesId);
  const medalConfig = data.config.medal;

  const selectMedal = async () => {
    if (!medalConfig) return;
    const goldId = round.fleetIds[0];
    const goldRows = standings.filter((r) => r.finalFleetId === goldId);
    const medalists = goldRows.slice(0, medalConfig.size);
    const rest = goldRows.slice(medalConfig.size);
    if (
      !confirm(
        `Assign the top ${medalConfig.size} to the medal fleet?\n\n${medalists
          .map((r, i) => `${i + 1}. ${r.competitor.sailNumber} ${r.competitor.names.join(' & ')}`)
          .join('\n')}`,
      )
    ) {
      return;
    }
    const assignments: Record<string, number> = {};
    for (const r of medalists) assignments[r.competitor.id] = 0;
    for (const r of rest) assignments[r.competitor.id] = 1;
    await commitRound.mutateAsync({
      stage: 'medal',
      fromStageRace: 1,
      method: 'medal-select',
      basis: { throughStageRace: 0, capturedAt: Date.now() },
      fleets: [
        { label: 'Medal', color: '#f59e0b' },
        { label: `${fleetMeta.get(goldId)?.label ?? 'Gold'} last race`, color: '#94a3b8' },
      ],
      assignments,
      stageRaceNumbers: [1],
    });
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Split committed{' '}
        {round.basis
          ? `from the qualifying ranking after Q${round.basis.throughStageRace}`
          : ''}
        . Final fleets race independently; different fleets need not complete the
        same number of races.
      </p>
      {round.fleetIds.map((fid) => {
        const races = data.races
          .filter((r) => r.stage === 'final' && data.raceFleetIds[r.id] === fid)
          .sort((a, b) => (a.stageRaceNumber ?? 0) - (b.stageRaceNumber ?? 0));
        const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
        const nextN = races.length ? Math.max(...races.map((r) => r.stageRaceNumber ?? 0)) + 1 : 1;
        return (
          <div key={fid} className="flex flex-wrap items-center gap-2">
            <span className="w-40">
              <FleetChip meta={meta} count={fleetMembers(data.competitors, fid).length} />
            </span>
            {races.map((race) => {
              const done = raceCompleted(race, data.finishes);
              return (
                <Link
                  key={race.id}
                  href={`/series/${seriesId}/races/${race.id}`}
                  className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-background/70"
                  style={{
                    borderColor: meta.color,
                    backgroundColor: done ? `${meta.color}33` : undefined,
                  }}
                >
                  F{race.stageRaceNumber} {done ? '✓' : '· enter finishes'}
                </Link>
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
      {canManage && medalConfig && !medalRound && (
        <Button
          variant="outline"
          disabled={commitRound.isPending}
          onClick={() => void selectMedal()}
        >
          {commitRound.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Select medal fleet (top {medalConfig.size})
        </Button>
      )}
      {commitRound.isError && (
        <p className="text-sm text-destructive">{String(commitRound.error)}</p>
      )}
    </div>
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
        const races = data.races
          .filter((r) => r.stage === 'medal' && data.raceFleetIds[r.id] === fid)
          .sort((a, b) => (a.stageRaceNumber ?? 0) - (b.stageRaceNumber ?? 0));
        const meta = fleetMeta.get(fid) ?? { label: '?', color: '#888' };
        const nextN = races.length ? Math.max(...races.map((r) => r.stageRaceNumber ?? 0)) + 1 : 1;
        const isMedal = i === 0;
        const canAddMore =
          !isMedal ? races.length < 1 : races.length < (medalConfig?.raceCount ?? 1);
        return (
          <div key={fid} className="flex flex-wrap items-center gap-2">
            <span className="w-40">
              <FleetChip meta={meta} count={fleetMembers(data.competitors, fid).length} />
            </span>
            {races.map((race) => {
              const done = raceCompleted(race, data.finishes);
              return (
                <Link
                  key={race.id}
                  href={`/series/${seriesId}/races/${race.id}`}
                  className="rounded-md border px-2 py-0.5 text-xs font-medium hover:bg-background/70"
                  style={{
                    borderColor: meta.color,
                    backgroundColor: done ? `${meta.color}33` : undefined,
                  }}
                >
                  M{race.stageRaceNumber} {isMedal ? `·×${medalConfig?.multiplier ?? 2}` : ''}{' '}
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
}: {
  data: SplitFleetData;
  fleetMeta: Map<string, FleetMeta>;
  standings: SplitStandingRow[];
  splitRound: SplitRound | null;
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
      <h2 className="text-sm font-semibold uppercase tracking-wide">Standings</h2>
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
                <StandingsTable columns={columns}>{renderRows(rows, false)}</StandingsTable>
              </div>
            );
          })
        ) : (
          <StandingsTable columns={columns}>{renderRows(standings, true)}</StandingsTable>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Prototype standings: penalties, redress, and tie-break detail beyond
        score-list comparison are not applied. A qualifying race counts only
        once every fleet has completed it (greyed cells don&rsquo;t count);
        discarded scores are in parentheses.
      </p>
    </section>
  );
}

function StandingsTable({
  columns,
  children,
}: {
  columns: { stage: SeriesStage; n: number }[];
  children: React.ReactNode;
}) {
  return (
    <table className="w-full min-w-max text-sm">
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="py-1 pr-2 font-medium">Rank</th>
          <th className="py-1 pr-2 font-medium">Sail</th>
          <th className="py-1 pr-2 font-medium">Name</th>
          {columns.map((c) => (
            <th key={`${c.stage}:${c.n}`} className="px-1.5 py-1 text-center font-medium">
              {stagePrefix(c.stage)}
              {c.n}
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
  cutAfter,
  cutLabel,
}: {
  row: SplitStandingRow;
  columns: { stage: SeriesStage; n: number }[];
  cellByKey: Map<string, import('@/lib/split-fleets').CellScore>;
  fleetMeta: Map<string, FleetMeta>;
  cutAfter: boolean;
  cutLabel: string | null;
}) {
  return (
    <>
      <tr className="border-t">
        <td className="py-1 pr-2">{row.rank}</td>
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
              title={cell.counts ? undefined : 'Does not yet count — race incomplete across fleets'}
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
          <td colSpan={columns.length + 5} className="py-0">
            <div className="my-0.5 border-t-2 border-dashed border-amber-400 text-center text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400">
              {cutLabel}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
