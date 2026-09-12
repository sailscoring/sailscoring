import { describe, it, expect } from 'vitest';

import { renderPublicShell } from '@/lib/published-shell';
import { injectBeforeBodyEnd } from '@/lib/published-tree';
import {
  foundingSponsors,
  renderSponsorFooterHtml,
  SPONSORS_REVISION,
} from '@/lib/sponsors';

// Sponsor recognition on the public surface. The load-bearing property is the
// boundary: the footer belongs to the pages we serve, never to the artifact a
// scorer publishes, exports, or pushes to their club's own web host.

describe('renderSponsorFooterHtml', () => {
  it('names each Founding Sponsor and links to them', () => {
    const html = renderSponsorFooterHtml();
    for (const sponsor of foundingSponsors) {
      expect(html).toContain(sponsor.name);
      expect(html).toContain(sponsor.href);
      expect(html).toContain(sponsor.logoUrl);
    }
  });

  it('opens links in the top frame', () => {
    // Clubs embed published pages in their own sites; a sponsor link that
    // loaded inside the results iframe would trap the visitor there.
    expect(renderSponsorFooterHtml()).toContain('target="_top"');
  });

  it('carries its own scoped styles', () => {
    // It is injected into two unrelated stylesheets — the listing chrome and
    // the results pages' own much older CSS — so it can assume nothing about
    // the host page.
    const html = renderSponsorFooterHtml();
    expect(html).toContain('<style');
    expect(html).toContain('.ss-sponsors');
  });

  it('hides itself in print', () => {
    // A printed results sheet is the scorer's document. Same reasoning that
    // keeps sponsors out of exports keeps them off paper.
    expect(renderSponsorFooterHtml()).toContain('@media print { .ss-sponsors { display: none; } }');
  });
});

describe('SPONSORS_REVISION', () => {
  it('is a short stable fingerprint of the sponsor list', () => {
    // Folded into every served page's ETag, so a sponsorship that starts or
    // lapses reaches browsers holding a revalidatable copy of an otherwise
    // unchanged publication.
    expect(SPONSORS_REVISION).toMatch(/^[0-9a-f]{1,8}$/);
  });
});

describe('the sponsor footer is injected, never published', () => {
  it('is absent from the shared public-page chrome', () => {
    // The chrome is shared by the listing pages and by renderers whose output
    // is stored; the route is the one place that knows about sponsors.
    const html = renderPublicShell('Title', '<h1>Hero</h1>', '<p>Body</p>');
    expect(html).not.toContain('ss-sponsors');
  });

  it('lands before the closing body tag when the route injects it', () => {
    const page = renderPublicShell('Title', '<h1>Hero</h1>', '<p>Body</p>');
    const served = injectBeforeBodyEnd(page, renderSponsorFooterHtml());
    expect(served).toContain('ss-sponsors');
    expect(served.indexOf('ss-sponsors')).toBeLessThan(served.lastIndexOf('</body>'));
  });
});
