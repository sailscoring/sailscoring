import { test, expect } from './fixtures';

/**
 * /api/health smoke test. The route's only job is to prove the app's
 * DB connection is live.
 */

test('/api/health returns ok', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  const body = await response.json();
  expect(body).toEqual({ status: 'ok' });
});
