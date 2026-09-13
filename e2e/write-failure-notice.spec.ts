import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * Add race on a scratch series writes straight from the button — there is no
 * dialog to report a refusal in. The write failing used to do nothing at all
 * that the scorer could see, which is how a race day spent a while wondering
 * why the button was inert (#567). The banner is what says so now.
 *
 * The failure is still logged as well, which is what `allowedConsoleErrors`
 * is for: here the log is the subject, not a symptom.
 */
test.use({ allowedConsoleErrors: [/Mutation failed/] });

test('a write that fails with nowhere to report it says so on the banner', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Write Failure Series' });
  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);

  // The POST only: the same path serves the read the handler starts with,
  // and failing that would never reach the write this is about.
  await page.route('**/api/v1/series/*/races', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'internal' }),
        })
      : route.fallback(),
  );

  await page.getByRole('button', { name: 'Add race' }).click();

  const notice = page.getByTestId('notice');
  await expect(notice).toHaveAttribute('data-tone', 'error');
  await expect(notice).toContainText('Couldn’t save');
  await expect(notice).toContainText('Try again');
  // The write is what failed, so nothing landed in the list either.
  await expect(page.getByTestId('race-row')).toHaveCount(0);

  await notice.getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);

  // With the server answering again, the same button works — the banner
  // reported a failure, it didn't leave the page in a broken state.
  await page.unroute('**/api/v1/series/*/races');
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByTestId('race-row')).toHaveCount(1);
});
