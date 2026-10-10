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
import {
  duplicateBoats,
  finishSheetsInUse,
  normalizeSplitFleetConfig,
  repechageBoatsOutsidePool,
  repechageEligibleIds,
  resolveVocabulary,
  stageRaceLabel,
  type FinishSheets,
} from '@/lib/split-fleets';
import type { OverrideReason, SplitFleetConfig, SplitRound } from '@/lib/split-fleets';
import type { Competitor } from '@/lib/types';
import {
  splitAbandonStartSchema,
  splitPromotionSchema,
  splitFleetBoatsSchema,
  splitFleetConfigSchema,
  splitFleetStateSchema,
  splitOverrideSchema,
  splitRoundCommitSchema,
  splitStageRacesSchema,
  splitSwapSchema,
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
  const db = getDb();

  const existing = await repos.splitRounds.getConfig(seriesId);
  if (!existing) {
    // A series is a split-fleet championship from the start or not at all.
    // Its races carry a stage and belong to a round's fleets; races sailed
    // before the format existed would carry neither, and nothing could give
    // it to them.
    const [anyRace] = await db
      .select({ id: schema.races.id })
      .from(schema.races)
      .where(eq(schema.races.seriesId, seriesId))
      .limit(1);
    if (anyRace) {
      throw new BadRequestError('a series that has raced cannot become a split-fleet championship');
    }
  } else {
    // Locks follow what has been sailed. The words are the race labels, which
    // are on the notice board once a race exists; a stage's fleet count is
    // settled once a round has dealt its fleets; and the division once the
    // split has given boats second-stage scores. Everything else re-scores
    // and stays live.
    const [[anyRace], rounds] = await Promise.all([
      db
        .select({ id: schema.races.id })
        .from(schema.races)
        .where(eq(schema.races.seriesId, seriesId))
        .limit(1),
      repos.splitRounds.listBySeries(seriesId),
    ]);
    const hasRound = (stage: SplitRound['stage']) => rounds.some((r) => r.stage === stage);
    if (anyRace && config.vocabulary !== existing.vocabulary) {
      throw new BadRequestError('the words are settled once a race exists');
    }
    if (hasRound('qualifying') && config.qualifyingFleets.length !== existing.qualifyingFleets.length) {
      throw new BadRequestError('the fleet count is settled once the first round has dealt its fleets');
    }
    if (
      hasRound('final') &&
      (config.split.kind !== existing.split.kind ||
        config.finalFleets.length !== existing.finalFleets.length)
    ) {
      throw new BadRequestError('the division is settled once the split is committed');
    }
    if (hasRound('medal') && !config.medal) {
      throw new BadRequestError('the medal stage is settled once its fleet is selected');
    }
    // A repêchage drawn from outside the fleet the medal fleet is selected
    // from is only fair while the medal races carry nothing: carried in, a
    // Silver score would be set against Gold's.
    if (config.medal && config.medal.carry !== existing.medal?.carry) {
      const outside = repechageBoatsOutsidePool(
        { rounds, competitors: await repos.competitors.listBySeries(seriesId) },
        config.medal.carry,
      );
      if (outside.length > 0) {
        throw new BadRequestError(
          `the medal races cannot carry a score while ${boatList(outside)} ${
            outside.length === 1 ? 'is' : 'are'
          } in the repêchage or promoted from outside the fleet the medal fleet is selected from`,
        );
      }
    }
  }

  await repos.splitRounds.setConfig(seriesId, config);
  if (existing) await relabelStageRaces(seriesId, workspace.workspaceId, existing, config);
  await trackChange(workspace, {
    action: 'split-fleets.configured',
    seriesId,
    summary: `Configured split fleets (${config.qualifyingFleets.length} qualifying fleets)`,
    sessionKey: 'split-fleets',
  });
  return getSplitFleetState(workspace, seriesId);
}

/**
 * Take the split-fleet format off a series again. Only while nothing has been
 * built on it: once a round exists, its fleets, memberships and races are the
 * format's, and the way back is deleting the rounds first. This is the undo
 * for choosing the wrong kind of series in the setup wizard, not a way to
 * turn a championship back into a club series.
 */
export async function deleteSplitFleetConfig(
  workspace: WorkspaceContext,
  seriesId: string,
): Promise<SplitFleetState> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const existing = await repos.splitRounds.getConfig(seriesId);
  if (!existing) return getSplitFleetState(workspace, seriesId);
  const rounds = await repos.splitRounds.listBySeries(seriesId);
  if (rounds.length > 0) {
    throw new BadRequestError('the split-fleet format cannot be removed once fleets have been assigned');
  }
  await repos.splitRounds.setConfig(seriesId, null);
  await trackChange(workspace, {
    action: 'split-fleets.removed',
    seriesId,
    summary: 'Removed the split-fleet format',
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
      const overrideReasons = Object.fromEntries(
        Object.entries(r.overrideReasons ?? {}).filter(([competitorId]) => competitorIds.has(competitorId)),
      );
      const { overrides: _overrides, overrideReasons: _overrideReasons, ...rest } = r;
      return {
        ...rest,
        fleetIds: r.fleetIds.filter((id) => fleetIds.has(id)),
        ...(Object.keys(overrides).length > 0 ? { overrides } : {}),
        ...(Object.keys(overrideReasons).length > 0 ? { overrideReasons } : {}),
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
  let deletedFleetNames: string[] = [];

  for (let i = 0; i < input.fleets.length; i++) {
    const dup = duplicateBoats(
      Object.entries(input.boats)
        .filter(([cid]) => input.assignments[cid] === i)
        .map(([, boat]) => boat),
    );
    if (dup.length > 0) {
      throw new BadRequestError(
        `${input.fleets[i].label}: boat ${dup.join(', ')} is drawn for more than one entry`,
      );
    }
  }

  await db.transaction(async (tx) => {
    // Fleets the scorer agreed to shed with this ceremony (a leftover
    // "Default" from an entry-list import, pre-conversion fleets) go first,
    // memberships and all.
    if (input.deleteFleetIds.length > 0) {
      deletedFleetNames = await deleteNonRoundFleets(
        tx,
        seriesId,
        workspaceId,
        input.deleteFleetIds,
      );
    }

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
      color: f.color,
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
      const drawn = new Map(
        ids.filter((cid) => input.boats[cid]).map((cid) => [cid, input.boats[cid]]),
      );
      await writeFleetBoats(tx, seriesId, workspaceId, fleetRows[i].id, drawn);
    }

    // The stage races. Medal-stage fleets always race apart (the umpired
    // medal race runs on its own course): one race per fleet. Qualifying and
    // final fleets share a race when they finish onto one combined sheet, and
    // take a race each when their sheets come one per fleet — as the request
    // says, or else as the championship's races so far have done.
    const config = normalizeSplitFleetConfig(row.qfConfig as Partial<SplitFleetConfig>);
    if (input.stage === 'medal' && !config.medal) {
      throw new BadRequestError('this championship has no medal stage');
    }
    if (input.stage === 'repechage') {
      await assertRepechageCommittable(tx, workspace, seriesId, config, Object.keys(input.assignments));
    }
    // Fleets that share drawn boats can't be on one sheet — the same boat
    // would be two helms in one race — so they always race apart.
    const apart =
      input.stage === 'medal' ||
      config.boatAssignments === true ||
      (input.finishSheets ?? (await inheritedFinishSheets(tx, seriesId))) === 'per-fleet';
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
    await repos.series.touch(seriesId, workspace.userId);
  });

  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary:
      `Committed ${input.stage} round (${input.fleets.map((f) => f.label).join(', ')})` +
      (deletedFleetNames.length
        ? `; removed fleet${deletedFleetNames.length > 1 ? 's' : ''} ${deletedFleetNames.join(', ')}`
        : ''),
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
): string {
  const label = (n: number) => stageRaceLabel(config, spec.stage, n);
  const nums = [...new Set(spec.starts.map((s) => s.stageRaceNumber))];
  if (nums.length === 1) {
    return spec.starts.length === 1
      ? `${label(nums[0])} · ${spec.starts[0].label}`
      : label(nums[0]);
  }
  return spec.starts.map((s) => `${label(s.stageRaceNumber)} · ${s.label}`).join(' + ');
}

/**
 * Rewrite the names of the series' stage races after its labels change.
 *
 * A race's name is written when it is created, so a scorer who corrects the
 * scheme mid-event — the notice board says QE1 and we called it Q6 — would
 * otherwise get relabelled standings columns above a races list still saying
 * Q6. Only races still holding the name the old configuration wrote are
 * touched: a name the scorer typed themselves is theirs, and so is the name
 * of a race whose starts we cannot put back in the order they were written
 * in (an out-of-step sequence, whose name spans two stage races).
 */
async function relabelStageRaces(
  seriesId: string,
  workspaceId: string,
  before: SplitFleetConfig,
  after: SplitFleetConfig,
): Promise<void> {
  const wasLabelled = JSON.stringify(resolveVocabulary(before).prefixes);
  if (wasLabelled === JSON.stringify(resolveVocabulary(after).prefixes)) return;
  const db = getDb();
  const rows = await db
    .select({
      raceId: schema.races.id,
      name: schema.races.name,
      stage: schema.raceStarts.stage,
      stageRaceNumber: schema.raceStarts.stageRaceNumber,
      fleetIds: schema.raceStarts.fleetIds,
    })
    .from(schema.raceStarts)
    .innerJoin(schema.races, eq(schema.raceStarts.raceId, schema.races.id))
    .where(and(eq(schema.races.seriesId, seriesId), eq(schema.races.workspaceId, workspaceId)));
  const fleetRows = await db
    .select({ id: schema.fleets.id, name: schema.fleets.name })
    .from(schema.fleets)
    .where(and(eq(schema.fleets.seriesId, seriesId), eq(schema.fleets.workspaceId, workspaceId)));
  const fleetName = new Map(fleetRows.map((f) => [f.id, f.name]));
  const byRace = new Map<string, { name: string | null; specs: typeof rows }>();
  for (const row of rows) {
    if (!row.stage || row.stageRaceNumber == null) continue;
    const entry = byRace.get(row.raceId) ?? { name: row.name, specs: [] };
    entry.specs.push(row);
    byRace.set(row.raceId, entry);
  }
  for (const [raceId, entry] of byRace) {
    const starts = [...entry.specs]
      .map((r) => ({
        fleetId: r.fleetIds[0] ?? '',
        label: r.fleetIds.map((id) => fleetName.get(id) ?? '?').join(' + '),
        stageRaceNumber: r.stageRaceNumber as number,
      }))
      .sort((a, b) => a.stageRaceNumber - b.stageRaceNumber || a.label.localeCompare(b.label));
    const spec: StageRaceSpec = { stage: entry.specs[0].stage as SplitRound['stage'], starts };
    const was = sequenceName(spec, before);
    const now = sequenceName(spec, after);
    if (entry.name !== was || now === was) continue;
    await db
      .update(schema.races)
      .set({ name: now })
      .where(and(eq(schema.races.id, raceId), eq(schema.races.workspaceId, workspaceId)));
  }
}

/**
 * Remove non-round fleets as part of a ceremony commit: strip every
 * competitor's membership, then delete the rows. Refuses — rather than
 * skips — a fleet outside the series, owned by a round, or referenced by a
 * race start, so the commit deletes exactly what the dialog showed and
 * nothing is left dangling. Returns the deleted fleets' names.
 */
async function deleteNonRoundFleets(
  tx: Tx,
  seriesId: string,
  workspaceId: string,
  fleetIds: string[],
): Promise<string[]> {
  const ids = [...new Set(fleetIds)];
  const rows = await tx
    .select({
      id: schema.fleets.id,
      name: schema.fleets.name,
      splitRoundId: schema.fleets.splitRoundId,
    })
    .from(schema.fleets)
    .where(
      and(
        inArray(schema.fleets.id, ids),
        eq(schema.fleets.seriesId, seriesId),
        eq(schema.fleets.workspaceId, workspaceId),
      ),
    );
  if (rows.length !== ids.length) throw new NotFoundError('fleet');
  if (rows.some((r) => r.splitRoundId)) {
    throw new BadRequestError('cannot delete a round-owned fleet');
  }
  const startRows = await tx
    .select({ fleetIds: schema.raceStarts.fleetIds })
    .from(schema.raceStarts)
    .innerJoin(schema.races, eq(schema.races.id, schema.raceStarts.raceId))
    .where(eq(schema.races.seriesId, seriesId));
  if (startRows.some((s) => s.fleetIds.some((fid) => ids.includes(fid)))) {
    throw new BadRequestError('cannot delete a fleet referenced by a race start');
  }
  for (const fid of ids) {
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
  await tx.delete(schema.fleets).where(inArray(schema.fleets.id, ids));
  return rows.map((r) => r.name);
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
/** The sheet layout the championship's races have used so far (see
 *  `finishSheetsInUse`). */
async function inheritedFinishSheets(
  tx: Tx | ReturnType<typeof getDb>,
  seriesId: string,
): Promise<FinishSheets> {
  const [rounds, races, raceStarts] = await Promise.all([
    tx
      .select({ stage: schema.splitRounds.stage, fleetIds: schema.splitRounds.fleetIds })
      .from(schema.splitRounds)
      .where(eq(schema.splitRounds.seriesId, seriesId)),
    tx
      .select({ id: schema.races.id, raceNumber: schema.races.raceNumber })
      .from(schema.races)
      .where(eq(schema.races.seriesId, seriesId)),
    tx
      .select({
        raceId: schema.raceStarts.raceId,
        fleetIds: schema.raceStarts.fleetIds,
        stage: schema.raceStarts.stage,
      })
      .from(schema.raceStarts)
      .innerJoin(schema.races, eq(schema.raceStarts.raceId, schema.races.id))
      .where(eq(schema.races.seriesId, seriesId)),
  ]);
  return finishSheetsInUse({ rounds, races, raceStarts });
}

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
      name: sequenceName(spec, input.config),
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
  // fleet — of the final series, or of the opening series where it is never
  // divided — scored below the medal fleet: its finishers are offset by the
  // boats who left *that* fleet, and a fleet nobody left is scored from 1
  // like any other race of the stage. A race of the stage added before the
  // medal fleet exists is an ordinary one.
  const [medalRound] =
    roundRow.stage === 'qualifying' || roundRow.stage === 'final'
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

  // Medal-stage fleets always race apart (own courses), and so do fleets
  // sharing drawn boats. Otherwise a race added now takes the sheet layout
  // the request names, or the one the championship's races have used so far.
  const apart =
    roundRow.stage === 'medal' ||
    config.boatAssignments === true ||
    (input.finishSheets ?? (await inheritedFinishSheets(db, seriesId))) === 'per-fleet';
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
    await repos.series.touch(seriesId, workspace.userId);
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
  // The repêchage hangs off the medal fleet: it goes first, and it stays
  // once a boat has been promoted from it, since her seat came from it.
  if (round.stage === 'medal' && rounds.some((r) => r.stage === 'repechage')) {
    throw new BadRequestError('delete the repêchage before the medal fleet');
  }
  if (
    round.stage === 'repechage' &&
    rounds.some((r) => r.stage === 'medal' && Object.values(r.overrideReasons ?? {}).includes('repechage'))
  ) {
    throw new BadRequestError('a boat has been promoted from the repêchage');
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
    await repos.series.touch(seriesId, workspace.userId);
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
 * membership between the round's fleets, with her drawn boat where the
 * championship draws them, and records the override on the round. Promotion
 * after final racing has begun is allowed but flagged — the response carries
 * `warning` so the UI routes the scorer to the jury-shaped resolution (the
 * boat already has scores in the old fleet).
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
  if (round.stage === 'repechage') {
    await editRepechageMembership(workspace, seriesId, round, input.competitorId, input.toFleetId, input.boat);
    return { warning: null };
  }
  if (input.toFleetId === null) {
    throw new BadRequestError('only a repêchage boat can be taken out of a round');
  }
  const toFleetId = input.toFleetId;
  if (!round.fleetIds.includes(toFleetId)) {
    throw new BadRequestError('target fleet is not part of this round');
  }
  if (input.boat?.trim()) await assertDrawsBoats(workspace, seriesId);

  const fleetName = await roundFleetNames(round);
  let placed!: Placement;
  await getDb().transaction(async (tx) => {
    const txRepos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    placed = await placeInRound(tx, workspace.workspaceId, seriesId, {
      competitorId: input.competitorId,
      roundFleetIds: round.fleetIds,
      toFleetId,
      boat: input.boat,
      fleetName,
    });
    await txRepos.splitRounds.setOverrides(
      roundId,
      { ...(round.overrides ?? {}), [input.competitorId]: toFleetId },
      { updatedBy: workspace.userId },
    );
    await txRepos.series.touch(seriesId, workspace.userId);
  });
  const warning =
    round.stage === 'qualifying'
      ? await qualifyingPlacementWarning(
          workspace,
          seriesId,
          round,
          [{ competitorId: input.competitorId, sailNumber: placed.sailNumber, toFleetId }],
          fleetName,
        )
      : await laterStageWarning(seriesId, round.stage);

  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary:
      placed.fromFleetId === null
        ? `Placed ${placed.sailNumber} in ${fleetName(toFleetId)}`
        : placed.fromFleetId === toFleetId
          ? `Redrew ${placed.sailNumber}'s boat in ${fleetName(toFleetId)}`
          : `Moved ${placed.sailNumber} from ${fleetName(placed.fromFleetId)} to ${fleetName(toFleetId)}`,
    sessionKey: 'split-fleets',
  });
  return { warning };
}

/**
 * Two entries of a qualifying round exchange places: each takes the other's
 * fleet and, where boats are drawn, the other's boat there. It is how two
 * entries dealt the wrong way round are put right, and where they hold the
 * same boat number it is the only way: as two moves, the first clashes with
 * the second entry's boat until she has moved too.
 */
export async function swapSplitRoundEntries(
  workspace: WorkspaceContext,
  seriesId: string,
  roundId: string,
  body: unknown,
): Promise<{ warning: string | null }> {
  await assertSeriesWritable(workspace, seriesId);
  const input = splitSwapSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const round = await repos.splitRounds.get(roundId);
  if (!round || round.seriesId !== seriesId) throw new NotFoundError('round');
  if (round.stage !== 'qualifying') {
    throw new BadRequestError('only the entries of a qualifying round can be swapped');
  }
  const competitors = await repos.competitors.listBySeries(seriesId);
  const [a, b] = input.competitorIds.map((id) => {
    const c = competitors.find((x) => x.id === id);
    if (!c) throw new NotFoundError('competitor');
    return { ...c, roundFleetId: round.fleetIds.find((fid) => c.fleetIds.includes(fid)) ?? null };
  });
  if (!a.roundFleetId || !b.roundFleetId || a.roundFleetId === b.roundFleetId) {
    throw new BadRequestError('a swap takes two entries in different fleets of the round');
  }
  const [aFleet, bFleet] = [a.roundFleetId, b.roundFleetId];
  const aBoat = a.fleetSailNumbers?.[aFleet] ?? null;
  const bBoat = b.fleetSailNumbers?.[bFleet] ?? null;

  const fleetName = await roundFleetNames(round);
  await getDb().transaction(async (tx) => {
    const place = (competitorId: string, toFleetId: string, boat: string | null) =>
      placeInRound(tx, workspace.workspaceId, seriesId, {
        competitorId,
        roundFleetIds: round.fleetIds,
        toFleetId,
        boat,
        fleetName,
      });
    // A arrives with no boat, so B's boat is still hers; then B takes A's
    // boat, which A has left; then A takes B's, which B has left.
    await place(a.id, bFleet, null);
    await place(b.id, aFleet, aBoat);
    await place(a.id, bFleet, bBoat);
    const txRepos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    await txRepos.splitRounds.setOverrides(
      roundId,
      { ...(round.overrides ?? {}), [a.id]: bFleet, [b.id]: aFleet },
      { updatedBy: workspace.userId },
    );
    await txRepos.series.touch(seriesId, workspace.userId);
  });

  const warning = await qualifyingPlacementWarning(
    workspace,
    seriesId,
    round,
    [
      { competitorId: a.id, sailNumber: a.sailNumber, toFleetId: bFleet },
      { competitorId: b.id, sailNumber: b.sailNumber, toFleetId: aFleet },
    ],
    fleetName,
  );
  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary: `Swapped ${a.sailNumber} and ${b.sailNumber} between ${fleetName(aFleet)} and ${fleetName(bFleet)}`,
    sessionKey: 'split-fleets',
  });
  return { warning };
}

/**
 * A placement on a final or medal round once that stage has raced: any
 * completed race in the round's own stage. Stage identity lives on the
 * starts, so a race is the stage's when any of its starts is. A medal-stage
 * promotion after a medal race is at least as consequential as a final-stage
 * one after a final race, so both stages carry the warning, each keyed on its
 * own races.
 */
async function laterStageWarning(seriesId: string, stage: SplitRound['stage']): Promise<string | null> {
  const [sailed] = await getDb()
    .select({ id: schema.finishes.id })
    .from(schema.finishes)
    .innerJoin(schema.races, eq(schema.races.id, schema.finishes.raceId))
    .innerJoin(schema.raceStarts, eq(schema.raceStarts.raceId, schema.races.id))
    .where(and(eq(schema.races.seriesId, seriesId), eq(schema.raceStarts.stage, stage)))
    .limit(1);
  if (!sailed) return null;
  return stage === 'medal'
    ? 'A race of this stage has already been completed: the promoted ' +
        'boat has no score in it. Record how the protest committee ' +
        'directs her to be scored there — this move only changes the ' +
        'assignment.'
    : 'Final racing has started: the boat already has scores in her ' +
        'current fleet. Record how the protest committee directs those ' +
        'scores to be treated — this move only changes the assignment.';
}

/**
 * What placing entries on a qualifying round does to the races it has
 * already sailed. Membership decides which fleet scores her in every race of
 * the round, the sailed ones included, so once a sheet has rows a placement
 * rewrites them: a result on the sheet of a race her new fleet didn't sail
 * stops counting, and a sailed race of her new fleet that she isn't on scores
 * her DNC. Null while the round has sailed nothing.
 */
async function qualifyingPlacementWarning(
  workspace: WorkspaceContext,
  seriesId: string,
  round: SplitRound,
  placements: { competitorId: string; sailNumber: string; toFleetId: string }[],
  fleetName: (fleetId: string) => string,
): Promise<string | null> {
  const starts = (
    await getDb()
      .select({
        raceId: schema.raceStarts.raceId,
        fleetIds: schema.raceStarts.fleetIds,
        stageRaceNumber: schema.raceStarts.stageRaceNumber,
      })
      .from(schema.raceStarts)
      .innerJoin(schema.races, eq(schema.races.id, schema.raceStarts.raceId))
      .where(and(eq(schema.races.seriesId, seriesId), eq(schema.raceStarts.stage, 'qualifying')))
  ).filter((s) => s.fleetIds.some((fid) => round.fleetIds.includes(fid)));
  if (starts.length === 0) return null;
  const rows = await getDb()
    .select({ raceId: schema.finishes.raceId, competitorId: schema.finishes.competitorId })
    .from(schema.finishes)
    .where(
      and(
        inArray(schema.finishes.raceId, [...new Set(starts.map((s) => s.raceId))]),
        sql`(${schema.finishes.sortOrder} is not null or ${schema.finishes.resultCode} is not null)`,
      ),
    );
  const sailed = new Set(rows.map((r) => r.raceId));
  if (sailed.size === 0) return null;

  const series = await getSeriesRow(workspace, seriesId);
  const config = normalizeSplitFleetConfig((series.qfConfig ?? {}) as Partial<SplitFleetConfig>);
  const labels = (raceIds: Iterable<string>) =>
    [
      ...new Set(
        [...raceIds].flatMap((raceId) =>
          starts.filter((s) => s.raceId === raceId).map((s) => s.stageRaceNumber ?? 0),
        ),
      ),
    ]
      .sort((a, b) => a - b)
      .map((n) => stageRaceLabel(config, 'qualifying', n))
      .join(', ');
  const parts = [
    `Racing in this round has started, and the change applies to the ` +
      `${resolveVocabulary(config).stages.qualifying.raceNoun}s it has already sailed.`,
  ];
  for (const p of placements) {
    const hers = new Set(rows.filter((r) => r.competitorId === p.competitorId).map((r) => r.raceId));
    const sailedByNewFleet = new Set(
      starts.filter((s) => s.fleetIds.includes(p.toFleetId)).map((s) => s.raceId),
    );
    const stranded = [...hers].filter((raceId) => !sailedByNewFleet.has(raceId));
    const missing = [...sailedByNewFleet].filter((raceId) => sailed.has(raceId) && !hers.has(raceId));
    const to = fleetName(p.toFleetId);
    let sentence = `${p.sailNumber} is now scored in ${to}.`;
    if (stranded.length > 0) {
      sentence += ` Her result in ${labels(stranded)} is on another fleet's sheet and no longer counts.`;
    }
    if (missing.length > 0) {
      sentence += ` She is not on ${to}'s sheet in ${labels(missing)}, so scores DNC there until she is added.`;
    }
    parts.push(sentence);
  }
  return parts.join(' ');
}

/** A round's fleets by name, for refusals and the activity log. */
async function roundFleetNames(round: SplitRound): Promise<(fleetId: string) => string> {
  const rows = await getDb()
    .select({ id: schema.fleets.id, name: schema.fleets.name })
    .from(schema.fleets)
    .where(inArray(schema.fleets.id, round.fleetIds));
  const names = new Map(rows.map((r) => [r.id, r.name]));
  return (fleetId) => names.get(fleetId) ?? 'another fleet';
}

/** A boat drawn for a fleet is only meaningful where the championship
 *  supplies its boats and draws them. */
async function assertDrawsBoats(workspace: WorkspaceContext, seriesId: string): Promise<void> {
  const series = await getSeriesRow(workspace, seriesId);
  const config = normalizeSplitFleetConfig((series.qfConfig ?? {}) as Partial<SplitFleetConfig>);
  if (!config.boatAssignments) {
    throw new BadRequestError('this championship does not draw boats');
  }
}

interface Placement {
  sailNumber: string;
  /** The round's fleet she was in before, or null if she was in none. */
  fromFleetId: string | null;
}

/**
 * Put one entry in one fleet of a round, or (`toFleetId` null) in none of
 * them. She leaves the round's other fleets and her boat in each goes with
 * her: a boat left behind would come back, unchecked, if she were ever placed
 * there again. A `boat` names the boat drawn for her in the fleet she joins,
 * checked against the boats its other entries hold; null or blank clears it,
 * and with none given she keeps her boat where she stays and has none drawn
 * yet where she arrives.
 */
async function placeInRound(
  tx: Tx,
  workspaceId: string,
  seriesId: string,
  move: {
    competitorId: string;
    roundFleetIds: readonly string[];
    toFleetId: string | null;
    boat?: string | null;
    fleetName: (fleetId: string) => string;
  },
): Promise<Placement> {
  const { competitorId, roundFleetIds, toFleetId } = move;
  const [row] = await tx
    .select({
      sailNumber: schema.competitors.sailNumber,
      fleetIds: schema.competitors.fleetIds,
      fleetSailNumbers: schema.competitors.fleetSailNumbers,
    })
    .from(schema.competitors)
    .where(
      and(
        eq(schema.competitors.id, competitorId),
        eq(schema.competitors.seriesId, seriesId),
        eq(schema.competitors.workspaceId, workspaceId),
      ),
    );
  if (!row) throw new NotFoundError('competitor');

  const fromFleetId = roundFleetIds.find((fid) => row.fleetIds.includes(fid)) ?? null;
  const stays = toFleetId !== null && row.fleetIds.includes(toFleetId);
  const fleetIds = row.fleetIds.filter((fid) => fid === toFleetId || !roundFleetIds.includes(fid));
  if (toFleetId !== null && !stays) fleetIds.push(toFleetId);

  const boats = { ...(row.fleetSailNumbers ?? {}) };
  for (const fid of roundFleetIds) if (fid !== toFleetId) delete boats[fid];
  if (toFleetId !== null) {
    const boat = move.boat?.trim();
    if (boat) {
      const others = await tx
        .select({
          sailNumber: schema.competitors.sailNumber,
          fleetSailNumbers: schema.competitors.fleetSailNumbers,
        })
        .from(schema.competitors)
        .where(
          and(
            eq(schema.competitors.seriesId, seriesId),
            eq(schema.competitors.workspaceId, workspaceId),
            sql`${toFleetId}::uuid = any(${schema.competitors.fleetIds})`,
            sql`${schema.competitors.id} <> ${competitorId}::uuid`,
          ),
        );
      const holder = others.find(
        (o) => duplicateBoats([o.fleetSailNumbers?.[toFleetId], boat]).length > 0,
      );
      if (holder) {
        throw new BadRequestError(
          `${move.fleetName(toFleetId)}: boat ${boat} is already drawn for ${holder.sailNumber}`,
        );
      }
      boats[toFleetId] = boat;
    } else if (move.boat !== undefined || !stays) {
      delete boats[toFleetId];
    }
  }

  await tx
    .update(schema.competitors)
    .set({
      fleetIds,
      fleetSailNumbers: Object.keys(boats).length ? boats : null,
      version: sql`${schema.competitors.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.competitors.id, competitorId));
  return { sailNumber: row.sailNumber, fromFleetId };
}

/**
 * Write the boats drawn for one fleet onto its entries' `fleet_sail_numbers`:
 * a sail number sets her boat for the fleet, null clears it. Entries not in
 * `boats` are untouched.
 */
async function writeFleetBoats(
  tx: Tx,
  seriesId: string,
  workspaceId: string,
  fleetId: string,
  boats: Map<string, string | null>,
): Promise<void> {
  if (boats.size === 0) return;
  const rows = await tx
    .select({ id: schema.competitors.id, fleetSailNumbers: schema.competitors.fleetSailNumbers })
    .from(schema.competitors)
    .where(
      and(
        inArray(schema.competitors.id, [...boats.keys()]),
        eq(schema.competitors.seriesId, seriesId),
        eq(schema.competitors.workspaceId, workspaceId),
      ),
    );
  for (const row of rows) {
    const next = { ...(row.fleetSailNumbers ?? {}) };
    const boat = boats.get(row.id)?.trim();
    if (boat) next[fleetId] = boat;
    else delete next[fleetId];
    await tx
      .update(schema.competitors)
      .set({
        fleetSailNumbers: Object.keys(next).length ? next : null,
        version: sql`${schema.competitors.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.competitors.id, row.id));
  }
}

/** Sail numbers, as a scorer reads them in a refusal. */
function boatList(competitors: readonly Pick<Competitor, 'sailNumber'>[]): string {
  return competitors.map((c) => c.sailNumber).join(', ');
}

/**
 * Refuse a repêchage the championship cannot have: no medal stage, no medal
 * fleet selected yet (the direct seats decide who is eligible), a repêchage
 * already, or a boat who could not fairly join the medal fleet.
 */
async function assertRepechageCommittable(
  tx: Tx,
  workspace: WorkspaceContext,
  seriesId: string,
  config: SplitFleetConfig,
  competitorIds: string[],
): Promise<void> {
  if (!config.medal) throw new BadRequestError('this championship has no medal stage');
  const repos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
  const [rounds, competitors] = await Promise.all([
    repos.splitRounds.listBySeries(seriesId),
    repos.competitors.listBySeries(seriesId),
  ]);
  if (!rounds.some((r) => r.stage === 'medal')) {
    throw new BadRequestError('select the medal fleet before the repêchage');
  }
  if (rounds.some((r) => r.stage === 'repechage')) {
    throw new BadRequestError('this championship already has a repêchage');
  }
  if (competitorIds.length === 0) throw new BadRequestError('a repêchage needs boats');
  assertEligible({ config, rounds, competitors }, competitorIds);
}

/** Refuse any of `competitorIds` who may not sail the repêchage or be
 *  promoted into the medal fleet (see `repechageEligibleIds`), naming them. */
function assertEligible(
  data: { config: SplitFleetConfig; rounds: SplitRound[]; competitors: Competitor[] },
  competitorIds: string[],
): void {
  const eligible = repechageEligibleIds(data);
  const refused = data.competitors.filter((c) => competitorIds.includes(c.id) && !eligible.has(c.id));
  const unknown = competitorIds.filter((id) => !data.competitors.some((c) => c.id === id));
  if (unknown.length > 0) throw new BadRequestError('competitor not in this series');
  if (refused.length > 0) {
    throw new BadRequestError(
      data.config.medal?.carry === 'nothing'
        ? `${boatList(refused)} ${refused.length === 1 ? 'is' : 'are'} already in the medal fleet`
        : `${boatList(refused)} cannot join the medal fleet: the medal races carry a score, so only boats of the fleet it is selected from can`,
    );
  }
}

/**
 * Change who sails the repêchage: add a boat to one of its fleets, move her
 * between them, or (`toFleetId` null) take her out. The membership is the
 * scorer's own choice, so nothing is recorded as an override. Settled once a
 * boat has been promoted from it.
 */
async function editRepechageMembership(
  workspace: WorkspaceContext,
  seriesId: string,
  round: SplitRound,
  competitorId: string,
  toFleetId: string | null,
  boat?: string | null,
): Promise<void> {
  if (toFleetId !== null && !round.fleetIds.includes(toFleetId)) {
    throw new BadRequestError('target fleet is not part of this round');
  }
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [rounds, competitors, series] = await Promise.all([
    repos.splitRounds.listBySeries(seriesId),
    repos.competitors.listBySeries(seriesId),
    getSeriesRow(workspace, seriesId),
  ]);
  if (rounds.some((r) => r.stage === 'medal' && Object.values(r.overrideReasons ?? {}).includes('repechage'))) {
    throw new BadRequestError('a boat has been promoted from the repêchage');
  }
  const competitor = competitors.find((c) => c.id === competitorId);
  if (!competitor) throw new NotFoundError('competitor');
  const config = normalizeSplitFleetConfig((series.qfConfig ?? {}) as Partial<SplitFleetConfig>);
  if (boat?.trim() && !config.boatAssignments) {
    throw new BadRequestError('this championship does not draw boats');
  }
  const joining = !round.fleetIds.some((fid) => competitor.fleetIds.includes(fid));
  if (toFleetId !== null && joining) {
    assertEligible({ config, rounds, competitors }, [competitorId]);
  }
  const fleetName = await roundFleetNames(round);
  await getDb().transaction(async (tx) => {
    await placeInRound(tx, workspace.workspaceId, seriesId, {
      competitorId,
      roundFleetIds: round.fleetIds,
      toFleetId,
      boat,
      fleetName,
    });
    await createRepos({ db: tx, workspaceId: workspace.workspaceId }).series.touch(seriesId, workspace.userId);
  });
  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary:
      toFleetId === null
        ? `Took ${competitor.sailNumber} out of the repêchage`
        : joining
          ? `Added ${competitor.sailNumber} to the repêchage`
          : `Moved ${competitor.sailNumber} to another repêchage fleet`,
    sessionKey: 'split-fleets',
  });
}

/** The warnings a change to the medal fleet's membership earns once racing
 *  has moved on: a medal race already sailed (the boat has no score in it),
 *  or a companion race already added (its first place scores from the medal
 *  fleet's size plus one, and its boats are those outside the fleet). */
async function medalChangeWarning(seriesId: string): Promise<string | null> {
  const starts = await getDb()
    .select({
      stage: schema.raceStarts.stage,
      firstPlaceOffset: schema.raceStarts.firstPlaceOffset,
      raceId: schema.raceStarts.raceId,
    })
    .from(schema.raceStarts)
    .innerJoin(schema.races, eq(schema.races.id, schema.raceStarts.raceId))
    .where(eq(schema.races.seriesId, seriesId));
  const medalRaceIds = starts.filter((s) => s.stage === 'medal').map((s) => s.raceId);
  const [sailed] = medalRaceIds.length
    ? await getDb()
        .select({ id: schema.finishes.id })
        .from(schema.finishes)
        .where(inArray(schema.finishes.raceId, medalRaceIds))
        .limit(1)
    : [];
  if (sailed) {
    return (
      'A medal race has already been completed: the promoted boat has no score in it. ' +
      'Record how the protest committee directs her to be scored there — this move only changes the assignment.'
    );
  }
  if (starts.some((s) => s.stage !== 'medal' && (s.firstPlaceOffset ?? 0) > 0)) {
    return (
      'A companion race has already been added: it is scored from the medal fleet\u2019s size plus one, ' +
      'and a promoted boat leaves it. Check its first-place score against the sailing instructions.'
    );
  }
  return null;
}

/**
 * Promote boats into the medal fleet after it was selected: from the
 * repêchage ranking, or from the ranking they were cut from (the fallback
 * where the repêchage is not sailed). Each boat must be eligible — outside
 * the medal fleet, and from the fleet it is selected from where the medal
 * races carry a score — and one promoted from the repêchage must have sailed
 * it. The seats are attributed on the medal round with their reason.
 */
export async function promoteIntoMedalFleet(
  workspace: WorkspaceContext,
  seriesId: string,
  body: unknown,
): Promise<{ warning: string | null }> {
  await assertSeriesWritable(workspace, seriesId);
  const input = splitPromotionSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const [series, rounds, competitors] = await Promise.all([
    getSeriesRow(workspace, seriesId),
    repos.splitRounds.listBySeries(seriesId),
    repos.competitors.listBySeries(seriesId),
  ]);
  const config = normalizeSplitFleetConfig((series.qfConfig ?? {}) as Partial<SplitFleetConfig>);
  const medalRound = rounds.find((r) => r.stage === 'medal');
  if (!medalRound) throw new BadRequestError('select the medal fleet first');
  const medalFleetId = medalRound.fleetIds[0];
  assertEligible({ config, rounds, competitors }, input.competitorIds);
  if (input.reason === 'repechage') {
    const repRound = rounds.find((r) => r.stage === 'repechage');
    if (!repRound) throw new BadRequestError('this championship has no repêchage');
    const outside = competitors.filter(
      (c) => input.competitorIds.includes(c.id) && !repRound.fleetIds.some((fid) => c.fleetIds.includes(fid)),
    );
    if (outside.length > 0) {
      throw new BadRequestError(`${boatList(outside)} did not sail the repêchage`);
    }
  }
  const warning = await medalChangeWarning(seriesId);

  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.competitors)
      .set({
        fleetIds: sql`array_append(${schema.competitors.fleetIds}, ${medalFleetId}::uuid)`,
        version: sql`${schema.competitors.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          inArray(schema.competitors.id, input.competitorIds),
          eq(schema.competitors.seriesId, seriesId),
          eq(schema.competitors.workspaceId, workspace.workspaceId),
        ),
      );
    const promoted = Object.fromEntries(input.competitorIds.map((id) => [id, medalFleetId]));
    const reasons = Object.fromEntries(input.competitorIds.map((id) => [id, input.reason]));
    const txRepos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    await txRepos.splitRounds.setOverrides(
      medalRound.id,
      { ...(medalRound.overrides ?? {}), ...promoted },
      { updatedBy: workspace.userId, reasons: { ...(medalRound.overrideReasons ?? {}), ...reasons } },
    );
    await txRepos.series.touch(seriesId, workspace.userId);
  });
  const sails = boatList(competitors.filter((c) => input.competitorIds.includes(c.id)));
  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary:
      input.reason === 'repechage'
        ? `Promoted ${sails} from the repêchage`
        : `Promoted ${sails} from the ranking they were cut from`,
    sessionKey: 'split-fleets',
  });
  return { warning };
}

/**
 * Take back a promotion into the medal fleet — a boat promoted by mistake, or
 * a decision reversed. Only a boat placed by hand: the boats the selection
 * dealt in are taken out by deleting the medal fleet.
 */
export async function withdrawPromotion(
  workspace: WorkspaceContext,
  seriesId: string,
  competitorId: string,
): Promise<{ warning: string | null }> {
  await assertSeriesWritable(workspace, seriesId);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const rounds = await repos.splitRounds.listBySeries(seriesId);
  const medalRound = rounds.find((r) => r.stage === 'medal');
  if (!medalRound?.overrides?.[competitorId]) {
    throw new BadRequestError('this boat was not promoted into the medal fleet');
  }
  const medalFleetId = medalRound.fleetIds[0];
  const warning = await medalChangeWarning(seriesId);
  const { [competitorId]: _gone, ...overrides } = medalRound.overrides;
  const { [competitorId]: _reason, ...reasons } = medalRound.overrideReasons ?? {};
  await getDb().transaction(async (tx) => {
    await tx
      .update(schema.competitors)
      .set({
        fleetIds: sql`array_remove(${schema.competitors.fleetIds}, ${medalFleetId}::uuid)`,
        version: sql`${schema.competitors.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(schema.competitors.id, competitorId),
          eq(schema.competitors.seriesId, seriesId),
          eq(schema.competitors.workspaceId, workspace.workspaceId),
        ),
      );
    const txRepos = createRepos({ db: tx, workspaceId: workspace.workspaceId });
    await txRepos.splitRounds.setOverrides(medalRound.id, overrides, {
      updatedBy: workspace.userId,
      reasons: reasons as Record<string, OverrideReason>,
    });
    await txRepos.series.touch(seriesId, workspace.userId);
  });
  const [competitor] = (await repos.competitors.listBySeries(seriesId)).filter((c) => c.id === competitorId);
  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary: `Withdrew ${competitor?.sailNumber ?? 'a boat'}\u2019s promotion into the medal fleet`,
    sessionKey: 'split-fleets',
  });
  return { warning };
}


/**
 * Set the boats drawn for one fleet of a round — the draw arriving after the
 * assignment was committed, a typo, or a spare replacing a broken boat. Only
 * the fleet's own entries can be given a boat in it, and no boat may end up
 * held by two of them.
 */
export async function setSplitFleetBoats(
  workspace: WorkspaceContext,
  seriesId: string,
  roundId: string,
  body: unknown,
): Promise<{ ok: true }> {
  await assertSeriesWritable(workspace, seriesId);
  const input = splitFleetBoatsSchema.parse(body);
  const repos = createRepos({ workspaceId: workspace.workspaceId });
  const round = await repos.splitRounds.get(roundId);
  if (!round || round.seriesId !== seriesId) throw new NotFoundError('round');
  if (!round.fleetIds.includes(input.fleetId)) {
    throw new BadRequestError('fleet is not part of this round');
  }
  const [fleet] = await getDb()
    .select({ name: schema.fleets.name })
    .from(schema.fleets)
    .where(eq(schema.fleets.id, input.fleetId));

  await getDb().transaction(async (tx) => {
    const members = await tx
      .select({ id: schema.competitors.id, fleetSailNumbers: schema.competitors.fleetSailNumbers })
      .from(schema.competitors)
      .where(
        and(
          eq(schema.competitors.seriesId, seriesId),
          eq(schema.competitors.workspaceId, workspace.workspaceId),
          sql`${input.fleetId}::uuid = any(${schema.competitors.fleetIds})`,
        ),
      );
    const memberIds = new Set(members.map((m) => m.id));
    const outsiders = Object.keys(input.boats).filter((cid) => !memberIds.has(cid));
    if (outsiders.length > 0) {
      throw new BadRequestError(`${outsiders.length} of those entries are not in this fleet`);
    }
    const after = members.map((m) =>
      m.id in input.boats ? input.boats[m.id] : (m.fleetSailNumbers?.[input.fleetId] ?? null),
    );
    const dup = duplicateBoats(after);
    if (dup.length > 0) {
      throw new BadRequestError(`boat ${dup.join(', ')} is drawn for more than one entry`);
    }
    await writeFleetBoats(
      tx,
      seriesId,
      workspace.workspaceId,
      input.fleetId,
      new Map(Object.entries(input.boats)),
    );
    await createRepos({ db: tx, workspaceId: workspace.workspaceId }).series.touch(
      seriesId,
      workspace.userId,
    );
  });

  await trackChange(workspace, {
    action: 'split-fleets.round-committed',
    seriesId,
    summary: `Boats drawn for ${fleet?.name ?? 'a fleet'}`,
    sessionKey: 'split-fleets',
  });
  return { ok: true };
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
    await repos.series.touch(seriesId, workspace.userId);
  });

  await trackChange(workspace, {
    action: raceDeleted ? 'race.deleted' : 'race.updated',
    seriesId,
    summary: `Abandoned ${fleetRow?.name ?? 'fleet'}'s race${race.name ? ` (${race.name})` : ''}`,
    sessionKey: 'split-fleets',
  });
}
