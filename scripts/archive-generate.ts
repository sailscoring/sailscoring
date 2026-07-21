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
import { parseSail100Html } from '@/lib/archive-kit/sail100-html';
import { buildSailwaveArchiveDoc } from '@/lib/archive-kit/sailwave-doc';
import { parseSailwaveHtml } from '@/lib/archive-kit/sailwave-html';

/** One section of a combined page: a summary of the file, matched by its
 *  heading, published as its own member fleet. */
const sectionSchema = z.object({
  /** Which summary section of the file (matched against the section heading). */
  sectionTitle: z.string().min(1),
  /** Carry this section's per-race detail tables (races whose title names
   *  this section). */
  includeRaces: z.boolean().optional(),
});

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
  /** Sailwave only: when the file publishes several summary sections on one
   *  page (e.g. a class scored HPH and Scratch), list them here to publish a
   *  single combined page (ADR-010, #321) whose sections are these summaries,
   *  each a member fleet. Takes precedence over `sectionTitle`/`includeRaces`. */
  sections: z.array(sectionSchema).min(1).optional(),
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
  /** Initial category filing on first ingest (e.g. the season year). */
  category: z.string().optional(),
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
    category: entry.category,
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
  let sawSail100 = false;
  const parse = (fleet: z.infer<typeof fleetSchema>) => {
    const html = readFileSync(join(baseDir, fleet.file), 'utf8');
    let page = parseSailwaveHtml(html);
    if (page.summaries.length === 0) {
      // Several IODAI events (2009–2013, some Ulsters) were published by
      // Sail100 rather than Sailwave — same archive, different markup.
      const sail100 = parseSail100Html(html);
      if (sail100.summaries.length > 0) {
        sawSail100 = true;
        page = { ...page, summaries: sail100.summaries };
      }
    }
    return page;
  };
  const summaryOf = (page: ReturnType<typeof parse>, title: string | undefined, file: string) => {
    const summary = title
      ? page.summaries.find((s) => s.title === title)
      : page.summaries[0];
    if (!summary) {
      throw new Error(
        `${entry.key}: no summary section${title ? ` titled "${title}"` : ''} in ${file}`,
      );
    }
    return summary;
  };

  const fleets: Array<{
    name: string;
    subPath?: string;
    summary: ReturnType<typeof parse>['summaries'][number];
    races?: ReturnType<typeof parse>['races'];
  }> = [];
  const combinedPages: Array<{ subPath: string; name: string; fleetNames: string[] }> = [];

  // Fleet names must be unique within a series (they mint the fleet ids and
  // key the competitor rows). Standalone class names already are; but two
  // combined pages can legitimately reuse a section heading — Lambay's
  // Saturday and Sunday class pages both publish a "Class 0 IRC Fleet". Reserve
  // the standalone names first, then qualify any clashing section with its page
  // name so member names stay unique and stable.
  const usedNames = new Set(
    entry.fleets.filter((f) => !f.sections).map((f) => f.name),
  );
  const uniqueName = (base: string, pageName: string): string => {
    if (!usedNames.has(base)) {
      usedNames.add(base);
      return base;
    }
    let name = `${base} (${pageName})`;
    for (let n = 2; usedNames.has(name); n++) name = `${base} (${pageName} ${n})`;
    usedNames.add(name);
    return name;
  };

  for (const fleet of entry.fleets) {
    const page = parse(fleet);
    if (fleet.sections) {
      // Combined page: each listed section becomes a member fleet named by its
      // source heading; races are partitioned to the section whose title they
      // name (longest match wins, so "Class 0" never steals "Class 0 IRC").
      const titles = fleet.sections.map((s) => s.sectionTitle);
      const memberNames: string[] = [];
      for (const section of fleet.sections) {
        const races = section.includeRaces
          ? page.races.filter(
              (race) => bestSectionFor(race.title, titles) === section.sectionTitle,
            )
          : undefined;
        const memberName = uniqueName(section.sectionTitle, fleet.name);
        memberNames.push(memberName);
        fleets.push({
          name: memberName,
          summary: summaryOf(page, section.sectionTitle, fleet.file),
          ...(races ? { races } : {}),
        });
      }
      combinedPages.push({
        subPath: fleet.subPath,
        name: fleet.name,
        fleetNames: memberNames,
      });
      continue;
    }
    fleets.push({
      name: fleet.name,
      subPath: fleet.subPath,
      summary: summaryOf(page, fleet.sectionTitle, fleet.file),
      ...(fleet.includeRaces ? { races: page.races } : {}),
    });
  }

  return buildSailwaveArchiveDoc({
    ...meta,
    ...(sawSail100 ? { source: 'sail100' as const } : {}),
    fleets,
    ...(combinedPages.length > 0 ? { combinedPages } : {}),
  });
}

/** The section whose title a race names, preferring the longest match so a
 *  shorter title that is a prefix of another never claims its races. Returns
 *  null when the race names no listed section. */
function bestSectionFor(raceTitle: string, titles: string[]): string | null {
  let best: string | null = null;
  for (const title of titles) {
    if (raceTitle.includes(title) && (best === null || title.length > best.length)) {
      best = title;
    }
  }
  return best;
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
