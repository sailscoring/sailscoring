import { describe, expect, it } from 'vitest';

import { checkText, readTimeline, suggestFinishes, type Suggestion } from '@/lib/voice/timeline';
import type { VoiceDismissal, VoiceFinish, VoicePress, VoiceWord } from '@/lib/voice/types';

const ENTRIES = [
  { id: 'kestrel', sailNumber: 'IRL 1613' },
  { id: 'fulmar', sailNumber: 'IRL 1631' },
  { id: 'merlin', sailNumber: 'IRL 2016' },
  { id: 'gannet', sailNumber: 'IRL 8338' },
  { id: 'dunlin', sailNumber: 'IRL 4078' },
  { id: 'skua', sailNumber: 'IRL 7111' },
  { id: 'whimbrel', sailNumber: 'IRL 5522' },
  { id: 'kittiwake', sailNumber: 'IRL 2129' },
  { id: 'guillemot', sailNumber: 'IRL 1333' },
  { id: 'redshank', sailNumber: 'IRL 1975' },
  { id: 'shearwater', sailNumber: 'IRL 3939' },
  { id: 'puffin', sailNumber: 'IRL 2144' },
  { id: 'turnstone', sailNumber: 'IRL 9044' },
];

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);
const at = (seconds: number) => T0 + Math.round(seconds * 1000);

/** A recording made up of things said and pressed, `seconds` from T0. The
 *  recogniser's lag is taken as nothing, so a word's time is when it was said. */
function recording(script: ([number, string] | [number, 'NOW'])[]) {
  const words: VoiceWord[] = [];
  const presses: VoicePress[] = [];
  for (const [s, what] of script) {
    if (what === 'NOW') presses.push({ id: `p${presses.length + 1}`, at: at(s) });
    else what.split(' ').forEach((w, i) => words.push({ w, at: at(s + i * 0.35) }));
  }
  return { words, presses, gaps: [] };
}

function suggest(
  script: Parameters<typeof recording>[0],
  options: { finishes?: VoiceFinish[]; dismissals?: VoiceDismissal[]; takesTime?: (id: string | null) => boolean } = {},
) {
  const tl = readTimeline(recording(script), ENTRIES, { lagSeconds: 0 });
  return { tl, ...suggestFinishes(tl, options) };
}

const brief = (s: Suggestion) => ({
  who: s.competitorId ?? s.sailNumber,
  at: (s.at - T0) / 1000,
  from: s.timeFrom,
  check: s.check?.why ?? null,
});

describe('readTimeline', () => {
  it('finds a sail number inside talk, and leaves talk as talk', () => {
    const { tl } = suggest([[0, 'here they come'], [5, 'first is four oh seven eight'], [12, 'two together coming up']]);
    expect(tl.snippets).toHaveLength(3);
    expect(tl.calls.map((c) => [c.competitorId, c.heard, c.from, c.to])).toEqual([['dunlin', 'four oh seven eight', 2, 6]]);
    expect(tl.snippets[0].calls).toEqual([]);
    expect(tl.snippets[2].calls).toEqual([]);
  });

  it('takes a word said in the same breath as a sail number as its NOW', () => {
    const { tl } = suggest([[0, 'sixteen thirteen now']]);
    expect(tl.snippets[0].nowWord).toBe(2);
    expect(tl.nows).toEqual([{ key: `w${at(0.7)}`, at: at(0.7), pressId: null, word: 'now' }]);
  });

  it('takes any single word soon after a sail number as its NOW, and a now-like word later', () => {
    const { tl } = suggest([[0, 'sixteen thirteen'], [4, 'mow'], [9, 'okay'], [20, 'twenty sixteen'], [45, 'now']]);
    expect(tl.nows.map((n) => [(n.at - T0) / 1000, n.word])).toEqual([[4, 'mow'], [45, 'now']]);
    expect(tl.snippets.filter((s) => s.isNow).map((s) => s.words.join(' '))).toEqual(['mow', 'now']);
  });

  it('makes a press of NOW and a word called out at the same moment one NOW, at the press', () => {
    const { tl } = suggest([[0, 'eight three three eight now'], [1.5, 'NOW']]);
    expect(tl.nows).toEqual([{ key: 'pp1', at: at(1.5), pressId: 'p1', word: 'now' }]);
  });

  it('marks a competitor called out again', () => {
    const { tl } = suggest([[0, 'eight three three eight'], [7, 'eight three three eight now']]);
    expect(tl.calls.map((c) => c.again)).toEqual([false, true]);
  });

  it('reads a close match from the whole snippet', () => {
    const { tl } = suggest([[0, 'thirty nine thirty nein']]);
    expect(tl.calls.map((c) => [c.competitorId, c.how])).toEqual([['shearwater', 'sounds']]);
  });

  it('takes the recogniser’s lag off every word', () => {
    const tl = readTimeline({ words: [{ w: 'sixteen', at: at(10.5) }, { w: 'thirteen', at: at(10.8) }], presses: [], gaps: [] }, ENTRIES, { lagSeconds: 0.5 });
    expect(tl.calls[0].at).toBe(at(10));
  });
});

describe('suggestFinishes', () => {
  it('pairs a sail number with the NOW after it, however long after', () => {
    const { suggestions } = suggest([[0, 'sixteen thirteen'], [20, 'NOW']]);
    expect(suggestions.map(brief)).toEqual([{ who: 'kestrel', at: 20, from: 'press', check: null }]);
  });

  it('pairs a sail number with "now" in the same breath', () => {
    const { suggestions } = suggest([[0, 'sixteen thirteen now']]);
    expect(suggestions.map(brief)).toEqual([{ who: 'kestrel', at: 0.7, from: 'spoken', check: null }]);
  });

  it('pairs a NOW with the sail number called out just after it', () => {
    const { suggestions } = suggest([[0, 'NOW'], [1.5, 'that was sixteen thirteen']]);
    expect(suggestions.map(brief)).toEqual([{ who: 'kestrel', at: 0, from: 'press', check: null }]);
  });

  it('pairs two sail numbers and two NOWs in order', () => {
    const { suggestions } = suggest([[0, 'seven one one one'], [3, 'and five five two two'], [9, 'NOW'], [9.8, 'NOW']]);
    expect(suggestions.map(brief)).toEqual([
      { who: 'skua', at: 9, from: 'press', check: null },
      { who: 'whimbrel', at: 9.8, from: 'press', check: null },
    ]);
  });

  it('pairs nothing when one NOW follows two sail numbers', () => {
    const { suggestions, offers, tl } = suggest([[0, 'twenty one twenty nine'], [4, 'and one three three three'], [11, 'NOW']]);
    expect(suggestions.map(brief)).toEqual([
      { who: 'kittiwake', at: 0, from: 'called', check: 'counts' },
      { who: 'guillemot', at: 4.35, from: 'called', check: 'counts' },
    ]);
    expect(offers).toEqual({ pp1: tl.calls.map((c) => c.key) });
    expect(checkText(suggestions[0], (id) => id)).toBe('One NOW for two sail numbers');
  });

  it('suggests a NOW with no sail number of its own, to check', () => {
    const { suggestions } = suggest([[0, 'sixteen thirteen now'], [0.8, 'NOW'], [11, 'NOW']]);
    expect(suggestions.map(brief)).toEqual([
      { who: 'kestrel', at: 0.8, from: 'press', check: null },
      { who: null, at: 11, from: 'press', check: 'no-sail-number' },
    ]);
  });

  it('pairs nothing when two NOWs follow one sail number', () => {
    const { suggestions, offers } = suggest([[0, 'sixteen thirteen'], [3, 'NOW'], [14, 'NOW']]);
    expect(suggestions.map(brief)).toEqual([{ who: 'kestrel', at: 0, from: 'called', check: 'counts' }]);
    expect(Object.keys(offers)).toEqual(['pp1', 'pp2']);
    expect(checkText(suggestions[0], (id) => id)).toBe('Two NOWs for one sail number');
  });

  it('merges a sail number called out again before its NOW', () => {
    const { suggestions } = suggest([[0, 'eight three three eight'], [7, 'eight three three eight now']]);
    expect(suggestions.map(brief)).toEqual([{ who: 'gannet', at: 8.4, from: 'spoken', check: null }]);
  });

  it('keeps a competitor in their place when called out again after their NOW', () => {
    const { suggestions } = suggest([[0, 'sixteen thirteen'], [3, 'NOW'], [8, 'twenty sixteen'], [12, 'yes sixteen thirteen'], [15, 'NOW']]);
    expect(suggestions.map(brief)).toEqual([
      { who: 'kestrel', at: 3, from: 'press', check: null },
      { who: 'merlin', at: 15, from: 'press', check: null },
    ]);
  });

  it('times a sail number with no NOW by its call, to check where the fleet needs times', () => {
    expect(suggest([[0, 'nineteen seventy five']]).suggestions.map(brief)).toEqual([
      { who: 'redshank', at: 0, from: 'called', check: 'called-time' },
    ]);
    expect(suggest([[0, 'nineteen seventy five']], { takesTime: () => false }).suggestions.map(brief)).toEqual([
      { who: 'redshank', at: 0, from: 'called', check: null },
    ]);
  });

  it('lets the fleets that need no time go without a NOW', () => {
    const takesTime = (id: string | null) => id !== 'whimbrel';
    const { suggestions } = suggest([[0, 'seven one one one'], [3, 'five five two two'], [9, 'NOW']], { takesTime });
    expect(suggestions.map(brief)).toEqual([
      { who: 'whimbrel', at: 3, from: 'called', check: null },
      { who: 'skua', at: 9, from: 'press', check: null },
    ]);
  });

  it('marks a close match and a number on no entry, with the NOW they had', () => {
    const { suggestions } = suggest([[0, 'thirty nine thirty nein'], [2, 'no'], [20, 'sixty eight'], [25, 'NOW']]);
    expect(suggestions.map(brief)).toEqual([
      { who: 'shearwater', at: 2, from: 'spoken', check: 'close-match' },
      { who: '68', at: 25, from: 'press', check: 'not-on-list' },
    ]);
    expect(checkText(suggestions[1], (id) => id)).toBe('Heard “sixty eight”: not on the entry list');
  });

  it('marks a number that fits several competitors, naming them', () => {
    const { suggestions } = suggest([[0, 'forty four'], [5, 'NOW']]);
    expect(suggestions.map((s) => [s.sailNumber, s.couldBe, s.check?.why])).toEqual([['44', ['puffin', 'turnstone'], 'could-be']]);
    expect(checkText(suggestions[0], (id) => id)).toBe('Could be puffin or turnstone');
  });

  it('leaves a number on no entry with no NOW as talk, where finishes are timed', () => {
    expect(suggest([[0, 'we had forty boats']]).suggestions).toEqual([]);
  });

  it('suggests nothing a person has decided, and pairs what is left', () => {
    const script: Parameters<typeof suggest>[0] = [[0, 'twenty one twenty nine'], [4, 'and one three three three'], [11, 'NOW']];
    const accepted: VoiceFinish = {
      id: 'f1', competitorId: 'kittiwake', sailNumber: null, at: at(11), timeFrom: 'press', pressId: 'p1', calledAt: at(0), removed: false,
    };
    expect(suggest(script, { finishes: [accepted] }).suggestions.map(brief)).toEqual([
      { who: 'guillemot', at: 4.35, from: 'called', check: 'called-time' },
    ]);
    const dismissed: VoiceDismissal = { pressId: null, spokenAt: null, calledAt: at(4.35) };
    expect(suggest(script, { finishes: [accepted], dismissals: [dismissed] }).suggestions).toEqual([]);
  });

  it('tells a decision’s call from one called out just after it', () => {
    const accepted: VoiceFinish = {
      id: 'f1', competitorId: 'kestrel', sailNumber: null, at: at(2), timeFrom: 'press', pressId: 'p1', calledAt: at(0), removed: false,
    };
    const { suggestions } = suggest([[0, 'sixteen thirteen'], [1.4, 'twenty sixteen']], { finishes: [accepted], takesTime: () => false });
    expect(suggestions.map(brief)).toEqual([{ who: 'merlin', at: 1.4, from: 'called', check: null }]);
  });

  it('doesn’t suggest again what a deleted finish took', () => {
    const removed: VoiceFinish = {
      id: 'f1', competitorId: 'kestrel', sailNumber: null, at: at(3), timeFrom: 'press', pressId: 'p1', calledAt: at(0), removed: true,
    };
    expect(suggest([[0, 'sixteen thirteen'], [3, 'NOW']], { finishes: [removed] }).suggestions).toEqual([]);
  });

  it('keeps a suggestion’s key while more is recorded after it', () => {
    const first = suggest([[0, 'sixteen thirteen'], [3, 'NOW']]).suggestions[0].key;
    const later = suggest([[0, 'sixteen thirteen'], [3, 'NOW'], [20, 'twenty sixteen'], [24, 'NOW']]).suggestions[0].key;
    expect(later).toBe(first);
  });
});
