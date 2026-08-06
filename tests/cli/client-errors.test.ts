// @vitest-environment node

/**
 * How the CLI reports a rejected request. A 403 has two quite different
 * causes — a token outside the workspace, and one inside it whose role lacks
 * the permission — and conflating them sends you auditing membership when the
 * problem is the role. The server already distinguishes them in `reason`.
 */
import { describe, expect, test } from 'vitest';

import { SailscoringClient, type FetchLike } from '@/cli/client';

function clientReturning(status: number, body: unknown): SailscoringClient {
  const fetch: FetchLike = async () => ({
    status,
    text: async () => JSON.stringify(body),
  });
  return new SailscoringClient({ baseUrl: 'http://localhost', token: 't', fetch });
}

async function messageFor(status: number, body: unknown): Promise<string> {
  const client = clientReturning(status, body);
  const err = await client.importSeries('{}', { idempotencyKey: 'k' }).catch((e) => e);
  return (err as Error).message;
}

describe('CLI error messages', () => {
  test('a permission denial names the permission, not workspace membership', async () => {
    const msg = await messageFor(403, {
      error: 'forbidden',
      reason: 'permission-denied:manage-series',
    });
    expect(msg).toContain('manage-series');
    expect(msg).not.toContain('not a member');
  });

  test('a non-membership 403 still reads as such', async () => {
    const msg = await messageFor(403, { error: 'forbidden', reason: 'no-workspace' });
    expect(msg).toContain('no-workspace');
  });

  test('a 403 with no reason falls back to the membership wording', async () => {
    const msg = await messageFor(403, { error: 'forbidden' });
    expect(msg).toContain('not a member');
  });

  test('401 points at the token', async () => {
    const msg = await messageFor(401, { error: 'unauthenticated' });
    expect(msg).toContain('token');
  });
});
