import { describe, expect, it } from 'vitest';

import { createSession, LAG_SECONDS, type Cue, type SessionEvent } from '@/lib/voice/session';
import type { VoiceLine } from '@/lib/voice/types';

const ENTRIES = [
  { id: 'kestrel', sailNumber: 'IRL 1613' },
  { id: 'fulmar', sailNumber: 'IRL 1631' },
  { id: 'gannet', sailNumber: 'IRL 8338' },
  { id: 'tern', sailNumber: 'IRL 2144' },
  { id: 'skua', sailNumber: 'IRL 9144' },
];

// 12:00:00 on some day: the take starts here.
const T0 = Date.UTC(2026, 10, 14, 12, 0, 0);

function harness(options: { onSheet?: (id: string) => boolean; lines?: VoiceLine[]; lagSeconds?: number } = {}) {
  const events: SessionEvent[] = [];
  const cues: Cue[] = [];
  let n = 0;
  const session = createSession({
    entries: ENTRIES,
    newId: () => `line-${++n}`,
    onEvent: (e) => events.push(e),
    onCue: (c) => cues.push(c),
    ...options,
  });
  session.beginTake(T0);
  /** The recogniser closes a stretch of words said from `at` seconds in, and
   *  the take runs on long enough for it to be read. */
  const say = (text: string, at: number) => {
    const words = text.split(' ').map((w, i) => ({ w, t: at + i * 0.3 }));
    const end = words[words.length - 1].t;
    session.heard({ words, closed: true, heard: end + 0.4 });
    session.heard({ words: [], closed: false, heard: end + 3 });
  };
  const live = () => session.lines().filter((l) => !l.removed);
  return { session, events, cues, say, live };
}

const secondsIn = (line: VoiceLine) => (line.at - T0) / 1000;

describe('a voice session', () => {
  it('takes a boat with the time of the word after her number', () => {
    const h = harness();
    h.say('sixteen thirteen', 10);
    expect(h.live()).toMatchObject([{ how: 'whole', competitorId: 'kestrel', timeFrom: 'called' }]);
    expect(h.cues).toEqual(['ok']);

    h.say('mow', 12);
    const [line] = h.live();
    expect(line.timeFrom).toBe('word');
    expect(secondsIn(line)).toBeCloseTo(12 - LAG_SECONDS, 3);
    expect(h.cues).toEqual(['ok', 'mark']);
    expect(h.events.map((e) => e.type)).toEqual(['added', 'changed']);
  });

  it('falls back to the moment the number was called', () => {
    const h = harness();
    h.say('eight three three eight', 20);
    const [line] = h.live();
    expect(line.timeFrom).toBe('called');
    // The end of the number, less the recogniser's delay.
    expect(secondsIn(line)).toBeCloseTo(20 + 3 * 0.3 - LAG_SECONDS, 3);
    expect(line.heardAt).toBe(T0 + (20 - LAG_SECONDS) * 1000);
  });

  it('takes off the delay its model has, not the usual one', () => {
    const h = harness({ lagSeconds: 0.25 });
    h.say('sixteen thirteen', 10);
    h.say('mow', 12);
    expect(secondsIn(h.live()[0])).toBeCloseTo(12 - 0.25, 3);
  });

  it('prefers a press of Now to the word', () => {
    const h = harness();
    h.say('sixteen thirteen', 10);
    h.session.pressNow(T0 + 11_000);
    h.say('now', 11.4);
    const [line] = h.live();
    expect(line.timeFrom).toBe('tap');
    expect(line.at).toBe(T0 + 11_000);
  });

  it('gives a second press to a boat not yet called, never to an earlier call', () => {
    const h = harness();
    h.say('sixteen thirteen', 10);
    h.say('eight three three eight', 12);
    h.session.pressNow(T0 + 13_500);
    h.session.pressNow(T0 + 14_000);
    expect(h.live().map((l) => [l.competitorId, l.timeFrom])).toEqual([
      ['kestrel', 'called'],
      ['gannet', 'tap'],
      [null, 'tap'],
    ]);
    expect(h.live()[1].at).toBe(T0 + 13_500);
  });

  it('keeps a press with no call as a line, and lets the next call name her', () => {
    const h = harness();
    h.session.pressNow(T0 + 30_000);
    expect(h.live()).toMatchObject([{ how: 'tap', competitorId: null, at: T0 + 30_000 }]);
    const pressId = h.live()[0].id;

    h.say('sixteen thirty one', 33);
    expect(h.live()).toMatchObject([{ id: pressId, how: 'whole', competitorId: 'fulmar', at: T0 + 30_000, timeFrom: 'tap' }]);
    expect(h.events.map((e) => e.type)).toEqual(['added', 'changed']);
  });

  it('names three presses with three numbers, in order', () => {
    const h = harness();
    h.session.pressNow(T0 + 40_000);
    h.session.pressNow(T0 + 41_000);
    h.session.pressNow(T0 + 42_500);
    h.say('sixteen thirteen', 44);
    h.say('sixteen thirty one', 46);
    h.say('eight three three eight', 48);
    expect(h.live().map((l) => [l.competitorId, l.at - T0])).toEqual([
      ['kestrel', 40_000],
      ['fulmar', 41_000],
      ['gannet', 42_500],
    ]);
  });

  it('marks a sound-alike for checking and a shared ending for choosing', () => {
    const h = harness();
    h.say('eight tree tree eight', 5);
    h.say('one four four', 10);
    expect(h.live()).toMatchObject([
      { how: 'sounds', competitorId: 'gannet' },
      { how: 'ambiguous', competitorId: null, couldBe: ['tern', 'skua'], digits: '144' },
    ]);
    expect(h.cues).toEqual(['check', 'doubt']);
  });

  it('files a number on no entry as an unknown boat', () => {
    const h = harness();
    h.say('five five five five', 5);
    expect(h.live()).toMatchObject([{ how: 'unknown', competitorId: null, digits: '5555' }]);
    expect(h.cues).toEqual(['doubt']);
  });

  it('gives a boat called twice one line, and notes the second call', () => {
    const h = harness();
    h.say('sixteen thirteen', 10);
    h.say('sixteen thirteen', 30);
    expect(h.live()).toHaveLength(1);
    expect(h.live()[0].calledAgainAt).toHaveLength(1);
    expect(h.cues).toEqual(['ok', 'doubt']);
    expect(h.events.at(-1)).toMatchObject({ type: 'again', competitorId: 'kestrel' });
  });

  it('treats a boat typed onto the sheet by hand as already across', () => {
    const h = harness({ onSheet: (id) => id === 'gannet' });
    h.say('eight three three eight', 10);
    expect(h.live()).toHaveLength(0);
    expect(h.events).toMatchObject([{ type: 'again', competitorId: 'gannet', line: null }]);
  });

  it('takes the last line back, and lets her be called again', () => {
    const h = harness();
    h.say('sixteen thirteen', 10);
    h.say('eight three three eight', 14);
    expect(h.session.undo()).toMatchObject({ competitorId: 'gannet', removed: true });
    expect(h.live().map((l) => l.competitorId)).toEqual(['kestrel']);
    // The word after an undone call is not her time: there is no line for it.
    h.say('now', 16);
    expect(h.live()[0].timeFrom).toBe('called');

    h.say('eight three three eight', 20);
    expect(h.live().map((l) => l.competitorId)).toEqual(['kestrel', 'gannet']);
    // The recording keeps the call that was taken back.
    expect(h.session.lines()).toHaveLength(3);
  });

  it('ignores talk', () => {
    const h = harness();
    h.say('is that everyone', 5);
    h.say('i think there are for more to come', 9);
    expect(h.live()).toEqual([]);
    expect(h.cues).toEqual([]);
  });

  it('waits for a number to finish before reading it', () => {
    const h = harness();
    // Still being said: the recogniser has "sixteen" and nothing after yet.
    h.session.heard({ words: [{ w: 'sixteen', t: 10 }], closed: false, heard: 10.4 });
    expect(h.live()).toEqual([]);
    h.session.heard({ words: [{ w: 'sixteen', t: 10 }, { w: 'thirteen', t: 10.5 }], closed: false, heard: 11 });
    expect(h.live()).toEqual([]);
    h.session.heard({ words: [{ w: 'sixteen', t: 10 }, { w: 'thirteen', t: 10.5 }], closed: false, heard: 13 });
    expect(h.live()).toMatchObject([{ competitorId: 'kestrel' }]);
  });

  it('carries on from an earlier spell of listening', () => {
    const first = harness();
    first.say('sixteen thirteen', 10);
    const h = harness({ lines: first.session.lines() });
    h.say('sixteen thirteen', 5);
    h.say('eight three three eight', 9);
    expect(h.live().map((l) => l.competitorId)).toEqual(['kestrel', 'gannet']);
    expect(h.live()[0].calledAgainAt).toHaveLength(1);
  });

  it('reads what is left when the take ends, and keeps every word', () => {
    const h = harness();
    h.session.heard({ words: [{ w: 'sixteen', t: 10 }, { w: 'thirteen', t: 10.4 }], closed: false, heard: 10.8 });
    h.session.endTake();
    expect(h.live()).toMatchObject([{ competitorId: 'kestrel' }]);
    expect(h.session.words()).toEqual([{ w: 'sixteen', at: T0 + 10_000 }, { w: 'thirteen', at: T0 + 10_400 }]);
  });

  it('puts a second take on the phone’s clock', () => {
    const h = harness();
    h.say('sixteen thirteen', 10);
    h.session.endTake();
    h.session.beginTake(T0 + 120_000);
    h.say('eight three three eight now', 3);
    const [, second] = h.live();
    expect(second).toMatchObject({ competitorId: 'gannet', timeFrom: 'word' });
    expect(second.at).toBe(T0 + 120_000 + Math.round((3 + 4 * 0.3 - LAG_SECONDS) * 1000));
  });
});
