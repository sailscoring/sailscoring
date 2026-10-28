import { createHash, randomBytes } from 'node:crypto';

import { test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures, registerOAuthClient, signInFreshUser } from './helpers';

/**
 * History names the outside app a change was made through (ADR-016), as the
 * Activity tab does: a race day sent from a course-plotting page reads
 * differently from one the scorer typed in.
 */

const REDIRECT = 'http://127.0.0.1:9999/callback';

test('history names the app a change came through', async ({ page, request }) => {
  const email = await signInFreshUser(page, 'history-app');
  await enableFeatures(page, email, ['connected-apps']);
  const clientId = await registerOAuthClient('app');
  await createSeriesQuick(page, { name: 'Through an App Series' });
  const seriesId = page.url().match(/\/series\/([0-9a-f-]{36})\//)![1];

  // Connect the app, already signed in: choose the workspace, allow it.
  await page.route(`${REDIRECT}**`, (route) => route.fulfill({ body: 'back at the app' }));
  const verifier = randomBytes(32).toString('base64url');
  const query = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: REDIRECT,
    scope: 'read races offline_access',
    state: 'e2e-state',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  });
  await page.goto(`/api/auth/oauth2/authorize?${query}`);
  await page.getByRole('button', { name: 'Continue' }).click();
  const backAtApp = page.waitForRequest((r) => r.url().startsWith(REDIRECT));
  await page.getByTestId('oauth-consent-allow').click();
  const code = new URL((await backAtApp).url()).searchParams.get('code')!;
  await page.unroute(`${REDIRECT}**`);
  const token = await request.post('/api/auth/oauth2/token', {
    form: { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier },
  });
  const { access_token: accessToken } = (await token.json()) as { access_token: string };

  const added = await request.post(`/api/public/v1/series/${seriesId}/races`, {
    headers: { authorization: `Bearer ${accessToken}` },
    data: { races: [{ date: '2026-10-25' }] },
  });
  expect(added.status()).toBe(200);

  await page.goto(`/series/${seriesId}/history`);
  const revision = page.getByTestId('revision-list').getByRole('listitem').filter({ hasText: 'Added Race 1' });
  await expect(revision).toContainText('via Course plotter');
  // What the scorer did in Sail Scoring itself, creating the series, names no app.
  await expect(
    page.getByTestId('revision-list').getByRole('listitem').filter({ hasText: 'via Course plotter' }),
  ).toHaveCount(1);
});
