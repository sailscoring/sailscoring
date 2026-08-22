import 'server-only';

// Split-fleet (qualifying/final series) API handlers. PROTOTYPE — see
// docs/design/split-fleets.md. Deliberate shortcuts: raw drizzle
// access instead of dedicated repository classes, coarse validation, and
// round deletion as the undo story.

import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos, replaceSplitFleetState } from '@/lib/postgres-repository';
import { trackChange } from '@/lib/revision-log';
import { assertSeriesWritable } from '@/lib/api-handlers/series-access';
import { defaultRaceDate } from '@/lib/race-schedule';
import { normalizeSplitFleetConfig, stageRaceLabel } from '@/lib/split-fleets';
import type { SplitFleetConfig, SplitRound } from '@/lib/split-fleets';
import {
  splitAbandonStartSchema,
  splitFleetConfigSchema,
  splitFleetStateSchema,
  splitOverrideSchema,
  splitRoundCommitSchema,
  splitStageRacesSchema,
} from '@/lib/validation/split-fleets';

type SplitRoundRow = typeof schema.splitRounds.$inferSelect;

function roundRowToType(row: SplitRoundRow): SplitRound {
  return {
    id: row.id,
    seriesId: row.seriesId,
    stage: row.stage,
    fromStageRace: row.fromStageRace,
    fleetIds: row.fleetIds,
    method: row.method as SplitRound['method'],
    basis: row.basis ?? null,
    createdAt: row.createdAt.getTime(),
  };
}

/** Race labels follow the series' own numbering: the SIs may run one sequence
 *  across the qualifying and final stages ("Q1…Q12") rather than restarting.
 *  `qualifyingRaces` is what a continuous final stage counts on from. */
function raceLabel(
  config: SplitFleetConfig,
  stage: SplitRound['stage'],
  n: number,
  qualifyingRaces: number,
): string {
  return stageRaceLabel(config, stage, n, qualifyingRaces);
}

async function getSeriesRow(workspace: WorkspaceContext, seriesId: string) {
  const db = getDb();
  const [row] = await db
    .select({ id: schema.series.id, qfConfig: schema.series.qfConfig })
    .from(schema.series)
    .where(
      and(
        eq(schema.series.id, seriesId),
        eq(schema.series.workspaceId, workspace.workspaceId),
      ),
    );
  if (!row) throw new NotFoundError('series');
  return row;
}

export interface SplitFleetState {
  config: SplitFleetConfig | null;
  rounds: SplitRound[];
}

export async function getSplitFleetState(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<SplitFleetState> {
  await getSeriesRow(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [config, rounds] = await Promise.all([
    repos.splitRounds.getConfig(seriesId),
    repos.splitRounds.listBySeries(seriesId),
  ]);
  return { config, rounds };
}

export async function putSplitFleetConfig(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<SplitFleetState> {
  await assertSeriesWritable(workspace, seriesId);
  const config = splitFleetConfigSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });

  // The config-editability contract (design open question 6): once any race
  // has finishes, the structural fields — carry mode and qualifying fleet
  // count — are frozen; everything else merely re-scores and stays live.
  const existing = await repos.splitRounds.getConfig(seriesId);
  if (existing) {
    const [anyFinish] = await getDb()
      .select({ id: schema.finishes.id })
      .from(schema.finishes)
      .innerJoin(schema.races, eq(schema.races.id, schema.finishes.raceId))
      .where(eq(schema.races.seriesId, seriesId))
      .limit(1);
    if (anyFinish) {
      if (config.carry !== existing.carry) {
        throw new BadRequestError('carry mode is frozen once racing has started');
      }
      if (config.qualifyingFleets.length !== existing.qualifyingFleets.length) {
        throw new BadRequestError('qualifying fleet count is frozen once racing has started');
      }
    }
  }

  await repos.splitRounds.setConfig(seriesId, config);
  await trackChange(workspace, {
    action: 'split-fleets.configured',
    seriesId,
    summary: `Configured split fleets (${config.qualifyingFleets.length} qualifying fleets)`,
    sessionKey: 'split-fleets',
  });
  return getSplitFleetState(workspace, seriesId);
}

/**
 * Replay a `.sailscoring` file's split-fleet block over the series (#365).
 * The in-app file open/update runs in the browser against
 * `lib/api-repository`, so the block needs an endpoint to land through; the
 * CLI import and the revision/Trash restores reach the same writer directly
 * through `seriesFileReposFor`.
 *
 * Authoritative, like every other file-replay write: the config-editability
 * freeze that guards `putSplitFleetConfig` doesn't apply (the user has already
 * confirmed the overwrite), and no activity entry is recorded — this is one
 * part of an import that logs itself. Not feature-gated either: a file's
 * split-fleet block has to survive a round-trip through a workspace where the
 * tab is hidden.
 */
export async function putSplitFleetState(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<SplitFleetState> {
  await assertSeriesWritable(workspace, seriesId);
  const parsed = splitFleetStateSchema.parse(normalizeStateBody(body));
  const ctx = { workspaceId: workspace.workspaceId };
  const repos = createRepos(ctx);

  // Defence in depth: the client remaps every id onto the freshly-written rows
  // before posting, so anything unrecognised here is a bug or a hand-edited
  // file. Drop it rather than storing a round that points at nothing.
  const [fleets, competitors] = await Promise.all([
    repos.fleets.listBySeries(seriesId),
    repos.competitors.listBySeries(seriesId),
  ]);
  const fleetIds = new Set(fleets.map((f) => f.id));
  const competitorIds = new Set(competitors.map((c) => c.id));

  const rounds = parsed.rounds
    .map((r) => {
      const overrides = Object.fromEntries(
        Object.entries(r.overrides ?? {}).filter(
          ([competitorId, fleetId]) =>
            competitorIds.has(competitorId) && fleetIds.has(fleetId),
        ),
      );
      return {
        ...r,
        fleetIds: r.fleetIds.filter((id) => fleetIds.has(id)),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
      };
    })
    .filter((r) => r.fleetIds.length > 0);

  await replaceSplitFleetState(ctx, seriesId, { config: parsed.config, rounds });
  return getSplitFleetState(workspace, seriesId);
}

/** Bring an older file's config forward before validating it: `normalize`
 *  fills in the fields added since the file was written, so a v23-era block
 *  replays instead of failing the schema. */
function normalizeStateBody(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  const { config } = body as { config?: unknown };
  if (!config || typeof config !== 'object') return body;
  return {
    ...body,
    config: normalizeSplitFleetConfig(config as Partial<SplitFleetConfig>),
  };
}

/**
 * Commit one assignment round: create the fleets, append each assigned
 * competitor's membership, create the physical races (+ fleet-scoped
 * starts) for the requested stage race numbers, and store the round.
 * One transaction — the ceremony is atomic.
 */
export async function commitSplitRound(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<SplitRound> {
  await assertSeriesWritable(workspace, seriesId);
  const input = splitRoundCommitSchema.parse(body);
  const row = await getSeriesRow(workspace, seriesId);
  if (!row.qfConfig) throw new BadRequestError('series has no split-fleet config');

  const db = getDb();
  const workspaceId = workspace.workspaceId;
  const roundId = crypto.randomUUID();

  await db.transaction(async (tx) => {
    // Fleets, in SI/tier order.
    const [{ maxOrder }] = await tx
      .select({ maxOrder: sql<number>`coalesce(max(${schema.fleets.displayOrder}), -1)` })
      .from(schema.fleets)
      .where(eq(schema.fleets.seriesId, seriesId));
    const fleetRows = input.fleets.map((f, i) => ({
      id: crypto.randomUUID(),
      seriesId,
      workspaceId,
      name: f.label,
      displayOrder: maxOrder + 1 + i,
      scoringSystem: 'scratch',
      splitRoundId: roundId,
    }));
    await tx.insert(schema.fleets).values(fleetRows);

    // Memberships: one array-append UPDATE per fleet.
    for (let i = 0; i < fleetRows.length; i++) {
      const ids = Object.entries(input.assignments)
        .filter(([, idx]) => idx === i)
        .map(([cid]) => cid);
      if (ids.length === 0) continue;
      await tx
        .update(schema.competitors)
        .set({
          fleetIds: sql`array_append(${schema.competitors.fleetIds}, ${fleetRows[i].id}::uuid)`,
          version: sql`${schema.competitors.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            inArray(schema.competitors.id, ids),
            eq(schema.competitors.seriesId, seriesId),
            eq(schema.competitors.workspaceId, workspaceId),
          ),
        );
    }

    // The stage races. Medal-stage fleets always race apart (the umpired
    // medal race runs on its own course): one race per fleet. Qualifying and
    // final fleets start in sequence and finish onto one combined sheet, so
    // they share a race — unless the series says its finish sheets come one
    // per fleet, in which case they take the same shape the medal stage does.
    const config = normalizeSplitFleetConfig(row.qfConfig as Partial<SplitFleetConfig>);
    const apart = input.stage === 'medal' || config.finishSheets === 'per-fleet';
    const specs: StageRaceSpec[] = input.stageRaceNumbers.flatMap((n) => {
      const starts = fleetRows.map((f) => ({
        fleetId: f.id,
        label: f.name,
        stageRaceNumber: n,
      }));
      return apart
        ? starts.map((s) => ({ stage: input.stage, starts: [s] }))
        : [{ stage: input.stage, starts }];
    });
    await createStageRaces(tx, {
      seriesId,
      workspaceId,
      specs,
      date: input.date,
      config,
    });

    // Editable-preview hand-moves: record which boats were placed by hand
    // and where, as computed-vs-override provenance on the round.
    const overrides = Object.fromEntries(
      (input.overrideCompetitorIds ?? [])
        .filter((cid) => input.assignments[cid] != null)
        .map((cid) => [cid, fleetRows[input.assignments[cid]].id]),
    );
    await tx.insert(schema.splitRounds).values({
      id: roundId,
      seriesId,
      workspaceId,
      stage: input.stage,
      fromStageRace: input.fromStageRace,
      fleetIds: fleetRows.map((f) => f.id),
      method: input.method,
      basis: input.basis,
      overrides: Object.keys(overrides).length ? overrides : null,
      updatedBy: workspace.userId,
    });

    const repos = createRepos({ db: tx, workspaceId });
    await repos.series.touch(seriesId);
  });

  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary: `Committed ${input.stage} round (${input.fleets.map((f) => f.label).join(', ')})`,
    sessionKey: 'split-fleets',
  });

  const state = await getSplitFleetState(workspace, seriesId);
  const round = state.rounds.find((r) => r.id === roundId);
  if (!round) throw new NotFoundError('round');
  return round;
}

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0];

/** One race to create: a start sequence — the fleets that start in
 *  succession and finish onto one combined sheet. Usually every start
 *  sails the same stage race number; a sequence may span numbers when
 *  fleets are a race out of step (Gold F2 + Silver F2 + Bronze F1). */
interface StageRaceSpec {
  stage: SplitRound['stage'];
  starts: {
    fleetId: string;
    label: string;
    stageRaceNumber: number;
    firstPlaceOffset?: number;
  }[];
}

/** Display name for a sequence: "Q3" (whole sequence), "F2 · Gold" (a
 *  single-fleet race), "F2 · Gold + F1 · Bronze" (out-of-step fleets). */
function sequenceName(
  spec: StageRaceSpec,
  config: SplitFleetConfig,
  qualifyingRaces: number,
): string {
  const label = (n: number) => raceLabel(config, spec.stage, n, qualifyingRaces);
  const nums = [...new Set(spec.starts.map((s) => s.stageRaceNumber))];
  if (nums.length === 1) {
    return spec.starts.length === 1
      ? `${label(nums[0])} · ${spec.starts[0].label}`
      : label(nums[0]);
  }
  return spec.starts.map((s) => `${label(s.stageRaceNumber)} · ${s.label}`).join(' + ');
}

/** The fleets sharing one race must have pairwise-disjoint membership — a
 *  boat can appear at most once on a sheet. (An RC cannot run overlapping
 *  fleets in one sequence either: a boat cannot be on two start lines.) */
async function assertDisjointFleets(tx: Tx, seriesId: string, fleetIds: string[]): Promise<void> {
  if (fleetIds.length < 2) return;
  const members = await tx
    .select({ fleetIds: schema.competitors.fleetIds })
    .from(schema.competitors)
    .where(eq(schema.competitors.seriesId, seriesId));
  const wanted = new Set(fleetIds);
  for (const m of members) {
    const inSpec = m.fleetIds.filter((fid) => wanted.has(fid));
    if (inSpec.length > 1) {
      throw new BadRequestError(
        'fleets sharing a start sequence must not share competitors',
      );
    }
  }
}

/** The date to stamp on stage races when the caller supplies none: the last
 *  race in the series, else today clamped into the series window — the same
 *  rule the Races tab's Add race uses. */
async function fallbackRaceDate(tx: Tx, seriesId: string): Promise<string> {
  const [last] = await tx
    .select({ date: schema.races.date })
    .from(schema.races)
    .where(eq(schema.races.seriesId, seriesId))
    .orderBy(desc(schema.races.raceNumber))
    .limit(1);
  const [row] = await tx
    .select({ startDate: schema.series.startDate, endDate: schema.series.endDate })
    .from(schema.series)
    .where(eq(schema.series.id, seriesId));
  return defaultRaceDate({
    existingDates: last ? [last.date] : [],
    startDate: row?.startDate,
    endDate: row?.endDate,
  });
}

async function createStageRaces(
  tx: Tx,
  input: {
    seriesId: string;
    workspaceId: string;
    specs: StageRaceSpec[];
    date: string;
    config: SplitFleetConfig;
  },
): Promise<void> {
  const specs = input.specs.filter((s) => s.starts.length > 0);
  if (specs.length === 0) return;
  // What a continuous final stage numbers on from, counted over the starts
  // already stored plus any qualifying starts about to be written.
  const [{ qualifyingRaces }] = await tx
    .select({
      qualifyingRaces: sql<number>`coalesce(max(${schema.raceStarts.stageRaceNumber}), 0)`,
    })
    .from(schema.raceStarts)
    .innerJoin(schema.races, eq(schema.raceStarts.raceId, schema.races.id))
    .where(
      and(
        eq(schema.races.seriesId, input.seriesId),
        eq(schema.raceStarts.stage, 'qualifying'),
      ),
    );
  const qRaces = Math.max(
    qualifyingRaces,
    ...specs
      .filter((spec) => spec.stage === 'qualifying')
      .flatMap((spec) => spec.starts.map((st) => st.stageRaceNumber)),
    0,
  );
  for (const spec of specs) {
    await assertDisjointFleets(tx, input.seriesId, spec.starts.map((s) => s.fleetId));
  }
  const [{ maxNumber }] = await tx
    .select({ maxNumber: sql<number>`coalesce(max(${schema.races.raceNumber}), 0)` })
    .from(schema.races)
    .where(eq(schema.races.seriesId, input.seriesId));
  let next = maxNumber;
  const raceRows: (typeof schema.races.$inferInsert)[] = [];
  const startRows: (typeof schema.raceStarts.$inferInsert)[] = [];
  const date = input.date || (await fallbackRaceDate(tx, input.seriesId));
  for (const spec of specs) {
    const raceId = crypto.randomUUID();
    raceRows.push({
      id: raceId,
      seriesId: input.seriesId,
      workspaceId: input.workspaceId,
      raceNumber: ++next,
      name: sequenceName(spec, input.config, qRaces),
      date,
    });
    for (const s of spec.starts) {
      startRows.push({
        id: crypto.randomUUID(),
        raceId,
        fleetIds: [s.fleetId],
        startTime: null,
        stage: spec.stage,
        stageRaceNumber: s.stageRaceNumber,
        firstPlaceOffset: s.firstPlaceOffset ?? null,
      });
    }
  }
  await tx.insert(schema.races).values(raceRows);
  await tx.insert(schema.raceStarts).values(startRows);
}

export async function addStageRaces(
  workspace: WorkspaceContext,
  seriesId: string,
  roundId: string,
  body: unknown,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const input = splitStageRacesSchema.parse(body);
  const db = getDb();
  const [roundRow] = await db
    .select()
    .from(schema.splitRounds)
    .where(
      and(
        eq(schema.splitRounds.id, roundId),
        eq(schema.splitRounds.seriesId, seriesId),
        eq(schema.splitRounds.workspaceId, workspace.workspaceId),
      ),
    );
  if (!roundRow) throw new NotFoundError('round');
  const requestedIds = input.starts?.map((s) => s.fleetId) ?? input.fleetIds ?? roundRow.fleetIds;
  if (requestedIds.some((fid) => !roundRow.fleetIds.includes(fid))) {
    throw new BadRequestError('fleet not in round');
  }
  const fleetRows = await db
    .select({ id: schema.fleets.id, name: schema.fleets.name })
    .from(schema.fleets)
    .where(inArray(schema.fleets.id, requestedIds));
  const byId = new Map(fleetRows.map((f) => [f.id, f]));
  const seriesRow = await getSeriesRow(workspace, seriesId);
  const config = normalizeSplitFleetConfig(seriesRow.qfConfig as Partial<SplitFleetConfig>);

  // The boats who missed the medal fleet sail one more race of their own
  // final fleet, and where the sailing instructions score it below the medal
  // fleet its finishers are offset by the boats who left *that* fleet — a
  // fleet nobody left is scored from 1 like any other race of the stage.
  const [medalRound] =
    roundRow.stage === 'final' && config.medal?.companionRace === 'scored-below'
      ? await db
          .select({ fleetIds: schema.splitRounds.fleetIds })
          .from(schema.splitRounds)
          .where(
            and(
              eq(schema.splitRounds.seriesId, seriesId),
              eq(schema.splitRounds.workspaceId, workspace.workspaceId),
              eq(schema.splitRounds.stage, 'medal'),
            ),
          )
      : [];
  const medalFleetId = medalRound?.fleetIds[0] ?? null;
  const medalMembers = medalFleetId
    ? await db
        .select({ fleetIds: schema.competitors.fleetIds })
        .from(schema.competitors)
        .where(
          and(
            eq(schema.competitors.seriesId, seriesId),
            eq(schema.competitors.workspaceId, workspace.workspaceId),
          ),
        )
        .then((rows) => rows.filter((c) => c.fleetIds.includes(medalFleetId)))
    : [];
  const offsetFor = (fleetId: string): { firstPlaceOffset?: number } => {
    const gone = medalMembers.filter((c) => c.fleetIds.includes(fleetId)).length;
    return gone > 0 ? { firstPlaceOffset: gone } : {};
  };

  // In the round's fleet order, each start's own stage race number.
  const orderStarts = (starts: { fleetId: string; stageRaceNumber: number }[]) =>
    roundRow.fleetIds
      .filter((fid) => starts.some((s) => s.fleetId === fid))
      .map((fid) => ({
        fleetId: fid,
        label: byId.get(fid)?.name ?? '?',
        stageRaceNumber: starts.find((s) => s.fleetId === fid)!.stageRaceNumber,
        ...offsetFor(fid),
      }));

  // The shape a race added now takes is the shape the ceremony gave the round:
  // medal-stage fleets always race apart (own courses), and so does every
  // stage when the series says its finish sheets come one per fleet.
  const apart = roundRow.stage === 'medal' || config.finishSheets === 'per-fleet';
  const asSpecs = (starts: StageRaceSpec['starts']): StageRaceSpec[] =>
    apart
      ? starts.map((s) => ({ stage: roundRow.stage, starts: [s] }))
      : [{ stage: roundRow.stage, starts }];

  const specs: StageRaceSpec[] = input.starts?.length
    ? asSpecs(orderStarts(input.starts))
    : input.stageRaceNumbers.flatMap((n) =>
        asSpecs(orderStarts(requestedIds.map((fid) => ({ fleetId: fid, stageRaceNumber: n })))),
      );

  await db.transaction(async (tx) => {
    await createStageRaces(tx, {
      seriesId,
      workspaceId: workspace.workspaceId,
      specs,
      date: input.date,
      config,
    });
    const repos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    await repos.series.touch(seriesId);
  });

  const added = input.starts?.length
    ? input.starts.map((s) => s.stageRaceNumber).join(', ')
    : input.stageRaceNumbers.join(', ');
  await trackChange(workspace, {
    action: 'race.added',
    seriesId,
    summary: `Added ${roundRow.stage} race(s) ${added}`,
    sessionKey: 'split-fleets',
  });
}

/**
 * Prototype undo: delete a round with everything it created — its races
 * (finishes cascade), its fleets, and the membership entries. Only the
 * newest round of a stage may be deleted, so history stays consistent.
 */
export async function deleteSplitRound(
  workspace: WorkspaceContext,
  seriesId: string,
  roundId: string,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const db = getDb();
  const rounds = await db
    .select()
    .from(schema.splitRounds)
    .where(
      and(
        eq(schema.splitRounds.seriesId, seriesId),
        eq(schema.splitRounds.workspaceId, workspace.workspaceId),
      ),
    );
  const round = rounds.find((r) => r.id === roundId);
  if (!round) throw new NotFoundError('round');
  const laterSameStage = rounds.some(
    (r) =>
      r.id !== roundId &&
      r.stage === round.stage &&
      r.createdAt.getTime() > round.createdAt.getTime(),
  );
  const laterStage =
    (round.stage === 'qualifying' && rounds.some((r) => r.stage !== 'qualifying')) ||
    (round.stage === 'final' && rounds.some((r) => r.stage === 'medal'));
  if (laterSameStage || laterStage) {
    throw new BadRequestError('only the newest round can be deleted');
  }

  await db.transaction(async (tx) => {
    // Races whose sequences include any of the round's fleets. A sequence
    // only ever combines fleets of one round, so this never catches another
    // round's races.
    const startRows = await tx
      .select({ raceId: schema.raceStarts.raceId, fleetIds: schema.raceStarts.fleetIds })
      .from(schema.raceStarts)
      .innerJoin(schema.races, eq(schema.races.id, schema.raceStarts.raceId))
      .where(eq(schema.races.seriesId, seriesId));
    const raceIds = startRows
      .filter((s) => s.fleetIds.some((fid) => round.fleetIds.includes(fid)))
      .map((s) => s.raceId);
    if (raceIds.length) {
      await tx.delete(schema.races).where(inArray(schema.races.id, raceIds));
    }
    for (const fid of round.fleetIds) {
      await tx
        .update(schema.competitors)
        .set({
          fleetIds: sql`array_remove(${schema.competitors.fleetIds}, ${fid}::uuid)`,
          version: sql`${schema.competitors.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.competitors.seriesId, seriesId),
            sql`${schema.competitors.fleetIds} && array[${fid}::uuid]`,
          ),
        );
    }
    await tx.delete(schema.fleets).where(inArray(schema.fleets.id, round.fleetIds));
    await tx.delete(schema.splitRounds).where(eq(schema.splitRounds.id, roundId));
    const repos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    await repos.series.touch(seriesId);
  });

  await trackChange(workspace, {
    action: 'split-fleets.round-deleted',
    seriesId,
    summary: `Deleted ${round.stage} round`,
    sessionKey: 'split-fleets',
  });
}

/**
 * Manual placement on a round: late entry, RC/jury move, wrong-fleet
 * correction, or (on the final round) a redress promotion. Moves the boat's
 * membership between the round's fleets and records the override on the
 * round. Promotion after final racing has begun is allowed but flagged —
 * the response carries `warning` so the UI routes the scorer to the
 * jury-shaped resolution (the boat already has scores in the old fleet).
 */
export async function applySplitOverride(
  workspace: WorkspaceContext,
  seriesId: string,
  roundId: string,
  body: unknown,
): Promise<{ warning: string | null }> {
  await assertSeriesWritable(workspace, seriesId);
  const input = splitOverrideSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const round = await repos.splitRounds.get(roundId);
  if (!round || round.seriesId !== seriesId) throw new NotFoundError('round');
  if (!round.fleetIds.includes(input.toFleetId)) {
    throw new BadRequestError('target fleet is not part of this round');
  }

  // Post-finals promotion check: any completed race in this round's stage?
  // Stage identity lives on the starts, so a race is final-stage when any of
  // its starts is.
  let warning: string | null = null;
  if (round.stage === 'final') {
    const [sailed] = await getDb()
      .select({ id: schema.finishes.id })
      .from(schema.finishes)
      .innerJoin(schema.races, eq(schema.races.id, schema.finishes.raceId))
      .innerJoin(schema.raceStarts, eq(schema.raceStarts.raceId, schema.races.id))
      .where(and(eq(schema.races.seriesId, seriesId), eq(schema.raceStarts.stage, 'final')))
      .limit(1);
    if (sailed) {
      warning =
        'Final racing has started: the boat already has scores in her ' +
        'current fleet. Record how the protest committee directs those ' +
        'scores to be treated — this move only changes the assignment.';
    }
  }

  await getDb().transaction(async (tx) => {
    const txRepos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    // Move membership: drop the round's other fleets, add the target.
    for (const fid of round.fleetIds) {
      if (fid === input.toFleetId) continue;
      await tx
        .update(schema.competitors)
        .set({
          fleetIds: sql`array_remove(${schema.competitors.fleetIds}, ${fid}::uuid)`,
          version: sql`${schema.competitors.version} + 1`,
          updatedAt: sql`now()`,
        })
        .where(
          and(
            eq(schema.competitors.id, input.competitorId),
            eq(schema.competitors.seriesId, seriesId),
            eq(schema.competitors.workspaceId, workspace.workspaceId),
          ),
        );
    }
    await tx
      .update(schema.competitors)
      .set({
        fleetIds: sql`array_append(array_remove(${schema.competitors.fleetIds}, ${input.toFleetId}::uuid), ${input.toFleetId}::uuid)`,
        version: sql`${schema.competitors.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schema.competitors.id, input.competitorId),
          eq(schema.competitors.seriesId, seriesId),
          eq(schema.competitors.workspaceId, workspace.workspaceId),
        ),
      );
    await txRepos.splitRounds.setOverrides(
      roundId,
      { ...(round.overrides ?? {}), [input.competitorId]: input.toFleetId },
      { updatedBy: workspace.userId },
    );
    await txRepos.series.touch(seriesId);
  });

  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary: 'Manual fleet placement recorded',
    sessionKey: 'split-fleets',
  });
  return { warning };
}

/**
 * Abandon one fleet's physical race: remove the fleet from the race's start
 * sequence and void the fleet's rows on the sheet (an abandoned race has no
 * results — RRS "abandoned"). The rest of the sequence stands untouched.
 * When the last start goes, the race goes with it. The resail is a fresh
 * catch-up race for that fleet (`addStageRaces`), so each sheet stays an
 * honest record of one session — and the logical race keys the fleet to the
 * completed resail.
 */
export async function abandonSplitStart(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<void> {
  await assertSeriesWritable(workspace, seriesId);
  const input = splitAbandonStartSchema.parse(body);
  const db = getDb();
  const [race] = await db
    .select({ id: schema.races.id, name: schema.races.name })
    .from(schema.races)
    .where(
      and(
        eq(schema.races.id, input.raceId),
        eq(schema.races.seriesId, seriesId),
        eq(schema.races.workspaceId, workspace.workspaceId),
      ),
    );
  if (!race) throw new NotFoundError('race');
  const starts = await db
    .select()
    .from(schema.raceStarts)
    .where(eq(schema.raceStarts.raceId, race.id));
  const withFleet = starts.filter((s) => s.fleetIds.includes(input.fleetId));
  if (withFleet.length === 0) {
    throw new BadRequestError('fleet has no start in this race');
  }
  const [fleetRow] = await db
    .select({ name: schema.fleets.name })
    .from(schema.fleets)
    .where(eq(schema.fleets.id, input.fleetId));

  let raceDeleted = false;
  await db.transaction(async (tx) => {
    // Void the fleet's rows on the sheet.
    const members = await tx
      .select({ id: schema.competitors.id })
      .from(schema.competitors)
      .where(
        and(
          eq(schema.competitors.seriesId, seriesId),
          sql`${schema.competitors.fleetIds} && array[${input.fleetId}::uuid]`,
        ),
      );
    if (members.length) {
      await tx.delete(schema.finishes).where(
        and(
          eq(schema.finishes.raceId, race.id),
          inArray(schema.finishes.competitorId, members.map((m) => m.id)),
        ),
      );
    }
    // Drop the fleet from its start(s); an emptied start goes entirely.
    for (const s of withFleet) {
      const rest = s.fleetIds.filter((fid) => fid !== input.fleetId);
      if (rest.length) {
        await tx
          .update(schema.raceStarts)
          .set({
            fleetIds: rest,
            version: sql`${schema.raceStarts.version} + 1`,
            updatedAt: sql`now()`,
            updatedBy: workspace.userId,
          })
          .where(eq(schema.raceStarts.id, s.id));
      } else {
        await tx.delete(schema.raceStarts).where(eq(schema.raceStarts.id, s.id));
      }
    }
    // A race with no starts left isn't a session any more — and would scope
    // finish entry to every competitor — so it goes too.
    const remaining = await tx
      .select({ id: schema.raceStarts.id })
      .from(schema.raceStarts)
      .where(eq(schema.raceStarts.raceId, race.id))
      .limit(1);
    if (remaining.length === 0) {
      await tx.delete(schema.races).where(eq(schema.races.id, race.id));
      raceDeleted = true;
    }
    const repos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    await repos.series.touch(seriesId);
  });

  await trackChange(workspace, {
    action: raceDeleted ? 'race.deleted' : 'race.updated',
    seriesId,
    summary: `Abandoned ${fleetRow?.name ?? 'fleet'}'s race${race.name ? ` (${race.name})` : ''}`,
    sessionKey: 'split-fleets',
  });
}
