import { signedInTest as test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { createSeriesQuick } from './helpers';

/**
 * The spectator viewer (#475, ADR-012): a published `.sailscoring.json` read
 * into an in-memory series and shown through the ordinary series tabs, with
 * no account and no way to change anything. Editing — "what if" experiments
 * included — happens on an imported copy, which is where signing in comes in.
 */

/** Publish a small two-boat, one-race series; returns its data-file path. */
async function publishSeriesWithData(page: Page, name: string): Promise<string> {
  await createSeriesQuick(page, { name });

  for (const [sail, boat] of [['42', 'Alice'], ['77', 'Bob']]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(boat);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  for (const sail of ['42', '77']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('table')).toBeVisible();

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const published = new URL((await link.getAttribute('href')) ?? '').pathname;

  await page.goto(published);
  const dataHref =
    (await page
      .getByRole('link', { name: 'Data (.sailscoring.json)' })
      .getAttribute('href')) ?? '';
  return new URL(dataHref, 'http://localhost').pathname;
}

test('a signed-out reader opens published results and browses every tab', async ({
  page,
  browser,
}) => {
  const dataPath = await publishSeriesWithData(page, 'Spectator League');

  const anon = await browser.newContext();
  const view = await anon.newPage();
  await view.goto(`/open?from=${encodeURIComponent(dataPath)}`);

  // Lands in the series tabs, read-only, on a spectator URL.
  await expect(view).toHaveURL(/\/series\/spectator-[0-9a-f]+\/standings/);
  await expect(view.getByRole('heading', { name: 'Spectator League' })).toBeVisible();
  await expect(view.getByTestId('spectator-banner')).toBeVisible();
  await expect(view.getByRole('cell', { name: '42' }).first()).toBeVisible();

  // On the standings tab itself: nothing that publishes, exports, or stamps
  // the results — every one of those acts on a workspace this view has none
  // of. The tabs that record a workspace's own history are gone with them.
  for (const gone of ['Publish', 'Preview', 'Mark as final']) {
    await expect(view.getByRole('button', { name: gone })).toHaveCount(0);
  }
  for (const gone of ['History', 'Activity', 'Prizes']) {
    await expect(view.getByRole('link', { name: gone })).toHaveCount(0);
  }

  // The setup that produced the results is exactly what a reader came for.
  await view.getByRole('link', { name: 'Competitors' }).click();
  await expect(view.getByRole('cell', { name: 'Alice' })).toBeVisible();
  await expect(view.getByRole('button', { name: 'Add competitor' })).toHaveCount(0);

  // The racing is listed, but a race does not open: the finish sheet is the
  // scorer's entry screen and has no read-only face. Clicking a row does
  // nothing rather than landing the reader somewhere editable.
  await view.getByRole('link', { name: 'Races' }).click();
  await expect(view.getByTestId('race-row')).toBeVisible();
  await expect(view.getByRole('button', { name: 'Add race' })).toHaveCount(0);
  await view.getByTestId('race-row').click();
  await expect(view).toHaveURL(/\/races$/);

  // How the event was scored, stated rather than offered for editing — the
  // question a published page never answers, and the reason to open the data.
  await view.getByRole('link', { name: 'Settings' }).click();
  const setup = view.getByTestId('spectator-settings');
  await expect(setup).toContainText('Scratch (position-based)');
  await expect(setup).toContainText('No discards');
  await expect(setup).toContainText('RRS A5.2');
  await expect(view.getByTestId('publishing-card')).toHaveCount(0);

  await anon.close();
});

test('the view survives a reload and refuses to open in another browser', async ({
  page,
  browser,
}) => {
  const dataPath = await publishSeriesWithData(page, 'Reload League');

  const anon = await browser.newContext();
  const view = await anon.newPage();
  await view.goto(`/open?from=${encodeURIComponent(dataPath)}`);
  await expect(view).toHaveURL(/\/series\/spectator-/);
  const url = view.url();

  // Reloading re-reads the file: same series, same URL, still readable.
  await view.reload();
  await expect(view).toHaveURL(url);
  await expect(view.getByRole('cell', { name: '42' }).first()).toBeVisible();

  // The same URL somewhere that never read the file says so plainly, rather
  // than showing an empty series — the shareable link is the published page.
  const stranger = await browser.newContext();
  const strangerPage = await stranger.newPage();
  await strangerPage.goto(new URL(url).pathname);
  await expect(strangerPage.getByTestId('spectator-unavailable')).toBeVisible();

  await anon.close();
  await stranger.close();
});

test('"Save to my workspace" is the one door, and it asks for sign-in', async ({
  page,
  browser,
}) => {
  const dataPath = await publishSeriesWithData(page, 'Save Door League');

  const anon = await browser.newContext();
  const view = await anon.newPage();
  await view.goto(`/open?from=${encodeURIComponent(dataPath)}`);
  await expect(view.getByTestId('spectator-banner')).toBeVisible();

  await view.getByRole('link', { name: 'Save to my workspace' }).click();
  await expect(view).toHaveURL(/\/sign-in\?callbackURL=/);
  const callback = new URL(view.url()).searchParams.get('callbackURL') ?? '';
  expect(callback).toContain('/import?from=');
  expect(decodeURIComponent(callback)).toContain('.sailscoring.json');
  await anon.close();
});

test('a signed-in reader gets the same read-only view, not their own series', async ({ page }) => {
  const dataPath = await publishSeriesWithData(page, 'Signed In Reader League');

  // Following the link while signed in is an ordinary path — the reader is a
  // scorer somewhere, but this is still someone else's published results.
  await page.goto(`/open?from=${encodeURIComponent(dataPath)}`);
  await expect(page).toHaveURL(/\/series\/spectator-/);
  await expect(page.getByTestId('spectator-banner')).toBeVisible();
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Publish' })).toHaveCount(0);

  // The save door leads straight to the import, with no sign-in in the way.
  await page.getByRole('link', { name: 'Save to my workspace' }).click();
  await expect(page.getByRole('dialog')).toContainText('Signed In Reader League');
  await page.getByRole('button', { name: 'Open series' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/standings/);
  // The copy is a real series in the workspace: editable, and its own thing.
  await expect(page.getByTestId('spectator-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Publish' })).toBeVisible();
});

test('a bad or unpublished link is refused rather than opened', async ({ browser }) => {
  const anon = await browser.newContext();
  const view = await anon.newPage();

  // Not a published data-file path: the viewer is not a fetch relay.
  await view.goto('/open?from=%2Fapi%2Fv1%2Fseries');
  await expect(view.getByTestId('open-error')).toContainText('not a Sail Scoring results link');

  // A path in the right shape whose file is gone reads as unpublished.
  await view.goto('/open?from=%2Fp%2Fnobody%2Fnothing.sailscoring.json');
  await expect(view.getByTestId('open-error')).toContainText('no longer published');

  await anon.close();
});
