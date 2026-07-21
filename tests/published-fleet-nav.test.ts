import { describe, it, expect } from 'vitest';

import { injectAfterBodyTag, renderFleetNav } from '@/lib/published-fleet-nav';

// The serve-time fleet switcher on public fleet pages (#320). Route wiring is
// covered by e2e/publishing.spec.ts.

const base = '/p/hyc/autumn-26';

describe('renderFleetNav', () => {
  it('renders nothing for a single-page publication', () => {
    expect(renderFleetNav([{ fleetName: 'Default', subPath: 'standings' }], 'standings', base)).toBe('');
    expect(renderFleetNav([], 'standings', base)).toBe('');
  });

  it('renders inline links for a few pages, with the current page unlinked', () => {
    const html = renderFleetNav(
      [
        { fleetName: 'Class 1', subPath: 'class-1' },
        { fleetName: 'Class 2', subPath: 'class-2' },
        { fleetName: 'Class 3', subPath: 'class-3' },
      ],
      'class-2',
      base,
    );
    expect(html).toContain('href="/p/hyc/autumn-26/class-1"');
    expect(html).toContain('href="/p/hyc/autumn-26/class-3"');
    expect(html).not.toContain('href="/p/hyc/autumn-26/class-2"');
    expect(html).toContain('<span class="ssfleetnav-current">Class 2</span>');
    expect(html).not.toContain('<select');
  });

  it('switches to a select beyond four pages, current selected', () => {
    const pages = [1, 2, 3, 4, 5].map((n) => ({
      fleetName: `Class ${n}`,
      subPath: `class-${n}`,
    }));
    const html = renderFleetNav(pages, 'class-4', base);
    expect(html).toContain('<select');
    expect(html).toContain(`<option value="/p/hyc/autumn-26/class-4" selected>Class 4</option>`);
    expect(html).toContain(`<option value="/p/hyc/autumn-26/class-1">Class 1</option>`);
    expect(html).not.toContain('<a ');
  });

  it('labels a lone non-prizes page "Standings", the prize sheet by name', () => {
    const html = renderFleetNav(
      [
        { fleetName: 'Default', subPath: 'standings' },
        { fleetName: 'Prizes', isPrizes: true, subPath: 'prizes' },
      ],
      'standings',
      base,
    );
    expect(html).toContain('<span class="ssfleetnav-current">Standings</span>');
    expect(html).toContain('>Prizes</a>');
    expect(html).not.toContain('>Default<');
  });

  it('carries the block name on sub-series pages', () => {
    const html = renderFleetNav(
      [
        { fleetName: 'Squibs', subSeriesName: 'Spring', subPath: 'spring/squibs' },
        { fleetName: 'Squibs', subSeriesName: 'Summer', subPath: 'summer/squibs' },
      ],
      'spring/squibs',
      base,
    );
    expect(html).toContain('Spring — Squibs');
    expect(html).toContain('href="/p/hyc/autumn-26/summer/squibs"');
  });

  it('escapes fleet names', () => {
    const html = renderFleetNav(
      [
        { fleetName: 'A & B <Cruisers>', subPath: 'a-b' },
        { fleetName: 'Other', subPath: 'other' },
      ],
      'other',
      base,
    );
    expect(html).toContain('A &amp; B &lt;Cruisers&gt;');
    expect(html).not.toContain('<Cruisers>');
  });

  it('hides from print and scopes its styles', () => {
    const html = renderFleetNav(
      [
        { fleetName: 'A', subPath: 'a' },
        { fleetName: 'B', subPath: 'b' },
      ],
      'a',
      base,
    );
    expect(html).toContain('@media print { .ssfleetnav { display: none; } }');
  });
});

describe('injectAfterBodyTag', () => {
  it('inserts the fragment right after the opening body tag', () => {
    const html = '<html><body class="x"><p>hi</p></body></html>';
    expect(injectAfterBodyTag(html, '<nav/>')).toBe(
      '<html><body class="x"><nav/><p>hi</p></body></html>',
    );
  });

  it('leaves a document without a body tag unchanged', () => {
    expect(injectAfterBodyTag('<p>bare</p>', '<nav/>')).toBe('<p>bare</p>');
  });
});
