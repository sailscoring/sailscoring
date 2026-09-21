/**
 * Searching the help index (#613).
 *
 * The code is small; the quality of the feature is set by the keywords. So
 * the test that matters is the one the issue names: the words a scorer would
 * actually type — the abbreviations, the RRS codes, the Sailwave names for
 * the same thing — find the section that covers them. Titles alone find
 * nothing for DNC, OCS, TCF, RDG, burgee, scratch, stopwatch or nett.
 */
import { describe, expect, it } from 'vitest';

import { HELP_GROUPS, HELP_INTRODUCTION, visibleGroups } from '@/app/help/sections';
import { normalizeForSearch, searchHelp, searchTokens } from '@/lib/help-search';
import { FEATURES, type FeatureKey } from '@/lib/features';

const ALL_GROUPS = [HELP_INTRODUCTION, ...HELP_GROUPS];
const EVERY_FEATURE = Object.keys(FEATURES) as FeatureKey[];

/** The section ids a query finds, for a viewer who can see everything. */
function idsFor(query: string): string[] {
  return searchHelp([HELP_INTRODUCTION, ...visibleGroups(EVERY_FEATURE)], query)
    .map((h) => h.section.id);
}

describe('normalising', () => {
  it('folds case, accents and punctuation', () => {
    expect(normalizeForSearch('Dún Laoghaire')).toBe('dun laoghaire');
    expect(normalizeForSearch('A5.3')).toBe('a5 3');
    expect(normalizeForSearch('  RDG(3)  ')).toBe('rdg 3');
  });

  it('reads a query as the words it asks for', () => {
    expect(searchTokens('discard rule')).toEqual(['discard', 'rule']);
    expect(searchTokens('   ')).toEqual([]);
  });
});

describe('searching the index', () => {
  it('finds the words a scorer types but no title contains', () => {
    // The issue's own list.
    expect(idsFor('DNC')).toContain('entering-results');
    expect(idsFor('OCS')).toContain('entering-results');
    expect(idsFor('TCF')).toContain('rating-systems');
    expect(idsFor('RDG')).toContain('redress');
    expect(idsFor('burgee')).toContain('logo-library');
    expect(idsFor('scratch')).toContain('rating-systems');
    expect(idsFor('stopwatch')).toContain('elapsed-times');
    expect(idsFor('nett')).toContain('discard-rules');
  });

  it('finds a section by the name another tool gives the same thing', () => {
    // A scorer arriving from Sailwave reaches for Sailwave's vocabulary.
    expect(idsFor('blw')).toContain('sailwave-import');
    expect(idsFor('flight')).toContain('split-fleets');
  });

  it('is token-AND, so two words narrow rather than widen', () => {
    const both = idsFor('discard rule');
    expect(both).toContain('discard-rules');
    expect(both.length).toBeLessThan(idsFor('rule').length + idsFor('discard').length);
  });

  it('matches a word the scorer has not finished typing', () => {
    expect(idsFor('disc')).toContain('discard-rules');
  });

  it('finds nothing for an empty query, rather than everything', () => {
    expect(idsFor('')).toEqual([]);
    expect(idsFor('   ')).toEqual([]);
  });

  it('finds nothing for a word nobody wrote', () => {
    expect(idsFor('zzzznothing')).toEqual([]);
  });

  it('never offers a section the viewer cannot see', () => {
    // Gating falls out of searching the list `visibleGroups` has narrowed:
    // a section gated on a feature this workspace lacks is not in it.
    const withoutOrc = visibleGroups(EVERY_FEATURE.filter((f) => f !== 'orc'));
    expect(searchHelp(withoutOrc, 'performance curve')).toEqual([]);
    expect(idsFor('performance curve')).toContain('scoring-orc');
  });

  it('gives every section something to be found by beyond its title', () => {
    // The keyword pass is the feature; a section with none is one a scorer
    // can only reach by already knowing what it is called.
    const missing = ALL_GROUPS.flatMap((g) =>
      g.sections.filter((s) => !s.keywords?.length).map((s) => s.id),
    );
    expect(missing).toEqual([]);
  });
});
