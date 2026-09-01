/**
 * Guards the split-fleet vocabulary.
 *
 * Championship sailing instructions use two sets of words for the same three
 * stages, and the two sets share terms. Both say "qualifying/qualification
 * series" and both say "final series", meaning a different stage each time
 * (see `Vocabulary` in `lib/split-fleets.ts`). So a stage word written
 * directly into a string is not a phrasing choice — it is a statement that is
 * false for every series using the other vocabulary.
 *
 * These tests are the thing that keeps that true a year from now. The first
 * scans the split-fleet surfaces for the raw words; the second checks the
 * vocabularies stay disjoint enough for the scan to mean anything.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { STAGES, VOCABULARIES, parseVocabularyKey, type VocabularyKey } from '@/lib/split-fleets';

const ROOT = join(__dirname, '..');

/** The files that put split-fleet words in front of a user. */
const SURFACES = [
  'app/series/[id]/split-fleets/page.tsx',
  'components/split-fleets-editor.tsx',
  'lib/split-fleets-si.ts',
  'lib/split-fleets-render.ts',
  'app/help/content/split-fleets.tsx',
];

/**
 * Words that name a stage, or the series over stages one and two. Each has to
 * come from the vocabulary; none may be typed into a surface.
 *
 * Deliberately not exhaustive over English: it catches the terms that actually
 * collide, which is what makes a page wrong rather than merely differently
 * worded.
 */
const BANNED = [
  'opening series',
  'qualifying series',
  'qualification series',
  'preliminary series',
  'elimination series',
  'final series',
  'medal race',
  'medal races',
  'medal fleet',
  'medal boat',
  'qualifying fleet',
  'final fleet',
  'qualifying race',
  'final race',
  'preliminary race',
  'elimination race',
  'preliminary fleet',
  'elimination fleet',
];

/** Strip what a reader never sees: comments, and identifiers/props/imports. */
function userVisibleText(source: string): string {
  return (
    source
      // Block and line comments — a comment may and should name these stages.
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      // `stages.qualifying`, `config.medal`, `'qualifying'` as a stage key,
      // `data-testid="logical-race-..."` and the like are identifiers.
      .replace(/\.\w+/g, '')
      .replace(/'(qualifying|final|medal)'/g, '')
      .replace(/\b(qualifying|final|medal)\s*:/g, '')
  );
}

describe('split-fleet vocabulary', () => {
  it.each(SURFACES)('%s writes no stage word directly', (file) => {
    const text = userVisibleText(readFileSync(join(ROOT, file), 'utf8')).toLowerCase();
    const found = BANNED.filter((word) => text.includes(word));
    expect(
      found,
      `${file} contains stage wording that should come from resolveVocabulary(): ` +
        `${found.join(', ')}. Both vocabularies use these words for different stages, ` +
        'so a literal here is wrong for half the championships that read it.',
    ).toEqual([]);
  });

  it('keeps the two vocabularies distinct where they share words', () => {
    // The collisions this whole mechanism exists for: the same phrase naming
    // a different stage in each vocabulary. If these ever coincided, the
    // vocabulary would be decoration.
    const generic = VOCABULARIES['opening-medal'];
    const ilca = VOCABULARIES['qualification-final'];
    expect(generic.stages.final.name.toLowerCase()).toBe('final series');
    expect(ilca.stages.medal.name.toLowerCase()).toBe('final series');
    expect(ilca.stages.final.name.toLowerCase()).not.toBe('final series');
    expect(generic.seriesName.toLowerCase()).not.toBe(
      generic.stages.qualifying.name.toLowerCase(),
    );
  });

  it('gives every stage of every vocabulary a full set of words', () => {
    for (const key of Object.keys(VOCABULARIES) as VocabularyKey[]) {
      const vocab = VOCABULARIES[key];
      expect(vocab.seriesName, key).toBeTruthy();
      for (const stage of STAGES) {
        const words = vocab.stages[stage];
        expect(words.name, `${key}.${stage}.name`).toBeTruthy();
        expect(words.raceNoun, `${key}.${stage}.raceNoun`).toBeTruthy();
        expect(words.fleetNoun, `${key}.${stage}.fleetNoun`).toBeTruthy();
        expect(vocab.prefixes[stage], `${key}.prefixes.${stage}`).toMatch(/^[A-Z]{1,2}$/);
      }
      // Two stages sharing a prefix is what continuous numbering is for, and
      // is the only way the labels stay unique across them.
      const sharesPrefix = vocab.prefixes.qualifying === vocab.prefixes.final;
      expect(vocab.continuousOpeningNumbers, `${key} numbering`).toBe(sharesPrefix);
    }
  });

  it('parses a key from outside the type system and rejects the rest', () => {
    for (const key of Object.keys(VOCABULARIES)) {
      expect(parseVocabularyKey(key)).toBe(key);
    }
    expect(parseVocabularyKey('medal')).toBeNull();
    expect(parseVocabularyKey('')).toBeNull();
    expect(parseVocabularyKey(undefined)).toBeNull();
    expect(parseVocabularyKey(['opening-medal'])).toBeNull();
    // Prototype names are not vocabularies, whatever `in` says.
    expect(parseVocabularyKey('toString')).toBeNull();
  });
});
