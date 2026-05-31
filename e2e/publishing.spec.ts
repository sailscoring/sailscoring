import { signedInTest as test, expect } from './fixtures';
import { type Page } from '@playwright/test';
import { addCompetitor, createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for in-app results publishing (ADR-008 Phase 9/10, the bilge
 * replacement — #153).
 *
 * Publish runs server-side and stores the rendered HTML. With no
 * BLOB_READ_WRITE_TOKEN in the test env, `lib/blob-storage.ts` uses its
 * Postgres fallback, so the whole flow — choose slug → publish → public
 * `/p/{ws}/{series}/standings` page → re-publish — runs against the local
 * database with no external service.
 */

/** New series with one competitor finishing one race; returns the series id. */
async function createSeriesWithData(
  page: Page,
  opts: { name?: string; sail?: string } = {},
): Promise<string> {
  const name = opts.name ?? 'HYC Autumn League 2026';
  const sail = opts.sail ?? '42';
  await createSeriesQuick(page, { name });
  const seriesId = page.url().match(/\/series\/([0-9a-f-]{36})/)?.[1];
  if (!seriesId) throw new Error(`Not on a series page: ${page.url()}`);

  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill(sail);
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill(sail);
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  return seriesId;
}

/** New two-fleet (scratch) series — fleets "IRC" and "Cruiser", one boat each
 *  finishing one race. Leaves the page on the Standings tab. */
async function createTwoFleetSeries(page: Page, name: string): Promise<void> {
  await createSeriesQuick(page, { name });
  await createFleets(page, ['IRC', 'Cruiser']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const c of [
    { sail: '11', name: 'Alice', fleet: 'IRC' },
    { sail: '22', name: 'Bob', fleet: 'Cruiser' },
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sail);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('checkbox', { name: c.fleet }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  for (const sail of ['11', '22']) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('heading', { name: 'IRC' })).toBeVisible();
}

test('publish with a chosen slug → public page renders → bare slug lists the fleet → re-publish freezes the URL', async ({ page }) => {
  const seriesId = await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();

  // The slug is pre-filled from the series name and editable before publishing.
  const slugInput = dialog.getByLabel('URL slug');
  await expect(slugInput).toHaveValue('hyc-autumn-league-2026');
  await slugInput.fill('autumn-26');

  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Published: a /p/{ws}/{series}/standings link appears.
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).toMatch(/\/p\/[^/]+\/autumn-26\/standings$/);
  const path = new URL(href).pathname;

  // The public, unauthenticated page renders the standings.
  await page.goto(path);
  await expect(page.getByText('HYC Autumn League 2026').first()).toBeVisible();
  await expect(page.getByText('42').first()).toBeVisible();

  // The bare series slug now serves the per-publication listing (#162): a
  // one-item "Standings" listing for this single-fleet series, linking back to
  // the fleet page.
  const bare = path.replace(/\/standings$/, '');
  await page.goto(bare);
  await expect(page.getByText('HYC Autumn League 2026')).toBeVisible();
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/autumn-26\/standings$/);
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();

  // Re-open: the slug is frozen (no input) and re-publishing keeps the URL.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('URL slug')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
});

test('workspace index lists published series and links through to a fleet page', async ({ page }) => {
  await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;
  const workspaceSlug = path.split('/')[2];

  // The public workspace listing names the series and links to its index.
  await page.goto(`/p/${workspaceSlug}`);
  const seriesLink = page.getByRole('link', { name: 'HYC Autumn League 2026' });
  await expect(seriesLink).toBeVisible();
  await seriesLink.click();

  // → series index → fleet page renders the standings.
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();
});

test('back-links chain a fleet page up to its series index and on to the workspace index', async ({ page }) => {
  await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('URL slug').fill('autumn-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const fleetPath = new URL((await link.getAttribute('href')) ?? '').pathname;
  const workspaceSlug = fleetPath.split('/')[2];

  // Fleet page → breadcrumb up to the series index `/p/{ws}/autumn-26`.
  await page.goto(fleetPath);
  await page.getByRole('link', { name: 'HYC Autumn League 2026' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${workspaceSlug}/autumn-26$`));

  // Series index → back-link up to the workspace index `/p/{ws}`.
  await page.locator(`a[href="/p/${workspaceSlug}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/p/${workspaceSlug}$`));
  await expect(page.getByRole('link', { name: 'HYC Autumn League 2026' })).toBeVisible();
});

test('re-publishing is reflected on the public page immediately', async ({ page }) => {
  const seriesId = await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  await page.goto(path);
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();
  await expect(page.getByRole('cell', { name: '99' })).toHaveCount(0);

  // Add a second finisher, then re-publish.
  await page.goto(`/series/${seriesId}/competitors`);
  await addCompetitor(page, { sailNumber: '99', name: 'Bob' });
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();
  await page.getByLabel('Sail number').fill('99');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  // Re-publish rebuilds from the database, so wait until a fresh server fetch
  // confirms the new finisher persisted before publishing — the autosave
  // indicator can read "All changes saved" from a prior save before this write
  // commits. Re-navigating retries the fetch until the standings include 99, so
  // the re-publish is a genuine content change rather than a same-hash no-op.
  await expect(async () => {
    await page.goto(`/series/${seriesId}/standings`);
    await expect(page.getByRole('cell', { name: '99' }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  // Wait for the re-publish POST itself: the dialog already shows the (frozen)
  // URL before re-publishing, so the link being visible doesn't mean the new
  // HTML has been stored yet.
  const [publishResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/series/${seriesId}/publish`) &&
        r.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Re-publish' }).click(),
  ]);
  expect(publishResp.ok()).toBeTruthy();

  // The read path serves the re-published results immediately — no propagation
  // wait. Each re-publish writes a fresh content-addressed blob (the DB row
  // points straight at it), so there's no Blob overwrite lag to sidestep, and an
  // unchanged-hash 304 can't mask a real change. `no-cache` on the response
  // means a real browser refresh revalidates rather than showing a stale copy.
  const fresh = await page.request.get(path);
  expect(fresh.headers()['cache-control']).toContain('no-cache');
  expect(await fresh.text()).toContain('>99<');
});

test('workspace Published page lists a publication and unpublishing frees the slug', async ({ page }) => {
  const seriesId = await createSeriesWithData(page);

  // Publish under a chosen slug.
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('URL slug').fill('autumn-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  // The public page is live.
  expect((await page.request.get(path)).status()).toBe(200);

  // The workspace Published management page lists it with its public URL.
  await page.goto('/workspace');
  await expect(
    page.getByRole('heading', { name: 'Published results' }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: /\/autumn-26$/ })).toBeVisible();

  // Unpublish (a confirm dialog guards it) → the row goes and the page 404s.
  const unpublishBtn = page.getByRole('button', {
    name: 'Unpublish HYC Autumn League 2026',
  });
  page.once('dialog', (d) => d.accept());
  await unpublishBtn.click();
  await expect(unpublishBtn).not.toBeVisible();
  await expect(page.getByText('Nothing published yet.')).toBeVisible();
  expect((await page.request.get(path)).status()).toBe(404);

  // The slug freed: the series re-opens to a first-publish dialog (the slug
  // input is back) and re-publishing under the same slug succeeds — were the
  // slug still held this would fail with a slug-in-use error.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  const slugInput = dialog.getByLabel('URL slug');
  await expect(slugInput).toBeVisible();
  await slugInput.fill('autumn-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
});

test('an orphaned snapshot (series deleted) stays listed and can be unpublished', async ({ page }) => {
  await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('URL slug').fill('orphan-me');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByRole('link', { name: /orphan-me/ })).toBeVisible();

  // Delete the series — its publication orphans (seriesId → null) rather than
  // being removed, so the public page stays up. Delete is gated behind
  // archiving first (#154): archive from the card menu, then delete from the
  // Archived section.
  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for HYC Autumn League 2026' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  await page.getByRole('button', { name: /Archived \(1\)/ }).click();
  await page.getByRole('button', { name: 'Actions for HYC Autumn League 2026' }).click();
  await page.getByRole('menuitem', { name: /Delete/ }).click();
  await page.getByRole('button', { name: 'Delete series' }).click();
  await expect(page.getByText('HYC Autumn League 2026')).not.toBeVisible();

  // The workspace Published page is the only surface that manages it: marked as
  // orphaned, titled by its slug, and still unpublishable.
  await page.goto('/workspace');
  await expect(page.getByText('series deleted')).toBeVisible();
  const unpublishBtn = page.getByRole('button', { name: 'Unpublish orphan-me' });
  await expect(unpublishBtn).toBeVisible();
  page.once('dialog', (d) => d.accept());
  await unpublishBtn.click();
  await expect(unpublishBtn).not.toBeVisible();
  await expect(page.getByText('Nothing published yet.')).toBeVisible();
});

test('two series publish into one shared slug → the listing unions both, sub-headed per series', async ({ page }) => {
  // First series publishes at a deliberately event-shaped slug.
  await createSeriesWithData(page, { name: 'Lambay Races Cruisers', sail: '11' });
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('URL slug').fill('2026-lambay-races');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const firstLink = dialog.getByRole('link', { name: /\/p\// });
  await expect(firstLink).toBeVisible();
  const indexPath = new URL((await firstLink.getAttribute('href')) ?? '').pathname.replace(
    /\/standings$/,
    '',
  );
  // As the sole contributor its single fleet keeps the clean "standings" path.
  await expect(firstLink).toHaveText(/\/2026-lambay-races\/standings$/);

  // Second series targets the same slug: publishing is blocked until the scorer
  // confirms joining the existing event, so two events never merge by accident.
  await createSeriesWithData(page, { name: 'Lambay Races One Designs', sail: '22' });
  await page.getByRole('button', { name: 'Publish' }).click();
  await dialog.getByLabel('URL slug').fill('2026-lambay-races');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByText(/already has results from Lambay Races Cruisers/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish into existing event' }).click();
  // A co-published default fleet lands at the series slug, not "standings".
  await expect(
    dialog.getByRole('link', { name: /\/2026-lambay-races\/lambay-races-one-designs$/ }),
  ).toBeVisible();

  // The shared listing unions both series, each under its own sub-heading.
  await page.goto(indexPath);
  await expect(page.getByRole('heading', { name: '2026 Lambay Races' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lambay Races Cruisers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lambay Races One Designs' })).toBeVisible();

  // Both fleet pages resolve under the one slug.
  await page.goto(`${indexPath}/standings`);
  await expect(page.getByRole('cell', { name: '11' }).first()).toBeVisible();
  await page.goto(`${indexPath}/lambay-races-one-designs`);
  await expect(page.getByRole('cell', { name: '22' }).first()).toBeVisible();
});

test('selective publishing: choose fleets and override a fleet URL segment', async ({ page }) => {
  await createTwoFleetSeries(page, 'HYC Club Series 1');

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('URL slug').fill('club-1');

  // The IRC fleet's URL segment defaults to the kebab name; override it so a
  // clean fleet name can live at a disambiguated URL.
  const ircUrl = dialog.getByRole('textbox', { name: 'URL for IRC' });
  await expect(ircUrl).toHaveValue('irc');
  await ircUrl.fill('div-a-irc');

  // Leave Cruiser out of this publication.
  await dialog.getByRole('checkbox', { name: 'Publish Cruiser' }).uncheck();

  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // IRC published at the overridden path; the public page renders.
  const link = dialog.getByRole('link', { name: /\/club-1\/div-a-irc$/ });
  await expect(link).toBeVisible();
  const ircPath = new URL((await link.getAttribute('href')) ?? '').pathname;
  const base = ircPath.replace(/\/div-a-irc$/, '');

  await page.goto(ircPath);
  await expect(page.getByRole('cell', { name: '11' }).first()).toBeVisible();

  // The kebab default for IRC never existed (it moved to the override), and the
  // deselected Cruiser fleet was never published — both 404.
  expect((await page.request.get(`${base}/irc`)).status()).toBe(404);
  expect((await page.request.get(`${base}/cruiser`)).status()).toBe(404);
});

test('unticking a published fleet on re-publish leaves its page live and unchanged', async ({ page }) => {
  const seriesId = await (async () => {
    await createTwoFleetSeries(page, 'HYC Club Series 2');
    return page.url().match(/\/series\/([0-9a-f-]{36})/)?.[1] ?? '';
  })();

  // First publish: both fleets.
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('URL slug').fill('club-2');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  const ircLink = dialog.getByRole('link', { name: /\/club-2\/irc$/ });
  await expect(ircLink).toBeVisible();
  const ircPath = new URL((await ircLink.getAttribute('href')) ?? '').pathname;
  const base = ircPath.replace(/\/irc$/, '');
  expect((await page.request.get(`${base}/irc`)).status()).toBe(200);
  const cruiserBefore = await page.request.get(`${base}/cruiser`);
  expect(cruiserBefore.status()).toBe(200);
  expect(await cruiserBefore.text()).not.toContain('>C9<');

  // Add a new Cruiser boat after publishing — work-in-progress for that fleet.
  await page.goto(`/series/${seriesId}/competitors`);
  await addCompetitor(page, { sailNumber: 'C9', name: 'Carol', fleet: 'Cruiser' });

  // Re-publish with Cruiser unticked: it's skipped, not retracted.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await dialog.getByRole('checkbox', { name: 'Publish Cruiser' }).uncheck();
  const [resp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/series/${seriesId}/publish`) &&
        r.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Re-publish' }).click(),
  ]);
  expect(resp.ok()).toBeTruthy();

  // Cruiser's page stays live at its frozen URL, still showing the pre-edit
  // content (the new boat was not published because Cruiser was unticked).
  const cruiserSkipped = await page.request.get(`${base}/cruiser`);
  expect(cruiserSkipped.status()).toBe(200);
  expect(await cruiserSkipped.text()).not.toContain('>C9<');
  expect((await page.request.get(`${base}/irc`)).status()).toBe(200);

  // Re-publish with Cruiser ticked (its default once published) now updates it.
  // Retry the standings fetch until the new boat persisted, so the re-publish is
  // a genuine content change rather than a same-hash no-op.
  await expect(async () => {
    await page.goto(`/series/${seriesId}/standings`);
    await expect(page.getByRole('cell', { name: 'C9' }).first()).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 15000 });
  await page.getByRole('button', { name: 'Publish' }).click();
  const [resp2] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes(`/series/${seriesId}/publish`) &&
        r.request().method() === 'POST',
    ),
    dialog.getByRole('button', { name: 'Re-publish' }).click(),
  ]);
  expect(resp2.ok()).toBeTruthy();
  const cruiserUpdated = await page.request.get(`${base}/cruiser`);
  expect(await cruiserUpdated.text()).toContain('>C9<');
});

test('keyboard shortcut p opens the publish dialog', async ({ page }) => {
  await createSeriesWithData(page);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
});
