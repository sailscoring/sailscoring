import { createHash, randomBytes } from 'node:crypto';

import { test, expect } from './fixtures';
import {
  enableFeatures,
  readLatestMagicLink,
  registerOAuthClient,
  signInFreshUser,
} from './helpers';

/**
 * Connecting an outside app, and signing the CLI in (ADR-016), through the
 * pages a person actually sees: sign-in, the workspace choice, consent, and
 * the device code page.
 */

const REDIRECT = 'http://127.0.0.1:9999/callback';

function pkce() {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

test.describe('connecting an app', () => {
  test('a signed-out user signs in, chooses the workspace and allows the app', async ({ page, request }) => {
    const email = await signInFreshUser(page, 'oauth-connect');
    await enableFeatures(page, email, ['connected-apps']);
    const clientId = await registerOAuthClient('app');
    await page.context().clearCookies();

    // The app's redirect lands nowhere real; answer it here.
    await page.route(`${REDIRECT}**`, (route) => route.fulfill({ body: 'back at the app' }));

    const { verifier, challenge } = pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'read races offline_access',
      state: 'e2e-state',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    await page.goto(`/api/auth/oauth2/authorize?${query}`);

    // Signed out: the sign-in page, and the magic link carries on to the app's request.
    await expect(page).toHaveURL(/\/sign-in\?/);
    const firstLink = await readLatestMagicLink(email);
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    await page.goto(await readLatestMagicLink(email, firstLink));

    await expect(page.getByTestId('oauth-workspace')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Connect Course plotter' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'My Workspace' })).toBeChecked();
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByTestId('oauth-consent')).toBeVisible();
    const scopes = page.getByTestId('oauth-consent-scopes');
    await expect(scopes).toContainText('See the workspace’s series');
    await expect(scopes).toContainText('set each start’s course');
    await expect(scopes).not.toContainText('Publish');
    const backAtApp = page.waitForRequest((r) => r.url().startsWith(REDIRECT));
    await page.getByTestId('oauth-consent-allow').click();
    const back = new URL((await backAtApp).url());
    expect(back.searchParams.get('state')).toBe('e2e-state');
    const code = back.searchParams.get('code');
    expect(code).toBeTruthy();

    const token = await request.post('/api/auth/oauth2/token', {
      form: { grant_type: 'authorization_code', code: code!, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier },
    });
    expect(token.status()).toBe(200);
    expect((await token.json()).access_token).toMatch(/^ssat_/);
  });

  test('a workspace without connected apps is not offered', async ({ page }) => {
    await signInFreshUser(page, 'oauth-ungated');
    const clientId = await registerOAuthClient('app');
    const { challenge } = pkce();
    const query = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope: 'read',
      state: 's',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    await page.goto(`/api/auth/oauth2/authorize?${query}`);
    await expect(page.getByTestId('oauth-no-workspace')).toBeVisible();
  });

  test('the CLI is signed in with the code it printed', async ({ page, request }) => {
    const email = await signInFreshUser(page, 'oauth-device');
    const clientId = await registerOAuthClient('cli');
    const issued = await request.post('/api/auth/device/code', {
      form: { client_id: clientId, scope: 'read races publish offline_access' },
    });
    const { device_code: deviceCode, user_code: userCode } = await issued.json();

    await page.goto(`/device?user_code=${userCode}`);
    await expect(page.getByTestId('device-approval')).toContainText(email);
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByTestId('device-approved')).toBeVisible();

    const token = await request.post('/api/auth/oauth2/token', {
      form: { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: deviceCode, client_id: clientId },
    });
    expect(token.status()).toBe(200);
    expect((await token.json()).access_token).toMatch(/^ssat_/);
  });
});
