import {
  calculateFleetStandings,
  calculateRaceScores,
  calculateHandicapRaceScores,
} from './scoring';
import { renderSeriesHtml, assembleSeriesResultsData } from './results-renderer';
import { buildPublicExport, type ExportRepos } from './public-export';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
  DEFAULT_SUBDIVISION_LABEL,
} from './competitor-fields';
import type { ResultCode, PenaltyCode } from './types';

export function seriesSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'series';
}

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

/** Build one HTML string per fleet. Returns [{fleetName, html}]. */
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
): Promise<{ fleetName: string; isDefault: boolean; html: string }[] | null> {
  const [series, competitors, races, fleets] = await Promise.all([
    repos.seriesRepo.get(seriesId),
    repos.competitorRepo.listBySeries(seriesId),
    repos.raceRepo.listBySeries(seriesId),
    repos.fleetRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return null;

  const [allFinishes, allRaceStarts, allRatingOverrides] = await Promise.all([
    repos.finishRepo.listBySeries(seriesId, competitors.map((c) => c.id)),
    repos.raceStartRepo.listByRaces(races.map((r) => r.id)),
    repos.raceRatingOverrideRepo.listByRaces(races.map((r) => r.id)),
  ]);
  const { fleetStandings: fleetResults } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
    allRatingOverrides,
  );

  const isSingleDefault = fleets.length <= 1;

  // Build JSON export once for the whole series (embedded in every fleet's HTML)
  const publicExport = (series.includeJsonExport ?? true)
    ? await buildPublicExport(seriesId, repos)
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

  const results: { fleetName: string; isDefault: boolean; html: string }[] = [];

  for (const { fleet, standings, nhcRaceScoresByRaceId, nhcAggregatesByRaceId, echoRaceScoresByRaceId, echoAggregatesByRaceId } of fleetResults) {
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
      races.map((race) => {
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
        const overrideField = fleet.scoringSystem === 'irc' ? 'ircTcc' : fleet.scoringSystem === 'py' ? 'pyNumber' : null;
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
            } else if (fleet.scoringSystem === 'py') {
              const py = overrideByComp.get(c.id) ?? c.pyNumber;
              if (py != null && py > 0) tcfMap.set(c.id, 1000 / py);
            }
          }
          const ratedFleetCompetitors = fleetCompetitors.filter((c) => tcfMap.has(c.id));
          scores = calculateHandicapRaceScores(finishesForRace, ratedFleetCompetitors, raceStart, tcfMap, series.dnfScoring ?? 'seriesEntries').scores;
        } else {
          scores = calculateRaceScores(finishesForRace, fleetCompetitors, series.dnfScoring ?? 'seriesEntries');
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

    const data = assembleSeriesResultsData(
      seriesInfo,
      races,
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
        subdivisionLabel: series.subdivisionLabel ?? DEFAULT_SUBDIVISION_LABEL,
        ...(nhcAggregatesForRender ? { nhcAggregatesByRaceId: nhcAggregatesForRender } : {}),
        ...(echoAggregatesForRender ? { echoAggregatesByRaceId: echoAggregatesForRender } : {}),
        showPerRaceRatings,
        ...(seedRatingByCompetitorId ? { seedRatingByCompetitorId } : {}),
      },
    );

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
        data.openInAppUrl = `${appUrl}/import#data=${b64}`;
      }
    }
    if (flagSvgByCode) data.flagSvgByCode = flagSvgByCode;
    if (seriesIndexUrl) data.seriesIndexUrl = seriesIndexUrl;

    results.push({
      fleetName: fleet.name,
      isDefault: isSingleDefault,
      html: renderSeriesHtml(data),
    });
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
 *  fleet) or `my-series-junior.html` (named fleet in a multi-fleet series). */
export function fleetHtmlFilename(
  seriesName: string,
  file: { fleetName: string; isDefault: boolean },
): string {
  const suffix = file.isDefault ? '' : '-' + seriesSlug(file.fleetName);
  return seriesSlug(seriesName) + suffix + '.html';
}
