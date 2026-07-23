import 'server-only';

// Split-fleet (qualifying/final series) API handlers. PROTOTYPE — see
// docs/design/split-fleets.md. Deliberate shortcuts: raw drizzle
// access instead of dedicated repository classes, coarse validation, and
// round deletion as the undo story.

import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import { BadRequestError, NotFoundError } from '@/app/api/v1/_lib/handler';
import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import * as schema from '@/lib/db/schema';
import { createRepos } from '@/lib/postgres-repository';
import { trackChange } from '@/lib/revision-log';
import { assertSeriesWritable } from '@/lib/api-handlers/series-access';
import { normalizeSplitFleetConfig } from '@/lib/split-fleets';
import type { SplitFleetConfig, SplitRound } from '@/lib/split-fleets';
import {
  splitFleetConfigSchema,
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

const STAGE_PREFIX: Record<SplitRound['stage'], string> = {
  qualifying: 'Q',
  final: 'F',
  medal: 'M',
};

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

    // Physical races + fleet-scoped starts.
    await createStageRaces(tx, {
      seriesId,
      workspaceId,
      stage: input.stage,
      stageRaceNumbers: input.stageRaceNumbers,
      fleets: fleetRows.map((f) => ({ id: f.id, label: f.name })),
      date: input.date,
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

async function createStageRaces(
  tx: Tx,
  input: {
    seriesId: string;
    workspaceId: string;
    stage: SplitRound['stage'];
    stageRaceNumbers: number[];
    fleets: { id: string; label: string }[];
    date: string;
  },
): Promise<void> {
  if (input.stageRaceNumbers.length === 0 || input.fleets.length === 0) return;
  const [{ maxNumber }] = await tx
    .select({ maxNumber: sql<number>`coalesce(max(${schema.races.raceNumber}), 0)` })
    .from(schema.races)
    .where(eq(schema.races.seriesId, input.seriesId));
  let next = maxNumber;
  const raceRows: (typeof schema.races.$inferInsert)[] = [];
  const startRows: (typeof schema.raceStarts.$inferInsert)[] = [];
  const date = input.date || new Date().toISOString().slice(0, 10);
  for (const n of input.stageRaceNumbers) {
    for (const fleet of input.fleets) {
      const raceId = crypto.randomUUID();
      raceRows.push({
        id: raceId,
        seriesId: input.seriesId,
        workspaceId: input.workspaceId,
        raceNumber: ++next,
        name: `${STAGE_PREFIX[input.stage]}${n} · ${fleet.label}`,
        date,
        stage: input.stage,
        stageRaceNumber: n,
      });
      startRows.push({
        id: crypto.randomUUID(),
        raceId,
        fleetIds: [fleet.id],
        startTime: null,
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
  const fleetIds = input.fleetIds ?? roundRow.fleetIds;
  if (fleetIds.some((fid) => !roundRow.fleetIds.includes(fid))) {
    throw new BadRequestError('fleet not in round');
  }
  const fleetRows = await db
    .select({ id: schema.fleets.id, name: schema.fleets.name })
    .from(schema.fleets)
    .where(inArray(schema.fleets.id, fleetIds));
  const byId = new Map(fleetRows.map((f) => [f.id, f]));

  await db.transaction(async (tx) => {
    await createStageRaces(tx, {
      seriesId,
      workspaceId: workspace.workspaceId,
      stage: roundRow.stage,
      stageRaceNumbers: input.stageRaceNumbers,
      // Preserve the round's fleet order.
      fleets: roundRow.fleetIds
        .filter((fid) => fleetIds.includes(fid))
        .map((fid) => ({ id: fid, label: byId.get(fid)?.name ?? '?' })),
      date: input.date,
    });
    const repos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    await repos.series.touch(seriesId);
  });

  await trackChange(workspace, {
    action: 'race.added',
    seriesId,
    summary: `Added ${roundRow.stage} race(s) ${input.stageRaceNumbers.join(', ')}`,
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
    // Races sailed by the round's fleets (single-fleet starts).
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
  let warning: string | null = null;
  if (round.stage === 'final') {
    const [sailed] = await getDb()
      .select({ id: schema.finishes.id })
      .from(schema.finishes)
      .innerJoin(schema.races, eq(schema.races.id, schema.finishes.raceId))
      .where(and(eq(schema.races.seriesId, seriesId), eq(schema.races.stage, 'final')))
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
