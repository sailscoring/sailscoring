import { describe, expect, it } from 'vitest';

import {
  competitorSlugCandidate,
  mintSlug,
  randomSlugSuffix,
  slugifyName,
} from '@/lib/competitor-slug';

describe('slugifyName', () => {
  it('kebabs a normal name', () => {
    expect(slugifyName('Charlie Keating')).toBe('charlie-keating');
  });

  it('folds diacritics instead of hyphenating them', () => {
    // The generic kebab() would yield "se-n" / "aurele"-with-gaps; we want clean.
    expect(slugifyName('Seán Ó Faoláin')).toBe('sean-o-faolain');
    expect(slugifyName('Aurèle Dion')).toBe('aurele-dion');
    expect(slugifyName("Aoife O'Toole")).toBe('aoife-o-toole');
  });

  it('falls back to "competitor" for a blank or punctuation-only name', () => {
    expect(slugifyName('')).toBe('competitor');
    expect(slugifyName('   ')).toBe('competitor');
    expect(slugifyName('—')).toBe('competitor');
  });

  it('trims and collapses separators', () => {
    expect(slugifyName('  John   Murphy  ')).toBe('john-murphy');
  });
});

describe('randomSlugSuffix', () => {
  it('is 4 chars from the unambiguous alphabet (no 0/o/1/l/i)', () => {
    for (let i = 0; i < 200; i++) {
      expect(randomSlugSuffix()).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
    }
  });
});

describe('competitorSlugCandidate', () => {
  it('joins the name base and a suffix', () => {
    expect(competitorSlugCandidate('Charlie Keating')).toMatch(
      /^charlie-keating-[abcdefghjkmnpqrstuvwxyz23456789]{4}$/,
    );
  });

  it('produces (almost always) distinct suffixes', () => {
    const slugs = new Set(
      Array.from({ length: 50 }, () => competitorSlugCandidate('Same Name')),
    );
    // Collisions are possible but vanishingly unlikely across 50 draws.
    expect(slugs.size).toBeGreaterThan(45);
  });
});

describe('mintSlug', () => {
  it('returns a slug not already in the reserved set and adds it', () => {
    const reserved = new Set<string>();
    const a = mintSlug('John Murphy', reserved);
    expect(reserved.has(a)).toBe(true);
    const b = mintSlug('John Murphy', reserved);
    expect(b).not.toBe(a);
    expect(reserved.size).toBe(2);
  });

  it('avoids a pre-seeded collision', () => {
    // Force the first candidate to be taken by seeding every base form once;
    // mintSlug must still find a free suffix.
    const reserved = new Set<string>();
    for (let i = 0; i < 100; i++) reserved.add(mintSlug('Jane Doe', reserved));
    const next = mintSlug('Jane Doe', reserved);
    expect(reserved.has(next)).toBe(true);
    expect([...reserved].filter((s) => s === next)).toHaveLength(1);
  });
});
