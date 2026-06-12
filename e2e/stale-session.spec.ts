import { signedInTest as test, expect } from './fixtures';

import { deleteUserSessions } from './helpers';

/**
 * Regression test for issue #181: a present-but-invalid session cookie
 * (session revoked server-side, or the DB wiped while the browser kept
 * `better-auth.session_token`) must bounce to sign-in, not strand the
 * user on the authenticated shell with "Loading…" forever.
 *
 * The proxy's cookie check is optimistic — presence only — so the request
 * reaches the page, the data fetches 401, and the QueryCache-level
 * AuthError handler (app/providers.tsx) clears the stale cookie and
 * redirects.
 */

test('stale session cookie redirects to sign-in and self-heals', async ({
  page,
  signedInEmail,
}) => {
  // Sanity: signed in and on the authenticated home page.
  await page.goto('/');
  await expect(page.getByText(/No series yet/)).toBeVisible();

  // Revoke the session server-side; the browser keeps its cookie.
  await deleteUserSessions(signedInEmail);

  // Reload: the series-list fetch 401s and the client bounces to
  // sign-in with the original path as callbackURL.
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2F$/);
  await expect(
    page.getByRole('button', { name: 'Send sign-in link' }),
  ).toBeVisible();

  // Self-heal: the redirect cleared the stale cookie, so the next visit
  // is caught by the proxy's cookie check directly — no authenticated
  // shell, no redirect loop.
  const cookies = await page.context().cookies();
  expect(
    cookies.filter((c) => c.name.includes('session_token')),
  ).toHaveLength(0);
  await page.goto('/');
  await expect(page).toHaveURL(/\/sign-in\?callbackURL=%2F$/);
});
