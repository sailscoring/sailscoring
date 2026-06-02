import { describe, expect, it } from 'vitest';

import {
  classKey,
  createClassMatcher,
  normalizeClassName,
  ryaPyMatcher,
} from '@/lib/rya-py/class-match';
import type { RyaPyClass } from '@/lib/rya-py/types';

const cls = (c: Partial<RyaPyClass> & { name: string; number: number }): RyaPyClass => ({
  tier: 'base',
  ...c,
});

describe('normalizeClassName', () => {
  it('lowercases and strips punctuation, spacing, accents', () => {
    expect(normalizeClassName('ILCA 7 / Laser')).toBe('ilca7laser');
    expect(normalizeClassName('  laser ')).toBe('laser');
    expect(normalizeClassName('RS200')).toBe('rs200');
    expect(normalizeClassName(undefined)).toBe('');
  });
});

describe('createClassMatcher', () => {
  const classes: RyaPyClass[] = [
    cls({ classId: 191, name: 'ILCA 7 / Laser', slug: 'ilca_7', number: 1103 }),
    cls({ classId: 190, name: 'ILCA 6 / Laser Radial', slug: 'ilca_6', number: 1156 }),
    cls({ classId: 142, name: 'Flying Fifteen', slug: 'flying_fifteen', number: 1028 }),
    cls({ classId: 140, name: 'Flying Fifteen Classic (1-2700)', slug: 'flying_fifteen', number: 1079 }),
    cls({ classId: 141, name: 'Flying Fifteen Silver (2701-3400)', slug: 'flying_fifteen', number: 1051 }),
    cls({ classId: 69, name: 'Comet Trio MK 1', slug: 'comet_trio', number: 1082 }),
    cls({ classId: 70, name: 'Comet Trio MK 2', slug: 'comet_trio', number: 1053 }),
    cls({ name: 'Salcombe Yawl', number: 1105, tier: 'limited-data' }),
  ];
  const m = createClassMatcher(classes);

  it('matches on the canonical name exactly, case/space-insensitively', () => {
    const r = m.match('flying  fifteen');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.cls.classId).toBe(142);
      expect(r.via).toBe('name');
    }
  });

  it('resolves a `/`-separated alias to the unique class', () => {
    const r = m.match('Laser');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') {
      expect(r.cls.classId).toBe(191);
      expect(r.via).toBe('alias');
    }
  });

  it('drops a trailing parenthetical to match the silver/classic split', () => {
    const r = m.match('Flying Fifteen Silver');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') expect(r.cls.classId).toBe(141);
  });

  it('reports several distinct classes sharing a slug as ambiguous', () => {
    const r = m.match('Comet Trio');
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.candidates.map((c) => c.classId).sort()).toEqual([69, 70]);
    }
  });

  it('matches a no-ID limited-data class by name', () => {
    const r = m.match('salcombe yawl');
    expect(r.kind).toBe('matched');
    if (r.kind === 'matched') expect(r.cls.number).toBe(1105);
  });

  it('returns none for an unknown class and for blank input', () => {
    expect(m.match('Wonderboat 9000').kind).toBe('none');
    expect(m.match('').kind).toBe('none');
    expect(m.match(undefined).kind).toBe('none');
  });

  it('exposes all classes sorted by name', () => {
    const names = m.all().map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });
});

describe('classKey', () => {
  it('uses the Class ID when present, else the normalised name', () => {
    expect(classKey(cls({ classId: 191, name: 'ILCA 7 / Laser', number: 1103 }))).toBe('id:191');
    expect(classKey(cls({ name: 'Salcombe Yawl', number: 1105 }))).toBe('nm:salcombeyawl');
  });
});

describe('bundled dataset', () => {
  it('matches real classes from the generated list', () => {
    expect(ryaPyMatcher.match('Optimist').kind).toBe('matched');
    expect(ryaPyMatcher.match('ILCA 7').kind).toBe('matched');
    const melges = ryaPyMatcher.match('Melges 15');
    expect(melges.kind).toBe('matched');
    if (melges.kind === 'matched') expect(melges.cls.tier).toBe('experimental');
  });
});
