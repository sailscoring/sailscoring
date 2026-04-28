import { promises as fs } from 'node:fs';
import path from 'node:path';

import { test, expect } from './fixtures';

/**
 * Magic-link sign-in via the dev sender. Tagged @auth so it only runs
 * in the `db-tests` workflow, which provisions Postgres and applies
 * migrations. The local-first e2e workflow filters this out with
 * `--grep-invert @auth`.
 *
 * The dev sender (lib/auth/email.ts when RESEND_API_KEY is unset)
 * appends every magic-link URL to tests/.magic-links.log; we tail the
 * file and follow the most recent line.
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

test.describe('@auth magic-link sign-in', () => {
  test.beforeAll(async () => {
    await fs.mkdir(path.dirname(MAGIC_LINKS_LOG), { recursive: true });
    await fs.writeFile(MAGIC_LINKS_LOG, '', 'utf8');
  });

  test('signs in and lands in a personal workspace', async ({ page }) => {
    const email = `auth-${Date.now()}@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    await expect(page.getByText(/Check your inbox/i)).toBeVisible();

    const link = await readLatestMagicLink(email);
    await page.goto(link);

    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByText(email)).toBeVisible();
    // The value (`<localpart>'s workspace`), not the label.
    await expect(page.getByText(/'s workspace$/i)).toBeVisible();
  });

  test('signs out from /account', async ({ page }) => {
    const email = `auth-${Date.now()}-out@sailscoring.test`;

    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send magic link' }).click();
    const link = await readLatestMagicLink(email);
    await page.goto(link);
    await expect(page).toHaveURL(/\/account/);

    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('/');
    await page.goto('/account');
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
