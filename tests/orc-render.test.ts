import { describe, expect, it } from 'vitest';

import {
  assembleSeriesResultsData,
  renderSeriesHtml,
} from '@/lib/results-renderer';
import type { OrcRaceCalc } from '@/lib/types';

/**
 * The published ORC audit trail: every PCS/ToD race table carries the line a
 * competitor needs to reproduce their corrected time — scoring wind and its
 * source, course, scratch allowance — plus the implied-wind column and, for
 * constructed courses, the leg-by-leg course record.
 */

function assemble(options: {
  orc: (id: string) => OrcRaceCalc;
  raceStarts?: Array<{ raceId: string; fleetIds: string[]; startTime?: string; courseLegs?: Array<{ distanceNm: number; bearingDeg: number; windDirectionDeg: number }> }>;
}) {
  const scores = new Map([
    ['c1', { points: 1, place: 1, rank: 1, resultCode: null, finishTime: '15:00:00', tcfApplied: options.orc('c1').todApplied, elapsedTime: 3600, correctedTime: 3591, orc: options.orc('c1') }],
    ['c2', { points: 2, place: 2, rank: 2, resultCode: null, finishTime: '15:01:00', tcfApplied: options.orc('c2').todApplied, elapsedTime: 3660, correctedTime: 3612, orc: options.orc('c2') }],
  ]);
  const boats = {
    c1: { id: 'c1', sailNumber: 'IRL 2507', names: ['Impetuous'] },
    c2: { id: 'c2', sailNumber: 'IRL 1551', names: ['Mojo'] },
  };
  return assembleSeriesResultsData(
    { name: 'ORC Render Test', venue: '' },
    [{ id: 'r1', raceNumber: 1, date: '2026-09-12', name: null }],
    [
      { rank: 1, competitor: boats.c1, racePoints: [1], raceCodes: [null], totalPoints: 1, netPoints: 1, raceDiscards: [false] },
      { rank: 2, competitor: boats.c2, racePoints: [2], raceCodes: [null], totalPoints: 2, netPoints: 2, raceDiscards: [false] },
    ],
    new Map([['r1', scores]]),
    new Map([
      ['c1', { sailNumber: 'IRL 2507', names: ['Impetuous'] }],
      ['c2', { sailNumber: 'IRL 1551', names: ['Mojo'] }],
    ]),
    [],
    new Date('2026-09-12T18:00:00Z'),
    'Class 2',
    {
      raceStarts: options.raceStarts ?? [{ raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' }],
      fleetId: 'f1',
      scoringSystem: 'orc',
    },
  );
}

describe('published ORC transparency', () => {
  it('a PCS race states the scoring wind, course model, scratch allowance, and each implied wind', () => {
    const calc = (id: string): OrcRaceCalc => ({
      todApplied: id === 'c1' ? 869.2 : 889.2,
      scratchTod: 869.2,
      distanceNm: 3.9,
      impliedWind: id === 'c1' ? 7.70327 : 7.66196,
      scoringWind: 7.70327,
      courseModel: 'WL',
      option: 'WL',
    });
    const html = renderSeriesHtml(assemble({ orc: calc }));
    expect(html).toContain('Scored on ORC performance curves');
    expect(html).toContain('Windward/leeward course model');
    expect(html).toContain('3.90 NM');
    expect(html).toContain("Scoring wind 7.70 kt (winner's implied wind)");
    expect(html).toContain('Scratch allowance 869.2 s/NM');
    expect(html).toContain('<th>Implied wind</th>');
    expect(html).toContain('>7.70</td>');
    expect(html).toContain('>7.66</td>');
    // The rating column is the applied allowance, labelled ToD at 1 dp.
    expect(html).toContain('<th>ToD</th>');
    expect(html).toContain('>889.2</td>');
    // The stored option duplicates the course model on a PCS race, so the
    // rating-field part stays out of the header.
    expect(html).not.toContain('Rating field');
  });

  it('a race-committee scoring wind is attributed', () => {
    const calc = (id: string): OrcRaceCalc => ({
      todApplied: id === 'c1' ? 700 : 720,
      scratchTod: 700,
      distanceNm: 3.9,
      impliedWind: 11.9,
      scoringWind: 15.5,
      scoringWindOverridden: true,
      courseModel: 'WL',
    });
    const html = renderSeriesHtml(assemble({ orc: calc }));
    expect(html).toContain('Scoring wind 15.50 kt (set by the race committee)');
  });

  it('a constructed course publishes the leg-by-leg record', () => {
    const calc = (id: string): OrcRaceCalc => ({
      todApplied: id === 'c1' ? 600 : 620,
      scratchTod: 600,
      distanceNm: 8.11,
      impliedWind: 18.06,
      scoringWind: 18.06,
      courseModel: 'CC',
    });
    const html = renderSeriesHtml(
      assemble({
        orc: calc,
        raceStarts: [{
          raceId: 'r1',
          fleetIds: ['f1'],
          startTime: '14:00:00',
          courseLegs: [
            { distanceNm: 2.09, bearingDeg: 162, windDirectionDeg: 160 },
            { distanceNm: 0.19, bearingDeg: 316, windDirectionDeg: 160 },
          ],
        }],
      }),
    );
    expect(html).toContain('Constructed course');
    expect(html).toContain('8.11 NM');
    expect(html).toContain('2 legs');
    expect(html).toContain('Legs: 2.09 NM @ 162&deg; (wind 160&deg;)');
  });

  it('a plain time-on-distance race states the correction ingredients without a scoring wind', () => {
    const calc = (id: string): OrcRaceCalc => ({
      option: 'APHD',
      todApplied: id === 'c1' ? 594.7 : 623.0,
      scratchTod: 594.7,
      distanceNm: 3.24,
    });
    const html = renderSeriesHtml(assemble({ orc: calc }));
    expect(html).toContain('Scored on ORC time-on-distance');
    expect(html).toContain('Course 3.24 NM');
    expect(html).toContain('Rating field APHD');
    expect(html).toContain('Scratch allowance 594.7 s/NM');
    expect(html).not.toContain('Scoring wind');
    expect(html).not.toContain('<th>Implied wind</th>');
  });

  it('a certificate single-number race names its rating field with the TCC presentation', () => {
    // A time-on-time race carries only the option in its audit block — the
    // header names the field, and the rating column stays a 3-dp TCC.
    const calc = (): OrcRaceCalc => ({ option: 'APHT' });
    const scores = new Map([
      ['c1', { points: 1, place: 1, rank: 1, resultCode: null, finishTime: '15:00:00', tcfApplied: 0.9631, elapsedTime: 3600, correctedTime: 3467, orc: calc() }],
      ['c2', { points: 2, place: 2, rank: 2, resultCode: null, finishTime: '14:58:00', tcfApplied: 1.0089, elapsedTime: 3480, correctedTime: 3511, orc: calc() }],
    ]);
    const data = assembleSeriesResultsData(
      { name: 'ORC Render Test', venue: '' },
      [{ id: 'r1', raceNumber: 1, date: '2026-09-12', name: null }],
      [
        { rank: 1, competitor: { id: 'c1', sailNumber: 'IRL 2507', names: ['Impetuous'] }, racePoints: [1], raceCodes: [null], totalPoints: 1, netPoints: 1, raceDiscards: [false] },
        { rank: 2, competitor: { id: 'c2', sailNumber: 'IRL 1551', names: ['Mojo'] }, racePoints: [2], raceCodes: [null], totalPoints: 2, netPoints: 2, raceDiscards: [false] },
      ],
      new Map([['r1', scores]]),
      new Map([
        ['c1', { sailNumber: 'IRL 2507', names: ['Impetuous'] }],
        ['c2', { sailNumber: 'IRL 1551', names: ['Mojo'] }],
      ]),
      [],
      new Date('2026-09-12T18:00:00Z'),
      'Class 2',
      {
        raceStarts: [{ raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' }],
        fleetId: 'f1',
        scoringSystem: 'orc',
      },
    );
    const html = renderSeriesHtml(data);
    expect(html).toContain('Scored on an ORC certificate rating');
    expect(html).toContain('Rating field APHT');
    expect(html).toContain('<th>TCC</th>');
    expect(html).toContain('>0.963</td>');
    expect(html).not.toContain('Scratch allowance');
    expect(html).not.toContain('<th>Implied wind</th>');
  });
});
