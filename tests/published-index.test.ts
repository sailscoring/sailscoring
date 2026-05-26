import { describe, it, expect } from 'vitest';

import {
  renderWorkspaceIndexHtml,
  renderSeriesIndexHtml,
} from '@/lib/published-index';

// Pure renderers for the public listing pages (ADR-008 Phase 9/10, #162). The
// route wiring + freshness are covered by e2e/publishing.spec.ts.

describe('renderWorkspaceIndexHtml', () => {
  const items = [
    { slug: 'autumn-26', title: 'HYC Autumn League 2026', publishedAt: Date.UTC(2026, 4, 20), fleetCount: 3 },
    { slug: 'spring-26', title: 'Spring Series', publishedAt: Date.UTC(2026, 2, 1), fleetCount: 1 },
  ];

  it('lists each publication with a link to its series index', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'Howth Yacht Club', items);
    expect(html).toContain('href="/p/hyc/autumn-26"');
    expect(html).toContain('HYC Autumn League 2026');
    expect(html).toContain('href="/p/hyc/spring-26"');
    expect(html).toContain('Howth Yacht Club');
  });

  it('shows a fleet count only when there is more than one fleet', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'HYC', items);
    expect(html).toContain('3 fleets');
    // The single-fleet row carries no fleet-count suffix.
    expect(html).not.toContain('1 fleets');
  });

  it('preserves the caller-supplied order', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'HYC', items);
    expect(html.indexOf('autumn-26')).toBeLessThan(html.indexOf('spring-26'));
  });

  it('renders an empty-state message when nothing is published', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'HYC', []);
    expect(html).toContain('No published results yet');
    expect(html).not.toContain('<ul');
  });

  it('escapes titles and workspace names', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'A & B <Club>', [
      { slug: 's', title: 'Race <1> & "2"', publishedAt: Date.UTC(2026, 0, 1), fleetCount: 1 },
    ]);
    expect(html).toContain('Race &lt;1&gt; &amp; &quot;2&quot;');
    expect(html).toContain('A &amp; B &lt;Club&gt;');
    expect(html).not.toMatch(/<Club>/);
  });

  it('carries the Sail Scoring footer', () => {
    const html = renderWorkspaceIndexHtml('hyc', 'HYC', items);
    expect(html).toContain('sailscoring.ie');
  });
});

describe('renderSeriesIndexHtml', () => {
  it('renders a single-fleet publication as a one-item "Standings" listing', () => {
    const html = renderSeriesIndexHtml('hyc', 'spring-26', 'Spring Series', [
      { fleetName: 'Cruisers', subPath: 'standings' },
    ]);
    expect(html).toContain('href="/p/hyc/spring-26/standings"');
    expect(html).toContain('>Standings<');
    // The bare fleet name is not used as the link label for a single fleet.
    expect(html).not.toContain('>Cruisers<');
    expect(html).toContain('Spring Series');
  });

  it('lists each named fleet for a multi-fleet publication', () => {
    const html = renderSeriesIndexHtml('hyc', 'autumn-26', 'HYC Autumn League 2026', [
      { fleetName: 'IRC One', subPath: 'irc-one' },
      { fleetName: 'Echo', subPath: 'echo' },
    ]);
    expect(html).toContain('href="/p/hyc/autumn-26/irc-one"');
    expect(html).toContain('>IRC One<');
    expect(html).toContain('href="/p/hyc/autumn-26/echo"');
    expect(html).toContain('>Echo<');
  });

  it('escapes the title, fleet labels and slug', () => {
    const html = renderSeriesIndexHtml('hyc', 'x', 'Title <&>', [
      { fleetName: 'A & B', subPath: 'a-b' },
      { fleetName: 'C', subPath: 'c' },
    ]);
    expect(html).toContain('Title &lt;&amp;&gt;');
    expect(html).toContain('A &amp; B');
  });
});
