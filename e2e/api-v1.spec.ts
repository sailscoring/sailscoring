import { test, expect } from './fixtures';
import { signInFreshUser } from './helpers';

/**
 * Smoke test for /api/v1: signs in via magic link, then exercises the
 * full series CRUD path end-to-end through the Better Auth wrapper.
 * The richer per-resource coverage lives in vitest under tests/api/.
 */

function uuid() {
  return crypto.randomUUID();
}

test.describe('/api/v1', () => {
  test('signs in then PUTs, GETs, lists, and DELETEs a series', async ({ page, request }) => {
    await signInFreshUser(page, 'apiv1');

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
      venueUrl: '',
      eventUrl: '',
      createdAt: now,
      lastSavedAt: null,
      lastModifiedAt: now,
      scoringMode: 'scratch',
      discardThresholds: [],
      dnfScoring: 'seriesEntries',
      ftpHost: '',
      ftpPath: '',
      ftpPaths: {},
      includeJsonExport: true,
      publishRatingCalculations: true,
      showPerRaceRatingsInSummary: true,
      enabledCompetitorFields: ['boatName', 'club'],
      primaryPersonLabel: 'competitor',
      subdivisionAxes: [],
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

    // Delete requires the series to be archived first (#154).
    const archive = await request.post(`/api/v1/series/${seriesId}/archive`, {
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      data: { archived: true },
    });
    expect(archive.status()).toBe(200);

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
