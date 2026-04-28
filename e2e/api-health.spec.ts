import { test, expect } from './fixtures';

/**
 * /api/health smoke test, gated on @auth so it only runs in the
 * db-tests workflow (which provisions Postgres). The route's only job
 * is to prove the app's DB connection is live.
 */

test('@auth /api/health returns ok', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ status: 'ok' });
});
