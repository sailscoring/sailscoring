import { promises as fs } from 'node:fs';
import path from 'node:path';

import { test, expect } from './fixtures';

/**
 * Smoke test for /api/v1: signs in via magic link, then exercises the
 * full series CRUD path end-to-end through the Better Auth wrapper.
 * Tagged @auth so it only runs in db-tests.yml (which provisions
 * Postgres). The richer per-resource coverage lives in vitest under
 * tests/api/.
 */

const MAGIC_LINKS_LOG = path.join(process.cwd(), 'tests', '.magic-links.log');

async function readLatestMagicLink(forEmail: string): Promise<string> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const content = await fs.readFile(MAGIC_LINKS_LOG, 'utf8');
      const lines = content.trim().split('\n').reverse();
      for (const line of lines) {
        const [, email, url] = line.split('\t');
        if (email === forEmail && url) return url;
      }
    } catch {
      // file may not exist yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No magic link found for ${forEmail}`);
}

function uuid() {
  return crypto.randomUUID();
}

test.describe('@auth /api/v1', () => {
  test.beforeAll(async () => {
    await fs.mkdir(path.dirname(MAGIC_LINKS_LOG), { recursive: true });
    await fs.writeFile(MAGIC_LINKS_LOG, '', 'utf8');
  });

  test('signs in then PUTs, GETs, lists, and DELETEs a series', async ({ page, request }) => {
    const email = `apiv1-${Date.now()}@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/account/);

    // Pull the session cookies from the browser context to drive the API
    // request as the same user.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

    const seriesId = uuid();
    const now = Date.now();
    const seriesBody = {
      id: seriesId,
      name: `API smoke ${seriesId.slice(0, 8)}`,
      venue: '',
      startDate: '',
      endDate: '',
      venueLogoUrl: '',
      eventLogoUrl: '',
      createdAt: now,
      lastSnapshotId: null,
      lastSavedAt: null,
      lastModifiedAt: now,
      snapshotHistory: [],
      scoringMode: 'scratch',
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      bilgeBundle: null,
      includeJsonExport: true,
      publishRatingCalculations: true,
      enabledCompetitorFields: ['boatName', 'club'],
      primaryPersonLabel: 'competitor',
    };

    const put = await request.put(`/api/v1/series/${seriesId}`, {
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      data: seriesBody,
    });
    expect(put.status()).toBe(200);
    const created = await put.json();
    expect(created.id).toBe(seriesId);

    const get = await request.get(`/api/v1/series/${seriesId}`, {
      headers: { cookie: cookieHeader },
    });
    expect(get.status()).toBe(200);
    expect((await get.json()).name).toBe(seriesBody.name);

    const list = await request.get('/api/v1/series', { headers: { cookie: cookieHeader } });
    expect(list.status()).toBe(200);
    const listBody = await list.json();
    expect(listBody.items.some((s: { id: string }) => s.id === seriesId)).toBe(true);

    const del = await request.delete(`/api/v1/series/${seriesId}`, {
      headers: { cookie: cookieHeader },
    });
    expect(del.status()).toBe(204);

    const getAfter = await request.get(`/api/v1/series/${seriesId}`, {
      headers: { cookie: cookieHeader },
    });
    expect(getAfter.status()).toBe(404);
  });

  test('unauthenticated requests return 401', async ({ request }) => {
    const res = await request.get('/api/v1/series');
    expect(res.status()).toBe(401);
  });
});
