/**
 * `pnpm archive-generate <config.json> [--out <dir>]` — build archive ingest
 * documents from an archive repo's captures (ADR-010, #283).
 *
 * The config lives in the archive repo and is the whole per-class knowledge:
 * which capture files compose which series, under which pinned ids, slugs,
 * and sub-paths. This runner is deliberately generic — IODAI, DBSC, HYC, and
 * future class archives all drive the same code with different configs.
 *
 * Output: `<out>/series/<key>.json` per series (the CLI's
 * `as-published push` input), plus `<out>/identities.json` when the config
 * names an identity manifest. Regeneration is deterministic; the ingest's
 * content hashes make unchanged documents no-ops server-side.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { z } from 'zod';

import { stableStringify, type ArchiveSeriesDoc } from '@/lib/archive-kit/format';
import { buildHalsailArchiveDoc } from '@/lib/archive-kit/halsail-doc';
import { parseHalsailHtml } from '@/lib/archive-kit/halsail-html';
import { buildSailwaveArchiveDoc } from '@/lib/archive-kit/sailwave-doc';
import { parseSailwaveHtml } from '@/lib/archive-kit/sailwave-html';

const fleetSchema = z.object({
  name: z.string().min(1),
  subPath: z.string().min(1),
  /** Capture file, relative to the config's directory. */
  file: z.string().min(1),
  /** Sailwave only: which summary section of the file (matched against the
   *  section heading); default = the file's only/first section. */
  sectionTitle: z.string().optional(),
  /** Sailwave only: carry the file's per-race detail tables too. */
  includeRaces: z.boolean().optional(),
});

const seriesSchema = z.object({
  /** Stable output key — the generated filename and the operator's handle. */
  key: z.string().min(1),
  id: z.string().uuid(),
  publishedSlug: z.string().min(1),
  name: z.string().min(1),
  venue: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  eventUrl: z.string().optional(),
  venueUrl: z.string().optional(),
  venueLogoUrl: z.string().optional(),
  eventLogoUrl: z.string().optional(),
  source: z.enum(['sailwave', 'halsail']),
  fleets: z.array(fleetSchema).min(1),
});

const configSchema = z.object({
  version: z.literal(1),
  /** Output directory, relative to the config file. */
  out: z.string().default('as-published'),
  /** Identity manifest (the #218 format) to copy alongside, relative to the
   *  config file. */
  identities: z.string().optional(),
  series: z.array(seriesSchema).min(1),
});

function buildSeries(
  baseDir: string,
  entry: z.infer<typeof seriesSchema>,
): ArchiveSeriesDoc {
  const meta = {
    seriesId: entry.id,
    name: entry.name,
    venue: entry.venue,
    startDate: entry.startDate,
    endDate: entry.endDate,
    eventUrl: entry.eventUrl,
    venueUrl: entry.venueUrl,
    venueLogoUrl: entry.venueLogoUrl,
    eventLogoUrl: entry.eventLogoUrl,
    publishedSlug: entry.publishedSlug,
  };
  if (entry.source === 'halsail') {
    return buildHalsailArchiveDoc({
      ...meta,
      fleets: entry.fleets.map((fleet) => ({
        name: fleet.name,
        subPath: fleet.subPath,
        page: parseHalsailHtml(readFileSync(join(baseDir, fleet.file), 'utf8')),
      })),
    });
  }
  return buildSailwaveArchiveDoc({
    ...meta,
    fleets: entry.fleets.map((fleet) => {
      const page = parseSailwaveHtml(
        readFileSync(join(baseDir, fleet.file), 'utf8'),
      );
      const summary = fleet.sectionTitle
        ? page.summaries.find((s) => s.title === fleet.sectionTitle)
        : page.summaries[0];
      if (!summary) {
        throw new Error(
          `${entry.key}: no summary section${fleet.sectionTitle ? ` titled "${fleet.sectionTitle}"` : ''} in ${fleet.file}`,
        );
      }
      return {
        name: fleet.name,
        subPath: fleet.subPath,
        summary,
        ...(fleet.includeRaces ? { races: page.races } : {}),
      };
    }),
  });
}

function run(argv: string[]): number {
  const positional = argv.filter((a) => !a.startsWith('--'));
  const outFlagIdx = argv.indexOf('--out');
  const configPath = positional[0];
  if (!configPath) {
    console.error('usage: pnpm archive-generate <config.json> [--out <dir>]');
    return 1;
  }
  const abs = resolve(configPath);
  const baseDir = dirname(abs);
  const config = configSchema.parse(JSON.parse(readFileSync(abs, 'utf8')));
  const outDir = resolve(
    outFlagIdx !== -1 && argv[outFlagIdx + 1]
      ? argv[outFlagIdx + 1]
      : join(baseDir, config.out),
  );
  mkdirSync(join(outDir, 'series'), { recursive: true });

  let built = 0;
  let failed = 0;
  let competitors = 0;
  for (const entry of config.series) {
    try {
      const doc = buildSeries(baseDir, entry);
      writeFileSync(
        join(outDir, 'series', `${entry.key}.json`),
        `${stableStringify(doc)}\n`,
      );
      built++;
      competitors += doc.competitors.length;
    } catch (err) {
      failed++;
      console.error(
        `  ✗ ${entry.key}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (config.identities) {
    const manifest = readFileSync(join(baseDir, config.identities), 'utf8');
    writeFileSync(join(outDir, 'identities.json'), manifest);
    console.log(`identities: copied ${config.identities}`);
  }

  console.log(
    `${built} series documents built (${competitors} competitor rows), ${failed} failed → ${outDir}`,
  );
  return failed > 0 ? 1 : 0;
}

process.exit(run(process.argv.slice(2)));
