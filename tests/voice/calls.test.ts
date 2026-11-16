import { describe, expect, it } from 'vitest';

import { callsFrom, digitCandidates, prepare, utterances, waysToSay, whoIs, type HeardWord } from '@/lib/voice/calls';

const FLEET = [
  { id: 'kestrel', sailNumber: 'IRL 1613' },
  { id: 'fulmar', sailNumber: 'IRL 1631' },
  { id: 'saoirse', sailNumber: 'IRL 2016' },
  { id: 'petrel', sailNumber: 'IRL 2060' },
  { id: 'gannet', sailNumber: 'IRL 8338' },
  { id: 'dunlin', sailNumber: 'IRL 4078' },
  { id: 'tern', sailNumber: 'IRL 2144' },
  { id: 'skua', sailNumber: 'IRL 9044' },
  { id: 'puffin', sailNumber: 'IRL 811' },
  { id: 'skiff', sailNumber: 'GBR 7111' },
];
const list = prepare(FLEET);
const said = (text: string) => text.split(' ');

/** Words a second apart from `at`, as one utterance unless `gap` says otherwise. */
function heard(text: string, at: number, step = 0.3): HeardWord[] {
  return text.split(' ').map((w, i) => ({ w, t: at + i * step }));
}

describe('digitCandidates', () => {
  it('reads the ways a number is called off a sail', () => {
    expect(digitCandidates(said('one six one three'))).toEqual(['1613']);
    expect(digitCandidates(said('sixteen thirteen'))).toEqual(['1613']);
    expect(digitCandidates(said('four oh seven eight'))).toEqual(['4078']);
    expect(digitCandidates(said('seven double one one'))).toEqual(['7111']);
    expect(digitCandidates(said('eight hundred and eleven'))).toEqual(['811']);
  });

  it('keeps both readings of a tens word followed by a unit', () => {
    expect(digitCandidates(said('twenty one')).sort()).toEqual(['201', '21']);
  });

  it('lets a sound-alike at the edge belong to the number or not', () => {
    expect(digitCandidates(said('for oh seven eight')).sort()).toEqual(['078', '4078']);
  });
});

describe('waysToSay', () => {
  it('gives digits one by one, in pairs, and with doubles', () => {
    const ways = waysToSay('7111').map((w) => w.join(' '));
    expect(ways).toContain('seven one one one');
    expect(ways).toContain('seventy one eleven');
    expect(ways).toContain('seven double one one');
  });
});

describe('whoIs', () => {
  it('takes a whole number as its boat', () => {
    expect(whoIs(said('sixteen thirteen'), list)).toMatchObject({ how: 'whole', entry: { id: 'kestrel' } });
    expect(whoIs(said('eight three three eight'), list)).toMatchObject({ how: 'whole', entry: { id: 'gannet' } });
  });

  it('takes trailing digits only one boat has', () => {
    expect(whoIs(said('six one three'), list)).toMatchObject({ how: 'ending', entry: { id: 'kestrel' } });
  });

  it('leaves trailing digits two boats share for a person to choose', () => {
    const m = whoIs(said('oh four four'), prepare([...FLEET, { id: 'other', sailNumber: '3044' }]));
    expect(m.how).toBe('ambiguous');
    expect(m.how === 'ambiguous' && m.entries.map((e) => e.id).sort()).toEqual(['other', 'skua']);
  });

  it('reads a sound-alike as a suggestion, never as certain', () => {
    // "ate" beside real number words is the recogniser's eight.
    expect(whoIs(said('four oh seven ate'), list)).toMatchObject({ how: 'whole', entry: { id: 'dunlin' } });
    // No number on the list as heard, but only one boat sounds like it.
    expect(whoIs(said('eight tree tree eight'), list)).toMatchObject({ how: 'sounds', entry: { id: 'gannet' } });
  });

  it('files a number on no entry as an unknown boat', () => {
    expect(whoIs(said('five five five five'), list)).toEqual({ how: 'unknown', digits: '5555' });
  });

  it('ignores talk', () => {
    expect(whoIs(said('is that the last of them'), list)).toEqual({ how: 'none' });
    expect(whoIs(said('for'), list)).toEqual({ how: 'none' });
  });

  it('lets a boat already across give way to one still racing', () => {
    const two = prepare([{ id: 'a', sailNumber: '2144' }, { id: 'b', sailNumber: '9144' }]);
    expect(whoIs(said('one four four'), two).how).toBe('ambiguous');
    expect(whoIs(said('one four four'), two, { finished: (id) => id === 'a' })).toMatchObject({ how: 'ending', entry: { id: 'b' } });
  });
});

describe('utterances', () => {
  it('starts a new one after a pause', () => {
    const us = utterances([...heard('sixteen thirteen', 1), ...heard('now', 3)]);
    expect(us.map((u) => u.words.map((x) => x.w).join(' '))).toEqual(['sixteen thirteen', 'now']);
  });
});

describe('callsFrom', () => {
  it('takes each boat with the time of the word after her number', () => {
    const calls = callsFrom([
      ...heard('sixteen thirteen', 1),
      ...heard('no', 3.2),
      ...heard('right who is next', 6),
      ...heard('eight three three eight now', 12),
    ], list);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ how: 'whole', entry: { id: 'kestrel' }, markAt: 3.2 });
    // Said in one breath: the last word is the mark.
    expect(calls[1]).toMatchObject({ how: 'whole', entry: { id: 'gannet' }, markAt: 12 + 4 * 0.3 });
  });

  it('reports a boat called a second time as called again', () => {
    const calls = callsFrom([...heard('sixteen thirteen', 1), ...heard('sixteen thirteen', 20)], list);
    expect(calls.map((c) => c.again)).toEqual([false, true]);
  });

  it('does not take a word long after a number as its time', () => {
    const calls = callsFrom([...heard('sixteen thirteen', 1), ...heard('okay', 12)], list);
    expect(calls[0].markAt).toBeNull();
  });
});
