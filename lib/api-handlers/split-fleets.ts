import 'server-only';

// Split-fleet (qualifying/final series) API handlers. PROTOTYPE — see
// docs/design/qualifying-final-series.md. Deliberate shortcuts: raw drizzle
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
import type { SplitFleetConfig, SplitRound } from '@/lib/split-fleets';
import {
  splitFleetConfigSchema,
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
  const row = await getSeriesRow(workspace, seriesId);
  const db = getDb();
  const rounds = await db
    .select()
    .from(schema.splitRounds)
    .where(eq(schema.splitRounds.seriesId, seriesId))
    .orderBy(asc(schema.splitRounds.createdAt));
  return { config: row.qfConfig ?? null, rounds: rounds.map(roundRowToType) };
}

export async function putSplitFleetConfig(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<SplitFleetState> {
  await assertSeriesWritable(workspace, seriesId);
  const config = splitFleetConfigSchema.parse(body);
  const db = getDb();
  await db
    .update(schema.series)
    .set({ qfConfig: config })
    .where(
      and(
        eq(schema.series.id, seriesId),
        eq(schema.series.workspaceId, workspace.workspaceId),
      ),
    );
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

    await tx.insert(schema.splitRounds).values({
      id: roundId,
      seriesId,
      workspaceId,
      stage: input.stage,
      fromStageRace: input.fromStageRace,
      fleetIds: fleetRows.map((f) => f.id),
      method: input.method,
      basis: input.basis,
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
