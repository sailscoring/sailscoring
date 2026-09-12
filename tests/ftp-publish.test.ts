import { describe, expect, it } from 'vitest';

import { resolveFtpServerId } from '@/lib/ftp-publish';
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
