import type { Repos } from './repos';
import {
  calculateFleetStandings,
  calculateRaceScores,
  calculateHandicapRaceScores,
} from './scoring';
import { renderSeriesHtml, assembleSeriesResultsData } from './results-renderer';
import { buildPublicExport } from './public-export';
import {
  defaultEnabledCompetitorFields,
  DEFAULT_PRIMARY_PERSON_LABEL,
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

/** Strip the fleet suffix from a fleet-specific path to recover the base path. */
export function stripFleetSuffix(path: string, fleetName: string): string {
  const suffix = '-' + seriesSlug(fleetName);
  const lastDot = path.lastIndexOf('.');
  const lastSlash = path.lastIndexOf('/');
  if (lastDot > lastSlash) {
    const stem = path.slice(0, lastDot);
    if (stem.endsWith(suffix)) return stem.slice(0, -suffix.length) + path.slice(lastDot);
  } else if (path.endsWith(suffix)) {
    return path.slice(0, -suffix.length);
  }
  return path;
}

/** Build one HTML string per fleet. Returns [{fleetName, html}]. */
export async function buildFleetHtmlFiles(
  repos: Repos,
  seriesId: string,
): Promise<{ fleetName: string; isDefault: boolean; html: string }[] | null> {
  const [series, competitors, races, fleets] = await Promise.all([
    repos.seriesRepo.get(seriesId),
    repos.competitorRepo.listBySeries(seriesId),
    repos.raceRepo.listBySeries(seriesId),
    repos.fleetRepo.listBySeries(seriesId),
  ]);
  if (!series || competitors.length === 0 || races.length === 0) return null;

  const [allFinishes, allRaceStarts] = await Promise.all([
    repos.finishRepo.listBySeries(seriesId, competitors.map((c) => c.id)),
    repos.raceStartRepo.listByRaces(races.map((r) => r.id)),
  ]);
  const { fleetStandings: fleetResults } = calculateFleetStandings(
    fleets,
    competitors,
    races,
    allFinishes,
    series.discardThresholds ?? [],
    series.dnfScoring ?? 'seriesEntries',
    allRaceStarts,
  );

  const isSingleDefault = fleets.length <= 1;

  // Build JSON export once for the whole series (embedded in every fleet's HTML)
  const publicExport = (series.includeJsonExport ?? true)
    ? await buildPublicExport(seriesId, repos)
    : null;

  const seriesInfo = { name: series.name, venue: series.venue, venueLogoUrl: series.venueLogoUrl, eventLogoUrl: series.eventLogoUrl };

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
      nhc?: { ctRatio: number; fairTcf: number; adjustment: number; alphaApplied: number };
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

        if (isNhc && nhcRaceScoresByRaceId) {
          // NHC: scores already computed by calculateFleetStandings (with running TCF map)
          const nhcScores = nhcRaceScoresByRaceId.get(race.id);
          const scoreMap = new Map<string, RaceScoreCellForRender>(
            [...(nhcScores ?? new Map()).entries()].map(([id, s]) => [
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
            [...(echoScores ?? new Map()).entries()].map(([id, s]) => [
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
        if (isHandicap && raceStart) {
          // Build the applied-TCF map from each competitor's static rating
          // (IRC/PY only — NHC took the early-return path above).
          const tcfMap = new Map<string, number>();
          for (const c of fleetCompetitors) {
            if (fleet.scoringSystem === 'irc' && c.ircTcc != null) tcfMap.set(c.id, c.ircTcc);
            else if (fleet.scoringSystem === 'py' && c.pyNumber != null) tcfMap.set(c.id, 1000 / c.pyNumber);
          }
          const ratedFleetCompetitors = fleetCompetitors.filter((c) => tcfMap.has(c.id));
          scores = calculateHandicapRaceScores(finishesForRace, ratedFleetCompetitors, raceStart, tcfMap, series.dnfScoring ?? 'seriesEntries').scores;
        } else {
          scores = calculateRaceScores(finishesForRace, fleetCompetitors, series.dnfScoring ?? 'seriesEntries');
        }
        const scoreMap = new Map<string, RaceScoreCellForRender>(
          [...scores.entries()].map(([id, s]) => [
            id,
            {
              points: s.points,
              place: s.place,
              rank: s.rank,
              resultCode: s.resultCode,
              penaltyCode: finishByCompetitorId.get(id)?.penaltyCode ?? null,
              penaltyOverride: finishByCompetitorId.get(id)?.penaltyOverride ?? null,
              finishTime: finishByCompetitorId.get(id)?.finishTime ?? null,
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
    const nhcAggregatesForRender = isNhc && publishRatingCalcs && nhcAggregatesByRaceId
      ? new Map([...nhcAggregatesByRaceId.entries()].map(([raceId, agg]) => [raceId, {
          alpha: agg.alpha,
          finisherCount: agg.finisherCount,
          ctAvgSecs: agg.ctAvg,
          meanTcf: agg.meanTcf,
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
        ...(nhcAggregatesForRender ? { nhcAggregatesByRaceId: nhcAggregatesForRender } : {}),
        ...(echoAggregatesForRender ? { echoAggregatesByRaceId: echoAggregatesForRender } : {}),
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

/** Download a single fleet's HTML (or the only fleet for single-fleet series). */
export async function exportFleetHtml(repos: Repos, seriesId: string, fleetName: string) {
  const series = await repos.seriesRepo.get(seriesId);
  const base = seriesSlug(series?.name ?? 'series');
  const files = await buildFleetHtmlFiles(repos, seriesId);
  if (!files) return;
  const file = files.find((f) => f.fleetName === fleetName) ?? files[0];
  const suffix = file.isDefault ? '' : '-' + seriesSlug(file.fleetName);
  triggerDownload(base + suffix + '.html', file.html);
}
