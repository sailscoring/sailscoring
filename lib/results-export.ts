import {
  calculateFleetStandings,
  calculateRaceScores,
  calculateHandicapRaceScores,
  calculateSubSeriesFleetStandings,
  buildRaceFleetExclusionMap,
} from './scoring';
import {
  renderSeriesHtml,
  renderCombinedSeriesHtml,
  assembleSeriesResultsData,
  type SeriesResultsData,
} from './results-renderer';
import { resolvePublishingGroups, suppressedFleetIds, producesPage } from './publishing-groups';
import {
  buildPublicExportFromSnapshot,
  resolveSeriesLogoDefaults,
  type ExportRepos,
} from './public-export';
import { loadSeriesSnapshot } from './series-snapshot';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
} from './competitor-fields';
import { seriesSlug } from './series-name';
import type { ResultCode, PenaltyCode } from './types';

export { seriesSlug };

/** Derive a per-fleet bilge slug from the bundle prefix. */
export function fleetBilgeSlug(prefix: string, fleetName: string, isSingleDefault: boolean): string {
  if (isSingleDefault) return `${prefix}/standings`;
  return `${prefix}/standings-${seriesSlug(fleetName)}`;
}

/** Insert a fleet suffix before the file extension in an FTP path. */
export function fleetFtpPath(base: string, fleetName: string, isSingleDefault: boolean): string {
  if (isSingleDefault || !base) return base;
  const suffix = '-' + seriesSlug(fleetName);
  const lastDot = base.lastIndexOf('.');
  const lastSlash = base.lastIndexOf('/');
  if (lastDot > lastSlash) return base.slice(0, lastDot) + suffix + base.slice(lastDot);
  return base + suffix;
}

/** Derive prefilled FTP paths for the dialog. Per-fleet `ftpPaths` entries
 *  are used verbatim; missing entries fall back to deriving from the legacy
 *  `ftpPath` (older series uploaded before per-fleet paths landed — #131). */
export function derivePrefillPaths(
  fleets: { id: string; name: string }[],
  ftpPaths: Record<string, string> | undefined,
  legacyFtpPath: string,
  isSingleDefault: boolean,
): string[] {
  const stored = ftpPaths ?? {};
  if (fleets.length === 0) return [legacyFtpPath];
  return fleets.map(
    (f) => stored[f.id] ?? fleetFtpPath(legacyFtpPath, f.name, isSingleDefault),
  );
}

/** One entry of `buildFleetHtmlFiles`' output: a fleet's page, a (sub-series,
 *  fleet) page, or — `isCombined` — a combined page carrying several fleets'
 *  results under a publishing group's name. */
export interface FleetHtmlFile {
  fleetName: string;
  isDefault: boolean;
  subSeriesName?: string;
  /** Set on a publishing group's combined page; `fleetName` is then the
   *  group name (pages are name-keyed alongside fleet pages). */
  isCombined?: boolean;
  html: string;
}

/** Build one HTML string per page: per fleet (or per (sub-series, fleet) when
 *  the series has blocks) — plus, for a blockless multi-fleet series, one
 *  combined page per publishing group, listed first. Fleets suppressed by a
 *  group ("don't publish members individually") get no standalone entry. */
export async function buildFleetHtmlFiles(
  // Only the six read repos are needed (same surface as `buildPublicExport`),
  // so this accepts the narrower `ExportRepos` — that lets the server publish
  // handler build it directly from `createRepos()` without the file-only
  // `listSeriesNames` / `deleteSeriesChildren` members.
  repos: ExportRepos,
  seriesId: string,
  // Series-index URL (`/p/{ws}/{slug}`) for the in-app publish path. When given,
  // each fleet page gets a `← {series name}` breadcrumb up to its listing. Left
  // undefined for downloads, FTP uploads, and previews, which have no `/p/`
  // parent — see `SeriesResultsData.seriesIndexUrl`.
  seriesIndexUrl?: string,
): Promise<FleetHtmlFile[] | null> {
  const snapshot = await loadSeriesSnapshot(repos, seriesId);
  if (!snapshot || snapshot.competitors.length === 0 || snapshot.races.length === 0) {
    return null;
  }
  // Publish-time fallback: empty venue/event logo slots inherit the workspace
  // defaults, so the rendered header and the embedded JSON both carry them.
  snapshot.series = await resolveSeriesLogoDefaults(snapshot.series, repos.logoRepo);
  const {
    series,
    competitors,
    fleets,
    races,
    subSeries,
    finishes: allFinishes,
    raceStarts: allRaceStarts,
    ratingOverrides: allRatingOverrides,
  } = snapshot;
  const { fleetStandings: fleetResults } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
    allRatingOverrides,
    undefined,
    buildRaceFleetExclusionMap(series.raceFleetExclusions),
  );

  const isSingleDefault = fleets.length <= 1;

  // Build the JSON export once for the whole series (embedded in every
  // fleet's HTML) from the snapshot and standings already in hand, so the
  // data is loaded and scored exactly once per export.
  const publicExport = (series.includeJsonExport ?? true)
    ? buildPublicExportFromSnapshot(snapshot, { fleetStandings: fleetResults })
    : null;

  // Pull the inline flag SVG payload only when this export actually references
  // nationality codes. Dynamic import keeps the ~2.5 MB module out of the
  // standings-page bundle — it loads on demand the first time a scorer
  // triggers HTML export / publish / FTP upload.
  const flagsEnabled = (series.enabledCompetitorFields ?? defaultEnabledCompetitorFields()).includes('nationality');
  const anyNationality = competitors.some((c) => c.nationality);
  const flagSvgByCode = flagsEnabled && anyNationality
    ? (await import('./nationality/flags')).NATIONAL_FLAGS
    : undefined;

  const seriesInfo = { name: series.name, venue: series.venue, venueLogoUrl: series.venueLogoUrl, eventLogoUrl: series.eventLogoUrl, venueUrl: series.venueUrl, eventUrl: series.eventUrl };

  // The "Open in Sail Scoring" import URL is series-wide (the embedded JSON
  // covers every fleet), so derive it once for all pages.
  let openInAppUrl: string | undefined;
  if (publicExport) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (appUrl) {
      const json = JSON.stringify(publicExport);
      const bytes = new TextEncoder().encode(json);
      let binary = '';
      bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
      const b64 = btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      openInAppUrl = `${appUrl}/import#data=${b64}`;
    }
  }

  const results: FleetHtmlFile[] = [];

  // Render one HTML page per fleet of a view: the whole series, or one
  // sub-series scored independently. Block pages renumber their races 1..n
  // within the block ("Spring Race 3", not the series-wide race number) and
  // carry the block name in the page title. Fleets in `skipFleetIds` get no
  // standalone page (they publish through a combined page instead). Returns
  // each fleet's data assembler so the caller can render combined pages from
  // the same scored inputs.
  const renderView = (
    viewFleetResults: typeof fleetResults,
    viewRaces: typeof races,
    subSeriesName?: string,
    skipFleetIds?: Set<string>,
  ): Map<string, (anchorPrefix?: string) => SeriesResultsData> => {
  const assemblerByFleetId = new Map<string, (anchorPrefix?: string) => SeriesResultsData>();
  const viewSeriesInfo = subSeriesName
    ? { ...seriesInfo, name: `${seriesInfo.name} — ${subSeriesName}` }
    : seriesInfo;
  for (const { fleet, standings, nhcRaceScoresByRaceId, nhcAggregatesByRaceId, echoRaceScoresByRaceId, echoAggregatesByRaceId } of viewFleetResults) {
    const fleetCompetitorIds = new Set(standings.map((s) => s.competitor.id));

    // Per-fleet race score maps (only this fleet's competitors)
    const isHandicap = fleet.scoringSystem !== 'scratch';
    const isNhc = fleet.scoringSystem === 'nhc';
    const isEcho = fleet.scoringSystem === 'echo';
    const raceStartByRaceId = new Map(
      allRaceStarts
        .filter((rs) => rs.fleetIds.includes(fleet.id))
        .map((rs) => [rs.raceId, rs]),
    );
    type RaceScoreCellForRender = {
      points: number;
      place: number | null;
      rank: number | null;
      resultCode: ResultCode | null;
      penaltyCode: PenaltyCode | null;
      penaltyOverride: number | null;
      finishTime: string | null;
      tcfApplied?: number | null;
      newTcf?: number | null;
      nhc?: { fairTcf: number; compScore: number; isExtreme: boolean; extremeDirection?: 'fast' | 'slow'; alphaApplied: number; provisionalTcf: number; adjustment: number };
      echo?: { ctRatio: number; fairTcf: number; adjustment: number; alphaApplied: number };
    };
    const raceScoresByRaceId = new Map<string, Map<string, RaceScoreCellForRender>>(
      viewRaces.map((race) => {
        const finishesForRace = allFinishes.filter((f) => f.raceId === race.id);
        const finishByCompetitorId = new Map(
          finishesForRace
            .filter((f): f is typeof f & { competitorId: string } => f.competitorId !== null)
            .map((f) => [f.competitorId, f]),
        );
        const fleetCompetitors = competitors.filter((c) => fleetCompetitorIds.has(c.id));
        const raceStart = raceStartByRaceId.get(race.id);

        // Per-race tables list only competitors with an explicit Finish row
        // for this race; implicit DNCs (no Finish row) still appear in the
        // summary table via standings but not in the individual race table.
        // See #130.
        const hasExplicitFinish = (id: string) => finishByCompetitorId.has(id);

        if (isNhc && nhcRaceScoresByRaceId) {
          // NHC: scores already computed by calculateFleetStandings (with running TCF map)
          const nhcScores = nhcRaceScoresByRaceId.get(race.id);
          const scoreMap = new Map<string, RaceScoreCellForRender>(
            [...(nhcScores ?? new Map()).entries()]
              .filter(([id]) => hasExplicitFinish(id))
              .map(([id, s]) => [
                id,
                {
                  points: s.points,
                  place: s.place,
                  rank: s.rank,
                  resultCode: s.resultCode,
                  penaltyCode: finishByCompetitorId.get(id)?.penaltyCode ?? null,
                  penaltyOverride: finishByCompetitorId.get(id)?.penaltyOverride ?? null,
                  finishTime: finishByCompetitorId.get(id)?.finishTime ?? null,
                  tcfApplied: s.tcfApplied,
                  newTcf: s.newTcf,
                  ...(s.nhc ? { nhc: s.nhc } : {}),
                },
              ]),
          );
          return [race.id, scoreMap] as const;
        }

        if (isEcho && echoRaceScoresByRaceId) {
          // ECHO: scores already computed by calculateFleetStandings.
          const echoScores = echoRaceScoresByRaceId.get(race.id);
          const scoreMap = new Map<string, RaceScoreCellForRender>(
            [...(echoScores ?? new Map()).entries()]
              .filter(([id]) => hasExplicitFinish(id))
              .map(([id, s]) => [
                id,
                {
                  points: s.points,
                  place: s.place,
                  rank: s.rank,
                  resultCode: s.resultCode,
                  penaltyCode: finishByCompetitorId.get(id)?.penaltyCode ?? null,
                  penaltyOverride: finishByCompetitorId.get(id)?.penaltyOverride ?? null,
                  finishTime: finishByCompetitorId.get(id)?.finishTime ?? null,
                  tcfApplied: s.tcfApplied,
                  newTcf: s.newTcf,
                  ...(s.echo ? { echo: s.echo } : {}),
                },
              ]),
          );
          return [race.id, scoreMap] as const;
        }

        let scores;
        // Per-race static-rating overrides (mid-series rating change) for this
        // fleet's system, keyed by competitor.
        const overrideField = fleet.scoringSystem === 'irc' ? 'ircTcc' : fleet.scoringSystem === 'vprs' ? 'vprsTcc' : fleet.scoringSystem === 'py' ? 'pyNumber' : null;
        const overrideByComp = new Map<string, number>();
        if (overrideField) {
          for (const o of allRatingOverrides) {
            if (o.raceId === race.id && o.field === overrideField) overrideByComp.set(o.competitorId, o.value);
          }
        }
        if (isHandicap && raceStart) {
          // Applied-TCF map from each competitor's static rating, honouring any
          // per-race override (IRC/PY only — NHC/ECHO took the early returns).
          const tcfMap = new Map<string, number>();
          for (const c of fleetCompetitors) {
            if (fleet.scoringSystem === 'irc') {
              const tcc = overrideByComp.get(c.id) ?? c.ircTcc;
              if (tcc != null) tcfMap.set(c.id, tcc);
            } else if (fleet.scoringSystem === 'vprs') {
              const tcc = overrideByComp.get(c.id) ?? c.vprsTcc;
              if (tcc != null) tcfMap.set(c.id, tcc);
            } else if (fleet.scoringSystem === 'py') {
              const py = overrideByComp.get(c.id) ?? c.pyNumber;
              if (py != null && py > 0) tcfMap.set(c.id, 1000 / py);
            }
          }
          const ratedFleetCompetitors = fleetCompetitors.filter((c) => tcfMap.has(c.id));
          scores = calculateHandicapRaceScores(finishesForRace, ratedFleetCompetitors, raceStart, tcfMap, series.dnfScoring ?? 'seriesEntries').scores;
        } else {
          scores = calculateRaceScores(finishesForRace, fleetCompetitors, series.dnfScoring ?? 'seriesEntries', fleet.id);
        }
        const scoreMap = new Map<string, RaceScoreCellForRender>(
          [...scores.entries()]
            .filter(([id]) => hasExplicitFinish(id))
            .map(([id, s]) => [
              id,
              {
                points: s.points,
                place: s.place,
                rank: s.rank,
                resultCode: s.resultCode,
                penaltyCode: finishByCompetitorId.get(id)?.penaltyCode ?? null,
                penaltyOverride: finishByCompetitorId.get(id)?.penaltyOverride ?? null,
                finishTime: finishByCompetitorId.get(id)?.finishTime ?? null,
                ...('tcfApplied' in s ? { tcfApplied: (s as { tcfApplied: number | null }).tcfApplied } : {}),
                ...(overrideByComp.has(id) ? { tccOverride: true } : {}),
              },
            ]),
        );
        return [race.id, scoreMap] as const;
      }),
    );

    const competitorsById = new Map(competitors.map((c) => [c.id, c]));
    const fleetName = isSingleDefault ? undefined : fleet.name;

    // Build NHC / ECHO aggregates header maps iff publishing toggle is on
    const publishRatingCalcs = series.publishRatingCalculations ?? true;
    const showPerRaceRatings = series.showPerRaceRatingsInSummary ?? true;
    // Build seed-rating map for NHC/ECHO fleets — populated from the
    // competitor's initial TCF/H. Restricted to this fleet's competitors.
    const seedRatingByCompetitorId = (isNhc || isEcho)
      ? new Map<string, number>(
          competitors
            .filter((c) => fleetCompetitorIds.has(c.id))
            .map((c) => [c.id, isNhc ? c.nhcStartingTcf : c.echoStartingTcf] as const)
            .filter((entry): entry is [string, number] => entry[1] != null),
        )
      : undefined;
    const nhcAggregatesForRender = isNhc && publishRatingCalcs && nhcAggregatesByRaceId
      ? new Map([...nhcAggregatesByRaceId.entries()].map(([raceId, agg]) => [raceId, {
          finisherCount: agg.finisherCount,
          ctAvgSecs: agg.ctAvg,
          meanTcf: agg.meanTcf,
          p50: agg.p50,
          w51: agg.w51,
          sMean: agg.sMean,
          sStdev: agg.sStdev,
          sHi: agg.sHi,
          sLo: agg.sLo,
          extremeCount: agg.extremeCount,
          realignmentFactor: agg.realignmentFactor,
          updateSuppressed: agg.updateSuppressed,
        }]))
      : undefined;
    const echoAggregatesForRender = isEcho && publishRatingCalcs && echoAggregatesByRaceId
      ? new Map([...echoAggregatesByRaceId.entries()].map(([raceId, agg]) => [raceId, {
          alpha: agg.alpha,
          finisherCount: agg.finisherCount,
          sumH: agg.sumH,
          sumReciprocalEt: agg.sumReciprocalEt,
          updateSuppressed: agg.updateSuppressed,
        }]))
      : undefined;

    const assemble = (anchorPrefix?: string): SeriesResultsData => {
      const data = assembleSeriesResultsData(
        viewSeriesInfo,
        viewRaces,
        standings,
        raceScoresByRaceId,
        competitorsById,
        series.enabledCompetitorFields ?? defaultEnabledCompetitorFields(),
        new Date(),
        fleetName,
        {
          raceStarts: allRaceStarts,
          fleetId: fleet.id,
          scoringSystem: fleet.scoringSystem,
          primaryPersonLabel: series.primaryPersonLabel ?? DEFAULT_PRIMARY_PERSON_LABEL,
          subdivisionAxes: series.subdivisionAxes ?? [],
          ...(nhcAggregatesForRender ? { nhcAggregatesByRaceId: nhcAggregatesForRender } : {}),
          ...(echoAggregatesForRender ? { echoAggregatesByRaceId: echoAggregatesForRender } : {}),
          showPerRaceRatings,
          ...(seedRatingByCompetitorId ? { seedRatingByCompetitorId } : {}),
          ...(anchorPrefix ? { anchorPrefix } : {}),
        },
      );
      if (openInAppUrl) data.openInAppUrl = openInAppUrl;
      if (flagSvgByCode) data.flagSvgByCode = flagSvgByCode;
      if (seriesIndexUrl) data.seriesIndexUrl = seriesIndexUrl;
      return data;
    };
    assemblerByFleetId.set(fleet.id, assemble);

    if (!skipFleetIds?.has(fleet.id)) {
      results.push({
        fleetName: fleet.name,
        isDefault: isSingleDefault,
        ...(subSeriesName ? { subSeriesName } : {}),
        html: renderSeriesHtml(assemble()),
      });
    }
  }
  return assemblerByFleetId;
  };

  if (subSeries.length > 0) {
    const blockResults = calculateSubSeriesFleetStandings(
      subSeries,
      fleets,
      competitors,
      races,
      allFinishes,
      series.discardThresholds ?? [],
      series.dnfScoring ?? 'seriesEntries',
      allRaceStarts,
      allRatingOverrides,
    );
    for (const block of blockResults) {
      if (block.races.length === 0) continue;
      const renumbered = block.races.map((r, i) => ({ ...r, raceNumber: i + 1 }));
      renderView(block.fleetStandings, renumbered, block.subSeries.name);
    }
  } else {
    // Combined pages (#255) apply only to a blockless multi-fleet series: a
    // single fleet has nothing to combine, and a series with sub-series
    // publishes its own (block × fleet) page grid.
    const groupsApply = !isSingleDefault;
    const resolvedGroups = groupsApply
      ? resolvePublishingGroups(series.publishingGroups, fleets).filter(producesPage)
      : [];
    const suppressed = groupsApply
      ? suppressedFleetIds(series.publishingGroups, fleets)
      : undefined;

    const assemblerByFleetId = renderView(fleetResults, races, undefined, suppressed);

    // Combined pages lead the list — the series index and preview show them
    // first, ahead of the per-fleet pages they aggregate.
    const combined: FleetHtmlFile[] = resolvedGroups.map(({ group, fleets: members }) => {
      const sections = members.map((f) =>
        // Per-section anchor prefix so `#r1` links stay unambiguous when
        // several fleets' race tables share the document.
        assemblerByFleetId.get(f.id)!(`${seriesSlug(f.name)}-`),
      );
      return {
        fleetName: group.name,
        isDefault: false,
        isCombined: true,
        html: renderCombinedSeriesHtml(sections, {
          pageName: group.name,
          standingsOnly: group.detail === 'standings',
        }),
      };
    });
    results.unshift(...combined);
  }

  return results.length > 0 ? results : null;
}

/** Browser-only: download an HTML string as a file via a transient anchor. */
export function triggerDownload(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html; charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Download filename for one fleet's HTML, e.g. `my-series.html` (single/default
 *  fleet) or `my-series-junior.html` (named fleet in a multi-fleet series).
 *  Sub-series pages carry the block name: `my-series-winter[-junior].html`. */
export function fleetHtmlFilename(
  seriesName: string,
  file: { fleetName: string; isDefault: boolean; subSeriesName?: string },
): string {
  const block = file.subSeriesName ? '-' + seriesSlug(file.subSeriesName) : '';
  const suffix = file.isDefault ? '' : '-' + seriesSlug(file.fleetName);
  return seriesSlug(seriesName) + block + suffix + '.html';
}

/** Human-readable document title for one fleet's results, e.g. `Autumn League
 *  2026` (single/default fleet) or `Autumn League 2026 - Junior` (named fleet),
 *  with the sub-series block first when present (`… - Winter - Junior`). Set as
 *  the page title before printing the preview so the browser's print-to-PDF
 *  dialog suggests this as the filename instead of the app title. Mirrors
 *  `fleetHtmlFilename`'s ordering but stays human-readable. */
export function fleetPdfTitle(
  seriesName: string,
  file: { fleetName: string; isDefault: boolean; subSeriesName?: string },
): string {
  const parts = [seriesName];
  if (file.subSeriesName) parts.push(file.subSeriesName);
  if (!file.isDefault) parts.push(file.fleetName);
  return parts.join(' - ');
}
