/**
 * Admin script: survey every stored split-fleet configuration against the
 * rebuilt model (docs/design/split-fleets/configuration.md), classifying each
 * value the rebuild removes the way ADR-013 does.
 *
 * Three places hold a configuration the rebuild has to account for:
 *   - live series (`series.qf_config`), plus whether each has split rounds;
 *   - revision snapshots of those series, which a restore replays;
 *   - Trash tombstones, which a restore brings back whole.
 *
 * Each finding is one of:
 *   scoring         would score differently under the rebuilt model; the
 *                   upgrader refuses it
 *   conditional     scoring-class, but immaterial once a medal race has been
 *                   completed; the upgrader checks
 *   presentational  labels or wording change on upgrade; results don't
 * Values that upgrade losslessly are not reported.
 *
 * Usage:
 *   pnpm split-fleet-survey:test                  # local container
 *   pnpm split-fleet-survey:prod                  # production (operator)
 *   pnpm split-fleet-survey:prod --no-revisions   # skip the snapshot scan
 *
 * Read-only — no writes.
 */

import { gunzipSync, zstdDecompressSync } from 'node:zlib';

import { eq, inArray, isNotNull, sql } from 'drizzle-orm';

import { getDb, getDbClient } from '@/lib/db/client';
import { organization } from '@/lib/db/schema/auth';
import { deletedSeries, series, seriesRevision, splitRounds } from '@/lib/db/schema/series';

export type FindingClass = 'scoring' | 'conditional' | 'presentational';

export interface Finding {
  cls: FindingClass;
  setting: string;
  value: string;
}

type Raw = Record<string, unknown>;

const obj = (v: unknown): Raw | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : undefined;

const show = (v: unknown): string => (v === undefined ? '(absent)' : JSON.stringify(v));

/** The fixed race-label table: prefixes for stages 1, 2 and medal. */
function targetPrefixes(vocabulary: string, divided: boolean): [string, string, string] {
  if (vocabulary === 'qualification-final') return divided ? ['QP', 'QE', 'F'] : ['Q', 'Q', 'F'];
  return divided ? ['Q', 'F', 'M'] : ['Q', 'F', 'M'];
}

/**
 * Classify one stored configuration, as it was stored — before any
 * read-time normalisation, since what the normaliser fills in is part of
 * what the rebuild changes.
 */
export function classifySplitFleetConfig(raw: unknown): Finding[] {
  const c = obj(raw);
  if (!c) return [{ cls: 'scoring', setting: 'config', value: 'not an object' }];
  const out: Finding[] = [];
  const add = (cls: FindingClass, setting: string, value: unknown) =>
    out.push({ cls, setting, value: show(value) });

  const split = obj(c.split);
  const divided = split?.kind !== 'none';
  const vocabulary = typeof c.vocabulary === 'string' ? c.vocabulary : 'opening-medal';

  if (c.carry !== undefined && c.carry !== 'points') add('scoring', 'carry', c.carry);
  if (split?.kind === 'fixed-top') add('scoring', 'split', split);

  const codeBasis = obj(c.codeBasis);
  if (codeBasis?.qualifying !== undefined && codeBasis.qualifying !== 'largest-fleet') {
    add('scoring', 'codeBasis.qualifying', codeBasis.qualifying);
  }
  if (divided && codeBasis?.final !== undefined && codeBasis.final !== 'own-fleet') {
    add('scoring', 'codeBasis.final', codeBasis.final);
  }
  if (c.equalization !== undefined && c.equalization !== 'abandon-extra-races') {
    add('scoring', 'equalization', c.equalization);
  }
  if (c.reassignmentTieOrder !== undefined && c.reassignmentTieOrder !== 'a8-then-entry-order') {
    add('scoring', 'reassignmentTieOrder', c.reassignmentTieOrder);
  }
  if (divided && c.maxFinalDiscards !== undefined && c.maxFinalDiscards !== 1) {
    add('scoring', 'maxFinalDiscards', c.maxFinalDiscards);
  }
  if (divided && c.protectLoneFinalRace !== undefined && c.protectLoneFinalRace !== true) {
    add('scoring', 'protectLoneFinalRace', c.protectLoneFinalRace);
  }

  const medal = obj(c.medal);
  if (!medal) {
    add('presentational', 'medal', undefined);
  } else {
    if (medal.multiplier !== 1 && medal.multiplier !== 2) {
      add('scoring', 'medal.multiplier', medal.multiplier);
    }
    if (medal.tieBreak !== 'medal-race-then-a8' && medal.tieBreak !== 'last-race') {
      add('scoring', 'medal.tieBreak', medal.tieBreak);
    }
    // Absent reads as scored-below (the normaliser's default).
    const companion = medal.companionRace ?? 'scored-below';
    if (divided && companion !== 'scored-below') add('scoring', 'medal.companionRace', companion);
    if (!divided && companion === 'dnc') add('scoring', 'medal.companionRace', companion);

    const carry = obj(medal.carryTransform);
    if (carry) {
      if (carry.kind !== 'divide' || carry.by !== 2 || carry.rounding !== 'half-up') {
        add('scoring', 'medal.carryTransform', { kind: carry.kind, by: carry.by, rounding: carry.rounding });
      }
      // Absent reads as medal-fleet-selected (the normaliser's default).
      const appliesFrom = carry.appliesFrom ?? 'medal-fleet-selected';
      if (appliesFrom !== 'first-medal-race') {
        add('conditional', 'medal.carryTransform.appliesFrom', appliesFrom);
      }
    }
  }

  const [p1, p2, pm] = targetPrefixes(vocabulary, divided);
  const labels = obj(c.raceLabels);
  const prefixes = obj(labels?.prefixes);
  const stored: [unknown, unknown, unknown] = prefixes
    ? [prefixes.qualifying, prefixes.final, prefixes.medal]
    : vocabulary === 'qualification-final'
      ? ['Q', 'Q', 'F']
      : ['Q', 'F', 'M'];
  const continuous = labels ? labels.continuousOpeningNumbers === true : vocabulary === 'qualification-final';
  const differs =
    stored[0] !== p1 || stored[2] !== pm || (divided && (stored[1] !== p2 || continuous));
  if (differs) {
    add('presentational', 'raceLabels', labels ?? `${vocabulary} default: ${stored.join('/')}${continuous ? ' continuous' : ''}`);
  }
  if (c.vocabularyOverride !== undefined) add('presentational', 'vocabularyOverride', 'present');
  if (c.stageNaming !== undefined) add('presentational', 'stageNaming', 'present');

  return out;
}

function unpack(blob: Buffer | null, legacy: unknown): Raw | null {
  if (blob && blob.length >= 4) {
    const isZstd = blob[0] === 0x28 && blob[1] === 0xb5 && blob[2] === 0x2f && blob[3] === 0xfd;
    const raw = isZstd ? zstdDecompressSync(blob) : gunzipSync(blob);
    return JSON.parse(raw.toString('utf-8')) as Raw;
  }
  return obj(legacy) ?? null;
}

const configOf = (file: Raw | null): unknown => obj(obj(file?.splitFleets)?.config) ?? null;

const describe = (fs: Finding[]): string =>
  fs.length === 0 ? '      (no findings)' : fs.map((f) => `      ${f.cls.padEnd(14)} ${f.setting} = ${f.value}`).join('\n');

function tally(configs: unknown[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const cfg of configs) {
    for (const f of classifySplitFleetConfig(cfg)) {
      const key = `${f.cls.padEnd(14)} ${f.setting} = ${f.value}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return counts;
}

async function runCli(argv: string[]): Promise<number> {
  const scanRevisions = !argv.includes('--no-revisions');
  const db = getDb();

  const roundCounts = await db
    .select({ seriesId: splitRounds.seriesId, n: sql<number>`count(*)::int` })
    .from(splitRounds)
    .groupBy(splitRounds.seriesId);
  const rounds = new Map(roundCounts.map((r) => [r.seriesId, r.n]));

  const live = await db
    .select({
      id: series.id,
      name: series.name,
      workspace: organization.slug,
      resultsStatus: series.resultsStatus,
      config: series.qfConfig,
    })
    .from(series)
    .innerJoin(organization, eq(organization.id, series.workspaceId))
    .where(isNotNull(series.qfConfig))
    .orderBy(organization.slug, series.name);

  const liveIds = new Set(live.map((s) => s.id));
  const orphanRoundSeries = [...rounds.keys()].filter((id) => !liveIds.has(id));

  console.log(`Live series with a split-fleet config: ${live.length}\n`);
  for (const s of live) {
    console.log(`  ${s.workspace} / ${s.name}`);
    console.log(`    ${s.id} · ${s.resultsStatus} · ${rounds.get(s.id) ?? 0} rounds`);
    console.log(describe(classifySplitFleetConfig(s.config)));
  }
  if (orphanRoundSeries.length > 0) {
    console.log(`\nSeries with split rounds but no config: ${orphanRoundSeries.join(', ')}`);
  }

  if (scanRevisions) {
    const ids = [...new Set([...liveIds, ...orphanRoundSeries])];
    console.log(`\nRevision snapshots of those series:`);
    for (const id of ids) {
      const revs = await db
        .select({ snapshot: seriesRevision.snapshot, snapshotGz: seriesRevision.snapshotGz })
        .from(seriesRevision)
        .where(inArray(seriesRevision.seriesId, [id]));
      const configs = revs.map((r) => configOf(unpack(r.snapshotGz, r.snapshot))).filter((c) => c !== null);
      const name = live.find((s) => s.id === id)?.name ?? id;
      console.log(`  ${name}: ${revs.length} revisions, ${configs.length} with a config`);
      for (const [finding, n] of tally(configs)) console.log(`      ${finding}  ×${n}`);
    }
  }

  const tombstones = await db
    .select({
      name: deletedSeries.name,
      workspace: organization.slug,
      deletedAt: deletedSeries.deletedAt,
      snapshotGz: deletedSeries.snapshotGz,
    })
    .from(deletedSeries)
    .innerJoin(organization, eq(organization.id, deletedSeries.workspaceId));
  const splitTombstones = tombstones
    .map((t) => ({ ...t, config: configOf(unpack(t.snapshotGz, null)) }))
    .filter((t) => t.config !== null);
  console.log(`\nTrash: ${tombstones.length} tombstones, ${splitTombstones.length} split-fleet`);
  for (const t of splitTombstones) {
    console.log(`  ${t.workspace} / ${t.name} · deleted ${t.deletedAt.toISOString().slice(0, 10)}`);
    console.log(describe(classifySplitFleetConfig(t.config)));
  }
  return 0;
}

const isMain = require.main === module;
if (isMain) {
  void (async () => {
    const code = await runCli(process.argv.slice(2));
    await getDbClient().end();
    process.exit(code);
  })();
}
