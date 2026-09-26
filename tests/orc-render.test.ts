import { describe, expect, it } from 'vitest';

import {
  assembleSeriesResultsData,
  renderCombinedSeriesHtml,
  renderSeriesHtml,
} from '@/lib/results-renderer';
import type { OrcCertData, OrcCourseLeg, OrcRaceCalc, RaceStartCourse } from '@/lib/types';

import sampleCerts from '@/scripts/data/orc-sample-certs.json';

import type { CourseBackground } from '@sailscoring/course-cards';

/** Howth's captured chart as the publish path hands it over: the bounds and
 *  pixel size of the set's map/background.png, with bytes standing in for
 *  the image. */
const hycChart: CourseBackground = {
  png: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3]),
  bounds: { south: 53.378333, west: -6.117948, north: 53.465167, east: -6.004886 },
  width: 1317,
  height: 1698,
  attribution: '© OpenStreetMap contributors · © OpenSeaMap contributors',
};

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
  raceStarts?: Array<{ raceId: string; fleetIds: string[]; startTime?: string; courseLegs?: OrcCourseLeg[]; course?: RaceStartCourse }>;
  /** The captured charts the publish path loads, by data set. */
  courseBackgrounds?: ReadonlyMap<string, CourseBackground>;
  /** Certificates on the competitors — without them there is no allowance
   *  matrix to mix, and the handicap-mix fold is correctly absent. */
  certs?: boolean;
}) {
  // The applied rating is the ToT where the option applies one, and the
  // allowance otherwise — the same choice the engine makes.
  const applied = (id: string) => options.orc(id).totApplied ?? options.orc(id).todApplied;
  const scores = new Map([
    ['c1', { points: 1, place: 1, rank: 1, resultCode: null, finishTime: '15:00:00', tcfApplied: applied('c1'), elapsedTime: 3600, correctedTime: 3591, orc: options.orc('c1') }],
    ['c2', { points: 2, place: 2, rank: 2, resultCode: null, finishTime: '15:01:00', tcfApplied: applied('c2'), elapsedTime: 3660, correctedTime: 3612, orc: options.orc('c2') }],
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
      ...(options.courseBackgrounds ? { courseBackgrounds: options.courseBackgrounds } : {}),
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
    // Nothing to fetch and nothing to run: a course off marks with no data
    // set behind them is drawn on plain ground.
    expect(block).not.toMatch(/<script|<style|<image|href=/);
  });

  /** A constructed course off Howth's marks, which its chart covers. */
  const chartedCourse = () =>
    assemble({
      orc: (id) => ({
        todApplied: id === 'c1' ? 600 : 620,
        scratchTod: 600,
        distanceNm: 1.08,
        courseModel: 'CC',
      }),
      courseBackgrounds: new Map([['hyc/al-2026', hycChart]]),
      raceStarts: [{
        raceId: 'r1',
        fleetIds: ['f1'],
        startTime: '14:00:00',
        courseLegs: [{ distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 }],
        course: {
          name: 'W/L — 12 Sep R1',
          windDirectionDeg: 190,
          waypoints: [
            { markId: 'line', label: 'Start', lat: 53.4055, lng: -6.0675 },
            { markId: 'z', label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port', fixed: true, set: 'hyc/al-2026' },
            { markId: 'line', label: 'Start', lat: 53.4055, lng: -6.0675, side: 'port' },
          ],
        },
      }],
    });
  const chartImages = (html: string) => html.match(/<image href="data:image\/png;base64,[A-Za-z0-9+/=]+"/g) ?? [];

  it('draws a published course on its club’s chart, carried in the page', () => {
    const html = renderSeriesHtml(chartedCourse());
    const from = html.indexOf('<div class="orc-course-drawing"');
    const block = html.slice(from, html.indexOf('</div>', from));
    // The drawing refers to the chart; the page carries it, once.
    expect(block).toContain('<use href="#course-chart-hyc-al-2026"');
    expect(block).not.toContain('data:');
    expect(chartImages(html)).toHaveLength(1);
    expect(html).toContain('<symbol id="course-chart-hyc-al-2026"');
    // And the attribution its tile sources require.
    expect(block).toContain('© OpenStreetMap contributors · © OpenSeaMap contributors');
    // Still inert, and still nothing fetched: the drawing's one href is the
    // symbol on this page.
    expect(block).not.toMatch(/<script|<style/);
    expect((block.match(/href=/g) ?? []).length).toBe(1);
    // And the course is drawn over it as it always was.
    expect(block).toMatch(/<tspan font-weight="700">1<\/tspan> 190° 0\.54 NM/);
    expect(block).toContain('>Z</text>');
  });

  it('carries a chart once however many drawings on the page use it', () => {
    const html = renderCombinedSeriesHtml([chartedCourse(), chartedCourse()], { pageName: 'ORC' });
    expect((html.match(/<use href="#course-chart-hyc-al-2026"/g) ?? []).length).toBe(2);
    expect(chartImages(html)).toHaveLength(1);
  });

  it('carries no chart on a page that shows no drawing', () => {
    const html = renderCombinedSeriesHtml([chartedCourse()], { pageName: 'ORC', detail: 'standings' });
    expect(html).not.toContain('orc-course-drawing');
    expect(html).not.toContain('course-chart-');
    expect(chartImages(html)).toHaveLength(0);
  });

  it('draws on plain ground when the course’s data set has no chart loaded', () => {
    const start = { lat: 53.4055, lng: -6.0675 };
    const html = renderSeriesHtml(
      assemble({
        orc: (id) => ({ todApplied: id === 'c1' ? 600 : 620, scratchTod: 600, distanceNm: 1.08, courseModel: 'CC' }),
        // A chart for a different club: this course's set is not in it.
        courseBackgrounds: new Map([['rcyc/keelboat-2026', hycChart]]),
        raceStarts: [{
          raceId: 'r1',
          fleetIds: ['f1'],
          startTime: '14:00:00',
          courseLegs: [{ distanceNm: 0.54, bearingDeg: 190, windDirectionDeg: 190 }],
          course: {
            name: 'W/L — 12 Sep R1',
            windDirectionDeg: 190,
            waypoints: [
              { markId: 'line', label: 'Start', lat: start.lat, lng: start.lng },
              { markId: 'z', label: 'Z', lat: 53.3967, lng: -6.0702, side: 'port', fixed: true, set: 'hyc/al-2026' },
            ],
          },
        }],
      }),
    );
    const from = html.indexOf('<div class="orc-course-drawing"');
    const block = html.slice(from, html.indexOf('</div>', from));
    expect(block).toContain('>Z</text>');
    expect(block).not.toMatch(/<image|href=/);
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

  /** A banded certificate race, with or without the series knowing what ORC
   *  calls the field it is scored on. */
  function bandedRaceHtml(catalog?: Record<string, { name: string; kind: 'tot'; countryId: string }>): string {
    const calc = (): OrcRaceCalc => ({ option: 'IRL_5B_AP_LM_TOT' });
    const scores = new Map([
      ['c1', { points: 1, place: 1, rank: 1, resultCode: null, finishTime: '15:00:00', tcfApplied: 0.9631, elapsedTime: 3600, correctedTime: 3467, orc: calc() }],
    ]);
    const data = assembleSeriesResultsData(
      { name: 'ORC Render Test', venue: '' },
      [{ id: 'r1', raceNumber: 1, date: '2026-09-12', name: null }],
      [
        { rank: 1, competitor: { id: 'c1', sailNumber: 'IRL 2507', names: ['Impetuous'] }, racePoints: [1], raceCodes: [null], totalPoints: 1, netPoints: 1, raceDiscards: [false] },
      ],
      new Map([['r1', scores]]),
      new Map([['c1', { sailNumber: 'IRL 2507', names: ['Impetuous'] }]]),
      [],
      new Date('2026-09-12T18:00:00Z'),
      'Class 2',
      {
        raceStarts: [{ raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00' }],
        fleetId: 'f1',
        scoringSystem: 'orc',
        ...(catalog ? { orcScoringOptions: catalog } : {}),
      },
    );
    return renderSeriesHtml(data);
  }

  it('names a certificate option the way the certificate does (#602)', () => {
    // "IRL_5B_AP_LM_TOT" is a JSON key. The certificate calls it "5-Band All
    // Purpose L/M", which is what the race committee announces and what a
    // scorer looks for.
    const html = bandedRaceHtml({
      IRL_5B_AP_LM_TOT: { name: '5-Band All Purpose L/M', kind: 'tot', countryId: 'IRL' },
    });
    expect(html).toContain('Rating field 5-Band All Purpose L/M');
    expect(html).not.toContain('IRL_5B_AP_LM_TOT');
  });

  it('falls back to the field name when the series has no catalog', () => {
    // Certificates imported before the catalog was stored: the page reads as
    // it always did rather than saying nothing.
    expect(bandedRaceHtml()).toContain('Rating field IRL_5B_AP_LM_TOT');
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

  it('is the certificate\u2019s own table, with the rating in the cells', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(12), certs: true }));
    const grid = gridOf(html);
    // Every row the certificate prints, in its order — including the eight
    // a windward/leeward race never touches.
    for (const label of ['Beat VMG', '52\u00b0', '90\u00b0', '150\u00b0', 'Run VMG']) {
      expect(grid).toContain(`<th scope="row">${label}</th>`);
    }
    expect(grid).toContain('<th>4</th>');
    expect(grid).toContain('<th>24</th>');
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

  it('weights a constructed course by the angles its legs were sailed at', () => {
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
    // One leg dead downwind and one 2° off dead upwind, equal distances:
    // the two VMG rows take essentially the whole rating between them.
    expect(grid).toMatch(/<th scope="row">Beat VMG<\/th>(?:(?!<\/tr>).)*>50</);
    expect(grid).toMatch(/<th scope="row">Run VMG<\/th>(?:(?!<\/tr>).)*>50</);
  });

  it('says nothing at all without a certificate to read', () => {
    const html = renderSeriesHtml(assemble({ orc: wlCalc(12) }));
    expect(html).toContain('Scored on ORC performance curves');
    expect(html).not.toContain('Show handicap mix');
  });

  it('spreads an all-purpose race across every row', () => {
    const html = renderSeriesHtml(
      assemble({ orc: (id) => ({ ...wlCalc(12)(id), courseModel: 'CR', option: 'CR' }), certs: true }),
    );
    expect(html).toContain('All-purpose course model');
    const grid = gridOf(html);
    // Equal distance at every wind direction, so every row carries some of
    // the rating — read off the course totals, since at a tabulated scoring
    // wind only the one column is lit either way.
    const totals = [...grid.matchAll(/<td class="mtot">([\d.]+)<\/td>/g)].map((m) => Number(m[1]));
    expect(totals).toHaveLength(10);
    for (const t of totals) expect(t).toBeGreaterThan(0);
  });

  it('says nothing for a course model the weights are not defined over', () => {
    const html = renderSeriesHtml(
      assemble({ orc: (id) => ({ ...wlCalc(12)(id), courseModel: 'OC', option: 'OC' }), certs: true }),
    );
    expect(html).toContain('Coastal course model');
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

describe('published transparency for a recorded-wind race', () => {
  const legs: OrcCourseLeg[] = [
    { distanceNm: 2.09, bearingDeg: 162, windDirectionDeg: 225, windSpeedKts: 9 },
    { distanceNm: 0.19, bearingDeg: 316, windDirectionDeg: 225, windSpeedKts: 9 },
  ];
  const totCalc = (id: string): OrcRaceCalc => ({
    option: 'CC_TOT',
    todApplied: id === 'c1' ? 650 : 671,
    totApplied: id === 'c1' ? 0.9231 : 0.8942,
    distanceNm: 2.28,
    scoringWind: 9,
    windRecorded: true,
    courseModel: 'CC',
  });
  const starts = (courseLegs: OrcCourseLeg[]) => [
    { raceId: 'r1', fleetIds: ['f1'], startTime: '14:00:00', courseLegs },
  ];

  it('names the wind as recorded, the correction applied, and no implied wind', () => {
    const html = renderSeriesHtml(assemble({ orc: totCalc, raceStarts: starts(legs) }));
    expect(html).toContain('Scored on ORC performance curves at the recorded wind');
    expect(html).toContain('Wind 9.00 kt');
    expect(html).toContain('Time-on-time');
    // Nothing was derived from how the boats sailed, so nothing claims to be.
    expect(html).not.toContain('implied wind');
    expect(html).not.toContain('<th>Implied wind</th>');
    expect(html).not.toContain('Scratch allowance');
    // The rating is a multiplier, to the four decimals ORC publishes.
    expect(html).toContain('<th>ToT</th>');
    expect(html).toContain('>0.9231</td>');
    expect(html).toContain('>0.8942</td>');
  });

  it("records each leg's wind speed beside its bearing", () => {
    const html = renderSeriesHtml(assemble({ orc: totCalc, raceStarts: starts(legs) }));
    expect(html).toContain('2.09 NM @ 162&deg; (wind 225&deg; at 9 kt)');
    expect(html).toContain('0.19 NM @ 316&deg; (wind 225&deg; at 9 kt)');
  });

  it('the handicap mix says what the weights are the allowance for', () => {
    const html = renderSeriesHtml(assemble({ orc: totCalc, raceStarts: starts(legs), certs: true }));
    expect(html).toContain('Show handicap mix');
    expect(html).toContain('at the wind recorded on the course, 9.00 kt');
    expect(html).toContain('A time-on-time rating is 600 divided by the applied allowance.');
    expect(html).not.toContain('the allowance the fleet was corrected on');
  });

  it('publishes the course drawn from the legs alone, captioned as unlocated', () => {
    // The snapshot a start keeps of a course defined by the committee's leg
    // table: no waypoints, and the table it gave.
    const html = renderSeriesHtml(assemble({
      orc: totCalc,
      raceStarts: [{
        raceId: 'r1',
        fleetIds: ['f1'],
        startTime: '14:00:00',
        courseLegs: legs,
        course: {
          courseId: 'c-legs',
          name: 'RC table — 12 Sep R1',
          waypoints: [],
          legs: legs.map((l) => ({ distanceNm: l.distanceNm, bearingDeg: l.bearingDeg })),
          windDirectionDeg: 225,
          windSpeedKts: 9,
        },
      }],
    }));
    // Drawn, folded away beside the leg record like any other course.
    expect(html).toContain('<details class="orc-course"><summary>Show course</summary>');
    expect(html).toContain('class="orc-course-drawing"');
    expect(html).toContain('<svg xmlns="http://www.w3.org/2000/svg"');
    expect(html).toContain('aria-label="Course RC table — 12 Sep R1"');
    // And captioned, because on a page a located drawing and an unlocated
    // one are otherwise indistinguishable.
    expect(html).toContain('the course&rsquo;s position on the water is not recorded');
    // Inert, as every published drawing must be.
    const svg = html.slice(html.indexOf('<svg xmlns'), html.indexOf('</svg>'));
    expect(svg).not.toMatch(/<script|href=|xlink:href/i);
  });

  it('a course drawn from marks carries no such caption', () => {
    const html = renderSeriesHtml(assemble({
      orc: totCalc,
      raceStarts: [{
        raceId: 'r1',
        fleetIds: ['f1'],
        startTime: '14:00:00',
        courseLegs: legs,
        course: {
          name: 'W/L — 12 Sep',
          waypoints: [
            { label: 'Start', lat: 53.4055, lng: -6.0675 },
            { label: 'Z', lat: 53.3967, lng: -6.0702 },
            { label: 'Start', lat: 53.4055, lng: -6.0675 },
          ],
          windDirectionDeg: 225,
        },
      }],
    }));
    expect(html).toContain('class="orc-course-drawing"');
    expect(html).not.toContain('position on the water is not recorded');
  });

  it('legs recorded at different wind speeds get no mix', () => {
    const mixed = legs.map((leg, i) => ({ ...leg, windSpeedKts: i === 0 ? 8 : 14 }));
    const html = renderSeriesHtml(assemble({ orc: totCalc, raceStarts: starts(mixed), certs: true }));
    expect(html).toContain('Scored on ORC performance curves at the recorded wind');
    expect(html).not.toContain('Show handicap mix');
  });

  it('the time-on-distance form keeps the scratch allowance and the ToD column', () => {
    const todCalc = (id: string): OrcRaceCalc => ({
      option: 'CC_TOD',
      todApplied: id === 'c1' ? 650 : 671,
      scratchTod: 650,
      distanceNm: 2.28,
      scoringWind: 9,
      windRecorded: true,
      courseModel: 'CC',
    });
    const html = renderSeriesHtml(assemble({ orc: todCalc, raceStarts: starts(legs) }));
    expect(html).toContain('Time-on-distance');
    expect(html).toContain('Scratch allowance 650.0 s/NM');
    expect(html).toContain('<th>ToD</th>');
    expect(html).not.toContain('<th>Implied wind</th>');
  });
});
