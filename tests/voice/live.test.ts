import { describe, expect, it } from 'vitest';

import { createLiveReader, type Cue } from '@/lib/voice/live';

const ENTRIES = [
  { id: 'kestrel', sailNumber: 'IRL 1613' },
  { id: 'gannet', sailNumber: 'IRL 8338' },
  { id: 'puffin', sailNumber: 'IRL 2144' },
  { id: 'turnstone', sailNumber: 'IRL 9044' },
  { id: 'shearwater', sailNumber: 'IRL 3939' },
];

const T0 = Date.UTC(2026, 10, 22, 12, 0, 0);

function harness() {
  const cues: Cue[] = [];
  const reader = createLiveReader({ entries: ENTRIES, lagSeconds: 0.5, onCue: (c) => cues.push(c) });
  reader.beginTake(T0);
  /** The recogniser closes a stretch of words said from `at` seconds in, and
   *  the take runs on long enough for it to be answered. */
  const say = (text: string, at: number) => {
    const words = text.split(' ').map((w, i) => ({ w, t: at + i * 0.3 }));
    const end = words[words.length - 1].t;
    reader.heard({ words, closed: true, heard: end + 0.4 });
    reader.heard({ words: [], closed: false, heard: end + 3 });
  };
  return { reader, cues, say };
}

describe('createLiveReader', () => {
  it('answers each sail number with the tone for how sure it is', () => {
    const { cues, say } = harness();
    say('sixteen thirteen', 1);
    say('forty four', 10);
    say('thirty nine thirty nein', 20);
    say('sixty eight', 30);
    expect(cues).toEqual(['ok', 'doubt', 'check', 'doubt']);
  });

  it('clicks for a word called out after a sail number, and says nothing for talk', () => {
    const { cues, say } = harness();
    say('here they come', 0);
    say('eight three three eight', 5);
    say('mow', 8);
    say('okay', 9.5);
    expect(cues).toEqual(['ok', 'mark']);
  });

  it('waits for the pause after a sail number before answering it', () => {
    const { reader, cues } = harness();
    reader.heard({ words: [{ w: 'sixteen', t: 1 }, { w: 'thirteen', t: 1.3 }], closed: true, heard: 1.7 });
    expect(cues).toEqual([]);
    reader.heard({ words: [], closed: false, heard: 4.5 });
    expect(cues).toEqual(['ok']);
  });

  it('puts words on the phone’s clock as the recogniser placed them, and keeps the unfinished at the end', () => {
    const { reader } = harness();
    reader.heard({ words: [{ w: 'sixteen', t: 1 }], closed: true, heard: 1.4 });
    reader.heard({ words: [{ w: 'thir', t: 1.3 }], closed: false, heard: 1.6 });
    expect(reader.words()).toEqual([{ w: 'sixteen', at: T0 + 1000 }]);
    expect(reader.open()).toEqual([{ w: 'thir', at: T0 + 1300 }]);
    reader.endTake();
    expect(reader.words().map((w) => w.w)).toEqual(['sixteen', 'thir']);
  });
});
