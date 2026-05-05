import { promises as fs } from 'node:fs';
import path from 'node:path';

import { test, expect } from './fixtures';
import { signInFreshUser } from './helpers';

/**
 * Covers the in-app feedback form (#123). Tagged @auth so it runs only in
 * the server-mode Playwright project, where FEEDBACK_TO is set in
 * playwright.config.ts and the `.test` TLD makes the email helper write
 * to `tests/.feedback.log` instead of calling Resend.
 */

const FEEDBACK_LOG = path.join(process.cwd(), 'tests', '.feedback.log');

async function readLogLines(): Promise<unknown[]> {
  try {
    const text = await fs.readFile(FEEDBACK_LOG, 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

test.describe('@auth feedback form', () => {
  test('signed-in user can open the menu, submit feedback, and hit the rate limit', async ({
    page,
    request,
  }) => {
    const email = await signInFreshUser(page, 'feedback');

    // Open the user menu and click "Send feedback".
    await page.getByTestId('user-menu').click();
    await page.getByTestId('user-menu-feedback').click();

    // The dialog should display the signed-in email and current page URL.
    const dialog = page.getByTestId('feedback-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(email);
    await expect(dialog).toContainText(page.url());

    const message = `e2e feedback ${Date.now()}`;
    await page.getByTestId('feedback-message').fill(message);
    await page.getByTestId('feedback-submit').click();

    await expect(page.getByTestId('feedback-success')).toBeVisible();

    // Confirm the file-log path picked up our submission.
    const lines = await readLogLines();
    const ours = lines.find(
      (l): l is { userEmail: string; message: string } =>
        typeof l === 'object' &&
        l !== null &&
        (l as { message?: string }).message === message,
    );
    expect(ours).toBeTruthy();
    expect(ours!.userEmail).toBe(email);

    // Now exhaust the rate limit. We've submitted 1 already; do 4 more
    // direct posts to bring us to 5, then expect the 6th to 400.
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    for (let i = 0; i < 4; i++) {
      const res = await request.post('/api/v1/feedback', {
        headers: { cookie: cookieHeader, 'content-type': 'application/json' },
        data: { message: `flood ${i}`, pageUrl: 'https://app.sailscoring.test/x' },
      });
      expect(res.status()).toBe(204);
    }
    const sixth = await request.post('/api/v1/feedback', {
      headers: { cookie: cookieHeader, 'content-type': 'application/json' },
      data: { message: 'overflow', pageUrl: 'https://app.sailscoring.test/x' },
    });
    expect(sixth.status()).toBe(400);
    const body = (await sixth.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid');
    expect(body.message).toMatch(/rate limit/i);
  });
});
