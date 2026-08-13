import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HELP_GROUPS,
  helpPathForSection,
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
