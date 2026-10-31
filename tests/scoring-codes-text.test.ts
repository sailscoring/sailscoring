import { describe, it, expect } from 'vitest';
import { codeRows, codesDifferingFromRrs, rrsCode, ruleSentence, ruleShortText } from '@/lib/scoring-codes-text';
import type { SeriesScoringCode } from '@/lib/types';

const TLE: SeriesScoringCode = {
  code: 'TLE',
  description: 'Time limit expired (SI 16.1)',
  kind: 'replace',
  rule: { type: 'placeAfter', base: 'finishers', plus: 1 },
  capAtDnf: true,
  discardable: true,
};
const SOP: SeriesScoringCode = { code: 'SOP', description: 'Failed to sign out (SI 19.1)', kind: 'add', rule: { type: 'addPoints', points: 2 }, discardable: true };

describe('the RRS codes as a series code', () => {
  it('puts DNF on the series’ A5 base, and the rest as DNF', () => {
    expect(rrsCode('DNF', 'seriesEntries').rule).toEqual({ type: 'placeAfter', base: 'entries', plus: 1 });
    expect(rrsCode('DNF', 'startingArea').rule).toEqual({ type: 'placeAfter', base: 'startingArea', plus: 1 });
    expect(rrsCode('OCS', 'startingArea').rule).toEqual({ type: 'sameAs', code: 'DNF' });
    expect(rrsCode('DNE', 'seriesEntries').discardable).toBe(false);
    expect(rrsCode('DNC', 'startingArea').rule).toEqual({ type: 'placeAfter', base: 'entries', plus: 1 });
    expect(rrsCode('ZFP', 'seriesEntries')).toMatchObject({ kind: 'add', rule: { type: 'addPercent', percent: 20 } });
  });
});

describe('the dialog’s rows', () => {
  it('lists the changeable built-ins, then the series’ own codes, by kind', () => {
    const { replace, add } = codeRows('startingArea', [TLE, SOP, { ...rrsCode('BFD', 'startingArea'), discardable: false }]);
    expect(replace.map((r) => r.code)).toEqual(['DNF', 'DNS', 'OCS', 'NSC', 'RET', 'DSQ', 'DNE', 'UFD', 'BFD', 'DNC', 'TLE']);
    expect(add.map((r) => r.code)).toEqual(['ZFP', 'SOP']);
    expect(replace.find((r) => r.code === 'BFD')!.status).toBe('changed');
    expect(replace.find((r) => r.code === 'DNF')!.status).toBe('rrs');
    expect(replace.find((r) => r.code === 'TLE')!).toMatchObject({ status: 'series', name: 'Time limit expired (SI 16.1)' });
  });

  it('calls a stored change that scores as the RRS does an RRS row', () => {
    const { replace } = codeRows('seriesEntries', [rrsCode('DSQ', 'seriesEntries')]);
    expect(replace.find((r) => r.code === 'DSQ')!.status).toBe('rrs');
  });

  it('lists only what differs from the RRS for publishing', () => {
    expect(codesDifferingFromRrs('seriesEntries', [TLE, rrsCode('DSQ', 'seriesEntries')]).map((r) => r.code)).toEqual(['TLE']);
  });
});

describe('a rule in words', () => {
  it('states it short for the table', () => {
    expect(ruleShortText(rrsCode('DNF', 'startingArea'))).toBe('came to the start + 1');
    expect(ruleShortText(rrsCode('DNS', 'startingArea'))).toBe('as DNF');
    expect(ruleShortText(rrsCode('DNE', 'startingArea'))).toBe('as DNF · not discardable');
    expect(ruleShortText(TLE)).toBe('finishers + 1, at most DNF');
    expect(ruleShortText(SOP)).toBe('2 points');
    expect(ruleShortText(rrsCode('ZFP', 'seriesEntries'))).toBe('20% of DNF');
  });

  it('states it in full for checking against the SIs', () => {
    expect(ruleSentence(TLE)).toBe(
      'A boat scored TLE gets points for the finishing place one more than the number of boats that finished in her fleet, but never more than a DNF. It can be discarded.',
    );
    expect(ruleSentence(SOP)).toBe(
      'A boat scored SOP has 2 points added to her score for the race, but is never scored worse than DNF. Other boats’ scores are unchanged. It can be discarded.',
    );
    expect(ruleSentence({ code: 'DNC', kind: 'replace', rule: { type: 'sameAs', code: 'DNF' }, discardable: true })).toBe(
      'A boat scored DNC scores the same as DNF. It can be discarded.',
    );
    expect(ruleSentence({ code: 'OOD', description: 'x', kind: 'replace', rule: { type: 'fixedPoints', points: 1 }, discardable: false })).toBe(
      'A boat scored OOD scores 1 point. It can’t be discarded.',
    );
  });
});

describe('the notes a published page carries', () => {
  it('states each code that differs from the RRS, with the RRS rule for a changed one', async () => {
    const { scoringCodeNotes } = await import('@/lib/scoring-codes-text');
    const dncAsDnf: SeriesScoringCode = { code: 'DNC', kind: 'replace', rule: { type: 'sameAs', code: 'DNF' }, discardable: true };
    expect(scoringCodeNotes('startingArea', [TLE, dncAsDnf, rrsCode('DSQ', 'startingArea')])).toEqual([
      { code: 'DNC', name: 'Did Not Come to start area', sentence: 'A boat scored DNC scores the same as DNF. It can be discarded.', rrs: 'series entries + 1' },
      { code: 'TLE', name: 'Time limit expired (SI 16.1)', sentence: ruleSentence(TLE) },
    ]);
  });

  it('lists only the codes the page uses', async () => {
    const { renderScoringCodeNotes } = await import('@/lib/results-renderer');
    const notes = [
      { code: 'TLE', name: 'Time limit expired', sentence: 'A boat scored TLE …' },
      { code: 'SOP', name: 'Failed to sign out', sentence: 'A boat scored SOP …' },
    ];
    const html = renderScoringCodeNotes(notes, new Set(['TLE', 'DNF']));
    expect(html).toContain('Scoring codes that differ from the RRS');
    expect(html).toContain('<strong>TLE</strong>');
    expect(html).not.toContain('SOP');
    expect(renderScoringCodeNotes(notes, new Set(['DNF']))).toBe('');
    expect(renderScoringCodeNotes(undefined)).toBe('');
  });
});
