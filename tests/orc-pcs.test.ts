import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { scorePcsRace, type PcsAllowances, type PcsCourse, type PcsLeg } from '@/lib/orc-pcs';
import { parseRmsAllowances } from '@/lib/orc-pcs/rms';

/**
 * Parity suite: every fixture pair under tests/fixtures/orc-pcs/ is a race
 * scored by ORC's own PCS service (WPCS.dll, module 1.4.0.10 — the online
 * twin of the public-domain DLL this module ports) with the request as
 * submitted and the response as returned. The port must reproduce the
 * service's implied winds, allowances, course curves, and corrected times.
 *
 * pcs-wl / pcs-cc / pcs-cc-current / pcs-cc-boatiw use the five real 2026
 * IRL certificates from tests/fixtures/orc (JSON-embedded boats, nine wind
 * speeds); ar.xml is ORC's own example from the TestPCS package (RMS-format
 * boats, eight wind speeds, scored per rule 402.10).
 *
 * pcs-cc-fixedwind is pcs-cc's course with a wind speed on every leg — the
 * module's "fixed wind speed" regime (spec: any leg carrying windSpeed makes
 * the whole race one), where the curve is flat, the implied wind is the
 * distance-weighted average of the leg winds, and the allowance is the
 * course read at that wind rather than at one derived from the finishes.
 * This is the arithmetic behind the recorded-wind scoring options.
 */

const FIXTURE_DIR = join(process.cwd(), 'tests/fixtures/orc-pcs');

function unescapeXml(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`${name}="([^"]*)"`)) ?? tag.match(new RegExp(`${name}='([^']*)'`));
  return m ? unescapeXml(m[1]) : undefined;
}

interface FixtureRace {
  course: PcsCourse;
  useBoatImpliedWind: boolean;
  boats: Array<{ id: string; allowances: PcsAllowances; elapsedSeconds: number }>;
  expected: Array<{
    impliedWind: number;
    tod: number;
    correctedSeconds: number;
    curve: number[];
  }>;
}

function loadFixture(name: string): FixtureRace {
  const request = readFileSync(join(FIXTURE_DIR, `${name}.xml`), 'utf-8');
  const response = readFileSync(join(FIXTURE_DIR, `${name}-response.xml`), 'utf-8');

  const raceTag = request.match(/<race [^>]*>/)![0];
  const start = Date.parse(attr(raceTag, 'start')!);
  const type = attr(raceTag, 'type') ?? '0';
  const distance = Number(attr(raceTag, 'distance') ?? '0');
  const useBoatImpliedWind = ['1', 'yes', 'true', 't', 'y'].includes(
    (attr(raceTag, 'useboatiw') ?? '').toLowerCase(),
  );

  const legs: PcsLeg[] = [...request.matchAll(/<leg [^>]*\/>/g)].map(([tag]) => ({
    distanceNm: Number(attr(tag, 'distance')),
    courseDeg: Number(attr(tag, 'course')),
    windDirectionDeg: Number(attr(tag, 'windDirection')),
    // The module treats windSpeed="0" as absent, so the fixture's zeros must
    // not become a fixed-wind course here either.
    ...(Number(attr(tag, 'windSpeed') ?? '0') > 0
      ? { windSpeedKts: Number(attr(tag, 'windSpeed')) }
      : {}),
    ...(attr(tag, 'currentSpeed') != null
      ? {
          currentSpeedKts: Number(attr(tag, 'currentSpeed')),
          currentDirectionDeg: Number(attr(tag, 'currentDirection')),
        }
      : {}),
  }));

  const model = type === '1' ? 'WL' : type === '2' ? 'OC' : type === '4' ? 'CR' : null;
  const course: PcsCourse = model ? { model, distanceNm: distance } : { legs };

  const boats = [...request.matchAll(/<boat [^>]*\/>/g)].map(([tag], i) => {
    const rms = attr(tag, 'rms')!;
    const allowances: PcsAllowances = rms.trimStart().startsWith('{')
      ? (JSON.parse(rms) as { Allowances: PcsAllowances }).Allowances
      : parseRmsAllowances(rms);
    const finish = Date.parse(attr(tag, 'finish')!);
    return { id: `boat-${i}`, allowances, elapsedSeconds: (finish - start) / 1000 };
  });

  const expected = [...response.matchAll(/<boat [^>]*\/>/g)].map(([tag]) => ({
    impliedWind: Number(attr(tag, 'impliedWind')),
    tod: Number(attr(tag, 'tod')),
    correctedSeconds: Number(attr(tag, 'correctedSeconds')),
    curve: attr(tag, 'constructedCourseVector')!.split(',').map(Number),
  }));

  expect(expected).toHaveLength(boats.length);
  return { course, useBoatImpliedWind, boats, expected };
}

function expectRel(actual: number, reference: number, relTol: number, label: string): void {
  const scale = Math.max(1, Math.abs(reference));
  expect(Math.abs(actual - reference) / scale, `${label}: ${actual} vs ${reference}`).toBeLessThan(relTol);
}

// No service fixture covers tidal current: the module spec marks the XML
// current attributes "currently ignored — not implemented", so the current
// correction is validated against the reference code path behaviourally
// below rather than against WPCS.dll.
const PARITY_FIXTURES = ['pcs-wl', 'pcs-cc', 'pcs-cc-fixedwind', 'pcs-cc-boatiw', 'ar'];

describe('orc-pcs parity with the ORC PCS service', () => {
  for (const name of PARITY_FIXTURES) {
    it(`reproduces ${name}`, () => {
      const fixture = loadFixture(name);
      const result = scorePcsRace({
        course: fixture.course,
        boats: fixture.boats,
        useBoatImpliedWind: fixture.useBoatImpliedWind,
      });

      result.boats.forEach((boat, i) => {
        const want = fixture.expected[i];
        expect(boat.error, `boat ${i} error`).toBeUndefined();
        // Implied wind is published to 5 dp.
        expect(Math.abs(boat.impliedWind! - want.impliedWind), `boat ${i} impliedWind`).toBeLessThan(1.1e-5);
        // The reference zeroes each boat's ToD in its 402.10 branch, so the
        // service publishes tod="0" there; this port keeps the value.
        if (!fixture.useBoatImpliedWind) {
          expectRel(boat.todAtScoringWind, want.tod, 1e-9, `boat ${i} tod`);
        }
        // The service's elapsed seconds pass through Delphi TDateTime, which
        // leaves ~1e-7 s of float noise on otherwise-integer values.
        expect(Math.abs(boat.correctedSeconds! - want.correctedSeconds), `boat ${i} correctedSeconds`).toBeLessThan(1e-3);
        expect(boat.curve, `boat ${i} curve length`).toHaveLength(want.curve.length);
        boat.curve.forEach((v, j) => expectRel(v, want.curve[j], 1e-9, `boat ${i} curve[${j}]`));
      });
    });
  }
});

describe('orc-pcs behaviour', () => {
  const fixture = loadFixture('pcs-wl');

  it('the scoring wind is the best implied wind, and the scratch boat corrects to its elapsed time', () => {
    const result = scorePcsRace({ course: fixture.course, boats: fixture.boats });
    const bestIw = Math.max(...result.boats.map((b) => b.impliedWind!));
    expect(result.scoringWind).toBeCloseTo(bestIw, 9);
    const scratch = result.boats.find((b) => b.id === result.scratchBoatId)!;
    expect(scratch.todAtScoringWind).toBeCloseTo(result.scratchTod, 9);
  });

  it('a race-committee scoring-wind override (402.12) replaces the implied wind', () => {
    const result = scorePcsRace({
      course: fixture.course,
      boats: fixture.boats,
      scoringWindOverride: 12,
    });
    expect(result.scoringWind).toBe(12);
    // Overrides clamp to the certificate's tabulated range.
    expect(
      scorePcsRace({ course: fixture.course, boats: fixture.boats, scoringWindOverride: 50 }).scoringWind,
    ).toBe(24);
    expect(
      scorePcsRace({ course: fixture.course, boats: fixture.boats, scoringWindOverride: 1 }).scoringWind,
    ).toBe(4);
  });

  it('tidal current on a leg moves the curve the right way', () => {
    const cc = loadFixture('pcs-cc');
    if (!('legs' in cc.course)) throw new Error('expected a constructed course');
    const legs = cc.course.legs;
    const plain = scorePcsRace({ course: { legs }, boats: cc.boats });
    // A fair (following) current along the first leg: the boat covers the
    // leg faster, so its allowance at every wind speed drops.
    const fair = legs.map((leg, i) =>
      i === 0 ? { ...leg, currentDirectionDeg: leg.courseDeg, currentSpeedKts: 1.5 } : leg,
    );
    const withFair = scorePcsRace({ course: { legs: fair }, boats: cc.boats });
    for (let j = 0; j < plain.boats[0].curve.length; j++) {
      expect(withFair.boats[0].curve[j]).toBeLessThan(plain.boats[0].curve[j]);
    }
    // A foul current reverses the effect.
    const foul = legs.map((leg, i) =>
      i === 0 ? { ...leg, currentDirectionDeg: leg.courseDeg + 180, currentSpeedKts: 1.5 } : leg,
    );
    const withFoul = scorePcsRace({ course: { legs: foul }, boats: cc.boats });
    for (let j = 0; j < plain.boats[0].curve.length; j++) {
      expect(withFoul.boats[0].curve[j]).toBeGreaterThan(plain.boats[0].curve[j]);
    }
  });

  it('a wind speed on every leg fixes the wind: a flat curve, and the implied wind is the legs\' own', () => {
    const cc = loadFixture('pcs-cc');
    if (!('legs' in cc.course)) throw new Error('expected a constructed course');
    // Half the course at 8 kt and half at 12, by distance — so the weighted
    // average is not either of them, and lands off every tabulated speed.
    const total = cc.course.legs.reduce((sum, leg) => sum + leg.distanceNm, 0);
    let covered = 0;
    const legs = cc.course.legs.map((leg) => {
      covered += leg.distanceNm;
      return { ...leg, windSpeedKts: covered <= total / 2 ? 8 : 12 };
    });
    const expected =
      legs.reduce((sum, leg) => sum + leg.windSpeedKts * leg.distanceNm, 0) / total;

    const result = scorePcsRace({ course: { legs }, boats: cc.boats });
    expect(result.scoringWind).toBeCloseTo(expected, 9);
    for (const boat of result.boats) {
      // One allowance, at every tabulated wind speed: nothing about the race
      // is being read off the wind axis any more.
      expect(new Set(boat.curve.map((v) => v.toFixed(9))).size).toBe(1);
      expect(boat.todAtScoringWind).toBeCloseTo(boat.curve[0], 9);
      // Every boat's "implied wind" is that same average — which is why the
      // engine records it as the recorded wind and publishes no implied wind.
      expect(boat.impliedWind).toBeCloseTo(expected, 9);
    }
    // A flat curve is not invertible, so how fast a boat sailed cannot move
    // the wind the fleet is scored at.
    const slower = scorePcsRace({
      course: { legs },
      boats: cc.boats.map((boat) => ({ ...boat, elapsedSeconds: boat.elapsedSeconds * 2 })),
    });
    expect(slower.scoringWind).toBeCloseTo(expected, 9);
    expect(slower.scratchTod).toBeCloseTo(result.scratchTod, 9);
  });

  it('a leg wind speed outside the certificate\'s range clamps to its ends', () => {
    const cc = loadFixture('pcs-cc');
    if (!('legs' in cc.course)) throw new Error('expected a constructed course');
    const legs = cc.course.legs;
    const at = (kt: number) =>
      scorePcsRace({
        course: { legs: legs.map((leg) => ({ ...leg, windSpeedKts: kt })) },
        boats: cc.boats,
      });
    expect(at(1).boats[0].todAtScoringWind).toBeCloseTo(at(4).boats[0].todAtScoringWind, 9);
    expect(at(60).boats[0].todAtScoringWind).toBeCloseTo(at(24).boats[0].todAtScoringWind, 9);
  });

  it('a non-finisher still gets an allowance at the scoring wind but no implied wind', () => {
    const boats = fixture.boats.map((b, i) => (i === 0 ? { ...b, elapsedSeconds: undefined } : b));
    const result = scorePcsRace({ course: fixture.course, boats });
    expect(result.boats[0].impliedWind).toBeUndefined();
    expect(result.boats[0].correctedSeconds).toBeUndefined();
    expect(result.boats[0].todAtScoringWind).toBeGreaterThan(0);
  });
});
