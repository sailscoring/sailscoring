import { describe, expect, it } from 'vitest';

import { raceResultPointsText, scoreDisplayText } from '@/lib/results-renderer';

describe('scoreDisplayText', () => {
  it('prints points to one decimal, with the code after', () => {
    expect(scoreDisplayText(4, null, null, null, false, false)).toBe('4.0');
    expect(scoreDisplayText(12, 'DNF', null, null, false, false)).toBe('12.0 DNF');
  });

  it('brackets a discard and spells redress as RDG(points)', () => {
    expect(scoreDisplayText(12, 'DNF', null, null, true, false)).toBe('(12.0 DNF)');
    expect(scoreDisplayText(3.5, null, null, null, false, true)).toBe('RDG(3.5)');
  });

  it('names a penalty with its amount, and a named DPI by its own name', () => {
    expect(scoreDisplayText(5, null, 'SCP', 20, false, false)).toBe('5.0 SCP(20%)');
    expect(scoreDisplayText(5, null, 'DPI', 2, false, false, 'TPO')).toBe('5.0 TPO(2pts)');
  });

  it('gives an SCP stated in points its points, not a percentage', () => {
    expect(scoreDisplayText(3, null, 'SCP', 2, false, false, undefined, true)).toBe('3.0 SCP(2pts)');
    expect(raceResultPointsText({ points: 3, resultCode: null, penaltyCode: 'SCP', penaltyOverride: 2, penaltyInPoints: true })).toBe('3.0 SCP(2pts)');
  });

  it('leaves the text unescaped: it is not HTML', () => {
    expect(scoreDisplayText(5, null, 'DPI', 2, false, false, 'A&B')).toBe('5.0 A&B(2pts)');
  });
});

describe('raceResultPointsText', () => {
  it('prints a race table points cell', () => {
    expect(raceResultPointsText({ points: 1, resultCode: null, penaltyCode: null, penaltyOverride: null })).toBe('1.0');
    expect(raceResultPointsText({ points: 9, resultCode: 'DNC', penaltyCode: null, penaltyOverride: null })).toBe('9.0 DNC');
    expect(raceResultPointsText({ points: 2.5, resultCode: 'RDG', penaltyCode: null, penaltyOverride: null })).toBe('2.5 RDG');
    expect(raceResultPointsText({ points: 3, resultCode: null, penaltyCode: 'ZFP', penaltyOverride: null })).toBe('3.0 ZFP');
  });
});
