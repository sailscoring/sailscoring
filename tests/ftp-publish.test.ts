import { describe, expect, it } from 'vitest';

import {
  absolutizeRootRelativeUrls,
  configuredFtpPaths,
  ftpFilePath,
  ftpLinkHref,
  resolveFtpServerId,
} from '@/lib/ftp-publish';
import { fleetPageKey, type PublishPage } from '@/lib/publish-pages';
import type { FtpServer } from '@/lib/types';

function server(id: string, host: string): FtpServer {
  return { id, host, port: 21, username: 'scorer', password: 's3cret', ftps: false, version: 1 };
}

const hyc = server('11111111-1111-4111-8111-111111111111', 'ftp.hyc.ie');
const club = server('22222222-2222-4222-8222-222222222222', 'ftp.club.ie');

describe('resolveFtpServerId', () => {
  it('opens on the server the series remembers by id', () => {
    expect(resolveFtpServerId([hyc, club], { ftpServerId: club.id, ftpHost: '' })).toBe(club.id);
  });

  it('falls back to the saved host when the id resolves to nothing', () => {
    // A series carried in from another workspace: the id is meaningless here,
    // the host still names a server.
    const foreign = { ftpServerId: '33333333-3333-4333-8333-333333333333', ftpHost: 'ftp.hyc.ie' };
    expect(resolveFtpServerId([hyc, club], foreign)).toBe(hyc.id);
  });

  it('falls back to the saved host when no id was ever stored', () => {
    expect(resolveFtpServerId([hyc, club], { ftpHost: 'ftp.club.ie' })).toBe(club.id);
  });

  it('prefers the id over a host that names a different server', () => {
    expect(resolveFtpServerId([hyc, club], { ftpServerId: hyc.id, ftpHost: 'ftp.club.ie' })).toBe(
      hyc.id,
    );
  });

  it('opens on the only configured server when the series remembers nothing', () => {
    expect(resolveFtpServerId([hyc], { ftpHost: '' })).toBe(hyc.id);
  });

  it('leaves the choice open when several servers could be meant', () => {
    expect(resolveFtpServerId([hyc, club], { ftpHost: '' })).toBe('');
    // A host that matches nothing is no better than none, with two to choose from.
    expect(resolveFtpServerId([hyc, club], { ftpHost: 'ftp.gone.ie' })).toBe('');
  });

  it('has nothing to open on when the workspace has no servers', () => {
    expect(resolveFtpServerId([], { ftpServerId: hyc.id, ftpHost: 'ftp.hyc.ie' })).toBe('');
  });
});

const fast: PublishPage = {
  key: fleetPageKey('fleet-fast'),
  name: 'Fast',
  kind: 'fleet',
  isDefault: false,
  fleetId: 'fleet-fast',
};
const slow: PublishPage = {
  key: fleetPageKey('fleet-slow'),
  name: 'Slow',
  kind: 'fleet',
  isDefault: false,
  fleetId: 'fleet-slow',
};
const entries: PublishPage = { key: 'entries', name: 'Entries', kind: 'entries', isDefault: false };
const pages = [fast, slow, entries];

describe('configuredFtpPaths', () => {
  const lone: PublishPage = {
    key: fleetPageKey('fleet-only'),
    name: 'Default',
    kind: 'fleet',
    isDefault: true,
    fleetId: 'fleet-only',
  };

  it('answers only the pages that have a path', () => {
    const stored = { [fast.key]: '/fast.html', [entries.key]: '/entries.html' };
    expect(configuredFtpPaths(pages, { ftpPaths: stored, ftpPath: '' })).toEqual(stored);
  });

  it('reads the older bare fleet-id path keys', () => {
    // What scripts/update-ftp-paths.ts threads onto a series.
    expect(configuredFtpPaths(pages, { ftpPaths: { 'fleet-fast': '/fast.html' }, ftpPath: '' })).toEqual({
      [fast.key]: '/fast.html',
    });
  });

  it('gives the lone default page the single path of an older series', () => {
    expect(configuredFtpPaths([lone], { ftpPaths: {}, ftpPath: '/results/series.html' })).toEqual({
      [lone.key]: '/results/series.html',
    });
  });

  it('derives nothing for the other pages from that single path', () => {
    // Where `series-fast.html` would go was only ever a suggestion; nobody
    // said to put a file there.
    expect(configuredFtpPaths(pages, { ftpPaths: {}, ftpPath: '/results/series.html' })).toEqual({});
  });

  it('treats a path cleared to blank as no path, masking older settings', () => {
    const stored = { [lone.key]: '  ', 'fleet-only': '/old.html' };
    expect(configuredFtpPaths([lone], { ftpPaths: stored, ftpPath: '/legacy.html' })).toEqual({});
  });

  it('trims what was typed', () => {
    expect(configuredFtpPaths([fast], { ftpPaths: { [fast.key]: ' /fast.html ' }, ftpPath: '' })).toEqual({
      [fast.key]: '/fast.html',
    });
  });
});

describe('ftpFilePath', () => {
  it('is the page path for a page outside any block', () => {
    expect(ftpFilePath('/results/frostbites.html')).toBe('/results/frostbites.html');
  });

  it('puts the block before the extension', () => {
    expect(ftpFilePath('/results/frostbites.html', 'Winter Series')).toBe(
      '/results/frostbites-winter-series.html',
    );
  });

  it('appends the block to a path with no extension', () => {
    expect(ftpFilePath('/results/frostbites', 'Winter')).toBe('/results/frostbites-winter');
    expect(ftpFilePath('/results.d/frostbites', 'Winter')).toBe('/results.d/frostbites-winter');
  });
});

describe('ftpLinkHref', () => {
  const published = 'https://app.sailscoring.ie/p/hyc/2026/race-results';

  it('links the target on the club site, relative to the linking page', () => {
    expect(ftpLinkHref('/public_html/r/champ.html', '/public_html/r/races.html', published)).toBe(
      'races.html',
    );
    expect(ftpLinkHref('/public_html/r/champ.html', '/public_html/races.html', published)).toBe(
      '../races.html',
    );
  });

  it('links Sail Scoring when the target has no copy on the club site', () => {
    expect(ftpLinkHref('/public_html/r/champ.html', undefined, published)).toBe(published);
  });
});

describe('absolutizeRootRelativeUrls', () => {
  const base = 'https://app.sailscoring.ie';

  it('makes a library logo absolute', () => {
    expect(absolutizeRootRelativeUrls('<img class="headerlogo" src="/logos/abc" />', base)).toBe(
      '<img class="headerlogo" src="https://app.sailscoring.ie/logos/abc" />',
    );
  });

  it('makes root-relative links absolute', () => {
    expect(absolutizeRootRelativeUrls('<a href="/p/hyc">x</a>', base)).toBe(
      '<a href="https://app.sailscoring.ie/p/hyc">x</a>',
    );
  });

  it('leaves absolute, protocol-relative, relative and fragment URLs alone', () => {
    const html =
      '<a href="https://x.ie/a">a</a><img src="//cdn.x/i.png"><a href="races.html">r</a><a href="#r1">1</a>';
    expect(absolutizeRootRelativeUrls(html, base)).toBe(html);
  });

  it('leaves the text of the page alone', () => {
    const html = '<p>href="/not-a-link" is what the docs say</p>';
    expect(absolutizeRootRelativeUrls(html, base)).toBe(html);
  });
});
