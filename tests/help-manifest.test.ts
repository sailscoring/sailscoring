import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HELP_GROUPS,
  HELP_INTRODUCTION,
  helpPathForSection,
  helpSectionForPath,
  visibleGroups,
  visibleSections,
} from '@/app/help/sections';

const contentDir = join(__dirname, '..', 'app', 'help', 'content');

describe('the help manifest', () => {
  it('has a unique id for every section', () => {
    const ids = HELP_GROUPS.flatMap((g) => g.sections.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has content for every chapter', () => {
    // The panel loads chapters through content/index.ts; a chapter listed in
    // the manifest with no content file is a blank page in the panel and an
    // empty chapter route.
    const index = readFileSync(join(contentDir, 'index.ts'), 'utf8');
    for (const group of HELP_GROUPS) {
      expect(existsSync(join(contentDir, `${group.slug}.tsx`)), group.slug).toBe(true);
      expect(index, group.slug).toContain(`./${group.slug}'`);
    }
  });

  it('resolves a section to the chapter that holds it', () => {
    expect(helpPathForSection('redress')).toBe('/help/entering-results');
    // Landing-page sections belong to no chapter and stay on /help.
    expect(helpPathForSection('what-is-sail-scoring')).toBeNull();
  });
});

describe('the section covering a screen', () => {
  const id = '2f1c9f0e-0000-4000-8000-000000000001';

  it('picks the section for the screen, not the chapter index', () => {
    expect(helpSectionForPath(`/series/${id}/races/7`, [])?.section.id).toBe('entering-results');
    expect(helpSectionForPath(`/series/${id}/standings`, [])?.section.id).toBe(
      'reading-the-standings',
    );
    // The deeper route wins over the shallower one it extends.
    expect(helpSectionForPath(`/series/${id}/races`, [])?.section.id).toBe('adding-races');
  });

  it('reports the chapter the section is in', () => {
    expect(helpSectionForPath(`/series/${id}/competitors`, [])?.slug).toBe('running-a-series');
    expect(helpSectionForPath('/account', [])?.slug).toBe(HELP_INTRODUCTION.slug);
  });

  it('stays quiet where nothing covers the screen', () => {
    expect(helpSectionForPath('/sign-in', [])).toBeNull();
    expect(helpSectionForPath(`/series/${id}/races/7/nonsense`, [])).toBeNull();
  });

  it('stays quiet when the covering section is gated off', () => {
    expect(helpSectionForPath('/workspace/rankings', [])).toBeNull();
    expect(helpSectionForPath('/workspace/rankings', ['rankings'])?.section.id).toBe('rankings');
  });

  it('ignores a trailing slash', () => {
    expect(helpSectionForPath('/', [])?.section.id).toBe('organising-series');
    expect(helpSectionForPath(`/series/${id}/standings/`, [])?.section.id).toBe(
      'reading-the-standings',
    );
  });

  it('only names sections that exist', () => {
    // A renamed or removed section would otherwise silently stop matching.
    const known = new Set(
      [HELP_INTRODUCTION, ...HELP_GROUPS].flatMap((g) => g.sections.map((s) => s.id)),
    );
    const routes = [
      '/',
      '/account',
      '/import',
      '/series/new',
      '/series/import-sailwave',
      `/series/${id}`,
      `/series/${id}/activity`,
      `/series/${id}/competitors`,
      `/series/${id}/history`,
      `/series/${id}/prizes`,
      `/series/${id}/races`,
      `/series/${id}/races/7`,
      `/series/${id}/settings`,
      `/series/${id}/setup`,
      `/series/${id}/split-fleets`,
      `/series/${id}/standings`,
      '/workspace',
      '/workspace/competitors',
      '/workspace/published',
      '/workspace/rankings',
    ];
    for (const route of routes) {
      // Every feature on, so gating can't mask a missing id.
      const all = [...HELP_GROUPS.flatMap((g) => g.sections.flatMap((s) => (s.feature ? [s.feature] : [])))];
      const hit = helpSectionForPath(route, all);
      expect(hit, route).not.toBeNull();
      expect(known.has(hit!.section.id), `${route} → ${hit!.section.id}`).toBe(true);
    }
  });
});

describe('feature filtering', () => {
  const running = HELP_GROUPS.find((g) => g.slug === 'running-a-series')!;

  it('drops sections gated on a feature the viewer lacks', () => {
    const ids = visibleSections(running, []).map((s) => s.id);
    expect(ids).toContain('creating-a-series');
    expect(ids).not.toContain('sub-series');
    expect(visibleSections(running, ['sub-series']).map((s) => s.id)).toContain('sub-series');
  });

  it('drops a chapter whose every section is gated off', () => {
    // Across series is competitor-identity + rankings, both gated.
    expect(visibleGroups([]).map((g) => g.slug)).not.toContain('across-series');
    expect(visibleGroups(['rankings']).map((g) => g.slug)).toContain('across-series');
  });
});
