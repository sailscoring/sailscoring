import 'server-only';

import type { WorkspaceContext } from '@/lib/auth/require-workspace';
import { recordActivity } from '@/lib/activity-log';
import {
  absolutizeRootRelativeUrls,
  configuredFtpPaths,
  ftpFilePath,
  ftpLinkHref,
  resolveFtpServerId,
} from '@/lib/ftp-publish';
import { createRepos } from '@/lib/postgres-repository';
import {
  CHAMPIONSHIP_PAGE,
  FLEET_ASSIGNMENTS_PAGE,
  RACE_RESULTS_PAGE,
  SCORING_NOTES_PAGE,
  resolvePublishPages,
} from '@/lib/publish-pages';
import type { FleetHtmlFile } from '@/lib/results-export';
import { uploadViaScupper, uploadWithRetry, type FtpUploader } from '@/lib/scupper';
import type { FtpPageOutcome, FtpPublishOutcome, Series } from '@/lib/types';

/** The pages a championship publishes, every one of which carries links to
 *  the others baked in at build time. */
const CHAMPIONSHIP_PAGES = new Set([
  CHAMPIONSHIP_PAGE,
  RACE_RESULTS_PAGE,
  FLEET_ASSIGNMENTS_PAGE,
  SCORING_NOTES_PAGE,
]);

export interface FtpPublishInput {
  workspace: WorkspaceContext;
  series: Series;
  /** The pages this publish built — the ones going out now. Pages carried
   *  over unticked stay as they are, here as on Sail Scoring. */
  files: FleetHtmlFile[];
  /** The publication's URL, which a link falls back to when its target has
   *  no copy on the club's site. */
  publicationBase: string;
  /** Every page live once this publish lands, by sub-path. */
  livePageAt: Map<string, string>;
  /** A championship's cross-page links, as sub-paths of the publication,
   *  and a way to build its pages again with other hrefs. Every one of its
   *  pages carries the scoring-notes link, and the standings the race-results
   *  one, so they cannot be patched after the fact. */
  championship?: {
    raceResults?: string;
    scoringNotes?: string;
    rebuild(hrefs: { raceResultsHref?: string; scoringNotesHref?: string }): Promise<FleetHtmlFile[]>;
  };
  /** Render the Schedule page again, each sailed race's results link given by
   *  `hrefFor` from the sub-path it links to on Sail Scoring. */
  renderSchedule?: (hrefFor: (target: string) => string) => string;
  /** Injected by tests; the scupper relay otherwise. */
  upload?: FtpUploader;
  sleep?: (ms: number) => Promise<void>;
}

function appBase(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
}

const describe = (file: FleetHtmlFile) => ({
  fleetName: file.fleetName,
  ...(file.subSeriesName ? { subSeriesName: file.subSeriesName } : {}),
});

/**
 * Upload the pages a publish just built to the series' FTP paths, for a
 * workspace with the `ftp-upload` feature. Runs after the publication is
 * saved: the club's site follows Sail Scoring, and a failure here leaves
 * the publication standing. Returns undefined for a series with no FTP path
 * on any page — nothing about FTP to report.
 *
 * Each page goes up as the page just published, with what only works on
 * Sail Scoring's own domain changed: links to the publication's other pages
 * point at their copies on the club's site where they have one, and at
 * Sail Scoring otherwise; root-relative URLs are made absolute.
 */
export async function publishToFtp(input: FtpPublishInput): Promise<FtpPublishOutcome | undefined> {
  const { workspace, series, files } = input;
  if (!workspace.features.includes('ftp-upload')) return undefined;

  const repos = createRepos({ workspaceId: workspace.workspaceId });
  // Names are what a built file carries; keys are what a stored path is
  // filed under. Resolved with every page-adding feature on — a page that
  // doesn't exist simply matches no file.
  const fleets = await repos.fleets.listBySeries(series.id);
  const championship = (await repos.splitRounds.listBySeries(series.id)).length > 0;
  const pages = resolvePublishPages({
    series,
    fleets,
    splitFleets: championship,
    features: { prizes: true, entryList: true, schedule: true },
  });
  const paths = configuredFtpPaths(pages, series);
  if (Object.keys(paths).length === 0) return undefined;
  const pathOfName = new Map(
    pages.flatMap((p) => (paths[p.key] ? [[p.name, paths[p.key]] as const] : [])),
  );
  const ftpPathAt = (subPath: string): string | undefined => {
    const name = input.livePageAt.get(subPath);
    return name ? pathOfName.get(name) : undefined;
  };

  const targets: { file: FleetHtmlFile; path: string }[] = [];
  const unmapped: FtpPublishOutcome['unmapped'] = [];
  for (const file of files) {
    const base = pathOfName.get(file.fleetName);
    if (base) targets.push({ file, path: ftpFilePath(base, file.subSeriesName) });
    else unmapped.push(describe(file));
  }
  const outcomeOf = (t: { file: FleetHtmlFile; path: string }): FtpPageOutcome => ({
    ...describe(t.file),
    path: t.path,
  });

  const servers = await repos.ftpServers.list();
  const server = servers.find((s) => s.id === resolveFtpServerId(servers, series));
  if (!server) {
    return { host: null, uploaded: [], failed: null, notAttempted: targets.map(outcomeOf), unmapped };
  }

  // A championship's pages are built again with links for the club's site,
  // relative to where its standings go — only when one of them is going.
  let championshipFiles: Map<string, string> | null = null;
  const champ = input.championship;
  if (champ && targets.some((t) => CHAMPIONSHIP_PAGES.has(t.file.fleetName))) {
    const from = pathOfName.get(CHAMPIONSHIP_PAGE);
    const href = (target: string | undefined) => {
      if (!target) return undefined;
      const published = `${input.publicationBase}/${target}`;
      return from ? ftpLinkHref(from, ftpPathAt(target), published) : published;
    };
    const raceResultsHref = href(champ.raceResults);
    const scoringNotesHref = href(champ.scoringNotes);
    try {
      const rebuilt = await champ.rebuild({
        ...(raceResultsHref ? { raceResultsHref } : {}),
        ...(scoringNotesHref ? { scoringNotesHref } : {}),
      });
      championshipFiles = new Map(rebuilt.map((f) => [f.fleetName, f.html]));
    } catch (err) {
      // The pages as published, links to Sail Scoring's layout and all, beat
      // no pages on the club's site.
      console.error('[publish-ftp] championship rebuild failed', err);
    }
  }

  const htmlFor = (target: { file: FleetHtmlFile; path: string }): string => {
    const { file } = target;
    let html = file.html;
    if (file.isSchedule && input.renderSchedule) {
      html = input.renderSchedule((to) =>
        ftpLinkHref(target.path, ftpPathAt(to), `${input.publicationBase}/${to}`),
      );
    } else if (championshipFiles?.has(file.fleetName)) {
      html = championshipFiles.get(file.fleetName)!;
    }
    return absolutizeRootRelativeUrls(html, appBase());
  };

  const upload = input.upload ?? uploadViaScupper;
  const uploaded: FtpPageOutcome[] = [];
  let failed: FtpPublishOutcome['failed'] = null;
  let i = 0;
  // One page at a time: each is its own FTP session, and a club's server is
  // the kind to cap how many a user holds at once.
  for (; i < targets.length; i++) {
    const t = targets[i];
    const result = await uploadWithRetry(upload, server, t.path, htmlFor(t), input.sleep);
    if (!result.ok) {
      failed = { ...outcomeOf(t), error: result.error };
      break;
    }
    uploaded.push(outcomeOf(t));
  }
  const notAttempted = targets.slice(failed ? i + 1 : targets.length).map(outcomeOf);

  if (uploaded.length > 0) {
    // Where the series' pages last went — bookkeeping, not an edit, so the
    // quiet write that leaves the version alone. Best-effort: the files are
    // already on the club's server, and saying so matters more.
    try {
      await repos.series.setPublishPrefs(series.id, {
        ftpServerId: server.id,
        ftpHost: server.host,
        ftpLastUploadedAt: Date.now(),
        ftpUploadedVersion: series.version ?? 1,
      });
      const n = uploaded.length;
      await recordActivity(workspace, {
        action: 'publish.ftp-uploaded',
        seriesId: series.id,
        summary: `Uploaded ${n} page${n === 1 ? '' : 's'} to ${server.host}`,
      });
    } catch (err) {
      console.error('[publish-ftp] recording the upload failed', err);
    }
  }

  return { host: server.host, uploaded, failed, notAttempted, unmapped };
}
