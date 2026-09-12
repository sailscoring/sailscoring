import { describe, expect, it } from 'vitest';

import {
  assembleSeriesResultsData,
  renderSeriesHtml,
} from '@/lib/results-renderer';
import type { OrcCertData, OrcRaceCalc, RaceStartCourse } from '@/lib/types';

import sampleCerts from '@/scripts/data/orc-sample-certs.json';

/**
 * The published ORC audit trail: every PCS/ToD race table carries the line a
 * competitor needs to reproduce their corrected time — scoring wind and its
 * source, course, scratch allowance — plus the implied-wind column and, for
 * constructed courses, the leg-by-leg course record.
 */

/** A real 2026 IRL certificate from the sample-series rating seed. The seed
 *  records carry no import stamp — they were frozen, not imported — so one
 *  is supplied here to make them the shape a competitor actually holds. */
function certFor(yachtName: string): OrcCertData {
  const found = (sampleCerts.records as Array<{ record: { YachtName: string } }>).find(
    (r) => r.record.YachtName === yachtName,
  );
  if (!found) throw new Error(`no sample certificate for ${yachtName}`);
  return { ...found, importedAt: 0 } as unknown as OrcCertData;
}

/** The rendered grid alone — the stylesheet mentions the same class names. */
function gridOf(html: string): string {
  const from = html.indexOf('<table class="orc-mix-grid">');
  return html.slice(from, html.indexOf('</table>', from));
}

function assemble(options: {
  orc: (id: string) => OrcRaceCalc;
  raceStarts?: Array<{ raceId: string; fleetIds: string[]; startTime?: string; courseLegs?: Array<{ distanceNm: number; bearingDeg: number; windDirectionDeg: number }>; course?: RaceStartCourse }>;
  /** Certificates on the competitors — without them there is no allowance
   *  matrix to mix, and the handicap-mix fold is correctly absent. */
  certs?: boolean;
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
      ['c1', { sailNumber: 'IRL 2507', boatName: 'Impetuous', names: ['Impetuous'], ...(options.certs ? { orcCert: certFor('IMPETUOUS') } : {}) }],
      ['c2', { sailNumber: 'IRL 1551', boatName: 'Mojo', names: ['Mojo'], ...(options.certs ? { orcCert: certFor('MOJO') } : {}) }],
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
    // No course was picked, so there is no drawing.
    expect(html).not.toContain('orc-course-drawing');
  });

  it('a constructed course picked from the library is drawn on the page, inertly', () => {
    const calc = (id: string): OrcRaceCalc => ({
      todApplied: id === 'c1' ? 600 : 620,
      scratchTod: 600,
      distanceNm: 1.08,
      impliedWind: 18.06,
      scoringWind: 18.06,
      courseModel: 'CC',
    });
    const start = { lat: 53.4055, lng: -6.0675 };
    const course: RaceStartCourse = {
      courseId: 'c1',
      name: 'W/L — 12 Sep R1',
      windDirectionDeg: 190,
      waypoints: [
        { markId: 'line', label: 'Start', lat: start.lat, lng: start.lng },
        { markId: 'z', label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port' },
        { markId: 'line', label: 'Start', lat: start.lat, lng: start.lng, side: 'port' },
      ],
    };
    const html = renderSeriesHtml(
      assemble({
        orc: calc,
        raceStarts: [{
          raceId: 'r1',
          fleetIds: ['f1'],
          startTime: '14:00:00',
          courseLegs: [
            { distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 },
            { distanceNm: 0.54, bearingDeg: 10, windDirectionDeg: 190 },
          ],
          course,
        }],
      }),
    );
    // Folded away: the legs line is the course record and stays on the page,
    // the drawing is the illustration and waits to be asked for.
    expect(html).toContain('<details class="orc-course"><summary>Show course</summary>');
    expect(html).not.toContain('<details class="orc-course" open');
    expect(html.indexOf('class="orc-course-legs"')).toBeLessThan(html.indexOf('<details class="orc-course"'));
    const from = html.indexOf('<div class="orc-course-drawing"');
    expect(from).toBeGreaterThan(-1);
    const block = html.slice(from, html.indexOf('</div>', from));
    expect(block).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(block).toContain('aria-label="Course W/L — 12 Sep R1"');
    expect(block).toMatch(/<tspan font-weight="700">1<\/tspan> 190° 0\.54 NM/);
    expect(block).toContain('>Z</text>');
    expect(block).not.toMatch(/<script|<style|<image|href=/);
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

/**
 * The handicap mix: which cells of the scratch boat's allowance matrix the
 * race's rating was mixed from, folded away beside the course.
 */
describe('published ORC handicap mix', () => {
  const wlCalc =
    (scoringWind: number) =>
    (id: string): OrcRaceCalc => ({
      todApplied: id === 'c1' ? 718.8 : 740.0,
      scratchTod: 718.8,
      distanceNm: 3.9,
      impliedWind: scoringWind,
      scoringWind,
      courseModel: 'WL',
      option: 'WL',
    });

  it('folds the grid away beside the course, closed', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(12), certs: true }));
    expect(html).toContain('<details class="orc-course orc-mix"><summary>Show handicap mix</summary>');
    expect(html).not.toContain('orc-mix" open');
    // After the course line it explains, not before it.
    expect(html.indexOf('class="orc-fleet-header"')).toBeLessThan(html.indexOf('Show handicap mix'));
  });

  it('names the scratch boat whose certificate the mix was read off', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(12), certs: true }));
    expect(html).toContain('Read off Impetuous&rsquo;s certificate, at a scoring wind of 12.00 kt.');
  });

  it('splits a windward/leeward model half beat, half run', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(12), certs: true }));
    const grid = gridOf(html);
    expect(grid).toContain('Beat<span>optimum VMG</span>');
    expect(grid).toContain('Run<span>optimum VMG</span>');
    // The scoring wind is tabulated, so the 12 kt column takes the lot: two
    // cells at 50% and, since no other column carries any, two row totals
    // reading the same.
    expect(grid.match(/>50<\/td>/g)).toHaveLength(4);
    expect(grid).toContain('>100</td>'); // the 12 kt wind weight

  });

  it('says the weights reproduce the rating when the scoring wind is tabulated', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(12), certs: true }));
    expect(html).toContain('The scoring wind landed on a tabulated speed');
    expect(html).toContain('718.8 s/NM');
  });

  it('says the grid only attributes the rating when it is not', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(11.5), certs: true }));
    expect(html).toContain('attributes the rating without reproducing it');
    // The spline reaches past its neighbours, so some weight goes negative.
    expect(html).toContain('class="mn');
  });

  // Printing two identical numbers and then insisting they differ reads as a
  // bug. Where the gap rounds away, the note says the weights come to the
  // applied allowance and keeps the caveat as a caveat.
  it('does not claim a difference the printed figures do not show', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(19.9), certs: true }));
    expect(html).toContain('the two agree to the tenth anyway');
    expect(html).not.toContain('attributes the rating without reproducing it');
  });

  it('gives a constructed course a row per leg, weighted by distance', () => {
    const html = renderSeriesHtml(
      assemble({
        orc: (id) => ({ ...wlCalc(12)(id), courseModel: 'CC' }),
        certs: true,
        raceStarts: [
          {
            raceId: 'r1',
            fleetIds: ['f1'],
            startTime: '14:00:00',
            courseLegs: [
              { distanceNm: 2.0, bearingDeg: 162, windDirectionDeg: 160 },
              { distanceNm: 2.0, bearingDeg: 340, windDirectionDeg: 160 },
            ],
          },
        ],
      }),
    );
    const grid = gridOf(html);
    expect(grid).toContain('Leg 1<span>2.00 NM · TWA 2° · beating</span>');
    expect(grid).toContain('Leg 2<span>2.00 NM · TWA 180° · running</span>');
  });

  it('says nothing at all without a certificate to read', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(12) }));
    expect(html).toContain('Scored on ORC performance curves');
    expect(html).not.toContain('Show handicap mix');
  });

  it('says nothing for a course model the weights are not defined over', () => {
    const html = renderSeriesHtml(
      assemble({ orc: (id) => ({ ...wlCalc(12)(id), courseModel: 'CR', option: 'CR' }), certs: true }),
    );
    expect(html).toContain('All-purpose course model');
    expect(html).not.toContain('Show handicap mix');
  });

  it('says nothing on a race with no scoring wind', () => {
    const html = renderSeriesHtml(
      assemble({ orc: () => ({ option: 'APHD', todApplied: 623, scratchTod: 623, distanceNm: 3.9 }), certs: true }),
    );
    expect(html).toContain('Scored on ORC time-on-distance');
    expect(html).not.toContain('Show handicap mix');
  });
});
