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

/** New series with one competitor finishing one race; returns the series id.
 *  `unknownSail` additionally records an unresolved unknown-sail crossing. */
async function createSeriesWithData(
  page: Page,
  opts: { name?: string; sail?: string; date?: string; unknownSail?: string } = {},
): Promise<string> {
  const name = opts.name ?? 'HYC Autumn League 2026';
  const sail = opts.sail ?? '42';
  await createSeriesQuick(page, { name, date: opts.date });
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
  if (opts.unknownSail) {
    await page.getByLabel('Sail number').fill(opts.unknownSail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('button', { name: 'Record as unknown' }).click();
  }
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

test('publish into Season + Folder → public page renders → the folder lists the page → re-publish freezes the URL', async ({ page }) => {
  const seriesId = await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();

  // The season derives (the current year for an undated series); the folder
  // is seeded from the series name and editable before publishing.
  await expect(dialog.getByLabel('Season')).toHaveValue('2026');
  const folderInput = dialog.getByLabel('Folder');
  await expect(folderInput).toHaveValue('hyc-autumn-league-2026');
  await folderInput.fill('autumn-26');

  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Published: a /p/{ws}/{season}/{folder}/standings link appears.
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href')) ?? '';
  expect(href).toMatch(/\/p\/[^/]+\/2026\/autumn-26\/standings$/);
  const path = new URL(href).pathname;

  // The public, unauthenticated page renders the standings.
  await page.goto(path);
  await expect(page.getByText('HYC Autumn League 2026').first()).toBeVisible();
  await expect(page.getByText('42').first()).toBeVisible();

  // The event folder serves its own index: a one-item "Standings" listing
  // for this single-fleet series, linking back to the fleet page.
  const bare = path.replace(/\/standings$/, '');
  await page.goto(bare);
  // The folder's label is pinned to the series name at first publish.
  await expect(page.getByRole('heading', { name: 'HYC Autumn League 2026' })).toBeVisible();
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/autumn-26\/standings$/);
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();

  // Re-open: the destination is frozen (no inputs) and re-publishing keeps
  // the URL.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Folder')).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByRole('link', { name: /\/autumn-26\/standings$/ })).toBeVisible();
});

test('an unresolved unknown-sail crossing publishes cleanly and stays out of the data file (#198, ADR-012)', async ({ page }) => {
  await createSeriesWithData(page, {
    name: 'Unknown Crossing League',
    unknownSail: '9999',
  });

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  // The publish ran server-side with the unresolved row present (#198 was a
  // crash here). The published data file carries the resolved finish but not
  // the unresolved crossing — that is the scorer's unfinished business, not
  // published output (the v2 export contract, ADR-012).
  await page.goto(path);
  const dataHref =
    (await page
      .getByRole('link', { name: 'Data (.sailscoring.json)' })
      .getAttribute('href')) ?? '';
  const exported = await (await page.request.get(dataHref)).json();
  const finishes = exported.races.flatMap(
    (r: { finishes: { sailNumber: string; unknownSailNumber?: string }[] }) => r.finishes,
  );
  expect(finishes.some((f: { sailNumber: string }) => f.sailNumber === '42')).toBe(true);
  expect(finishes.some((f: { unknownSailNumber?: string }) => f.unknownSailNumber != null)).toBe(false);
});

test('the publication serves a .sailscoring.json data file and pages reference it (ADR-012)', async ({ page }) => {
  await createSeriesWithData(page, { name: 'Data File League', sail: '17' });
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  // The footer references the data file instead of embedding the payload.
  await page.goto(path);
  const openHref =
    (await page
      .getByRole('link', { name: 'Open in Sail Scoring' })
      .getAttribute('href')) ?? '';
  expect(openHref).toContain('/open?from=');
  expect(openHref).not.toContain('#data=');
  const dataHref =
    (await page
      .getByRole('link', { name: 'Data (.sailscoring.json)' })
      .getAttribute('href')) ?? '';
  expect(dataHref).toMatch(/\.sailscoring\.json$/);

  // The file serves as JSON with an open CORS header and parses as the
  // public export the page was rendered from.
  const res = await page.request.get(dataHref);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/json');
  expect(res.headers()['access-control-allow-origin']).toBe('*');
  const exported = await res.json();
  expect(exported.version).toBe(2);
  expect(exported.series.name).toBe('Data File League');

  // Signed in, /import?from= fetches the file and opens a copy.
  const from = new URL(dataHref, 'http://localhost').pathname;
  await page.goto(`/import?from=${encodeURIComponent(from)}`);
  await expect(page.getByRole('dialog')).toContainText('Data File League');

  // The import runs server-side and takes real time on a real event, so the
  // page has to say so — it used to close the dialog and show nothing at all
  // under the header until the new series loaded. Held open here so the wait
  // is observable rather than raced.
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/v1/series/import', async (route) => {
    await held;
    await route.continue();
  });
  await page.getByRole('button', { name: 'Open series' }).click();
  const busy = page.getByTestId('import-working');
  await expect(busy).toContainText('Data File League');
  await expect(busy.getByRole('button')).toHaveCount(0);
  release();

  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/standings/);
  await expect(page.getByRole('cell', { name: '17' }).first()).toBeVisible();
});

test('signed out, Open in Sail Scoring opens the results rather than a login (#465, #475)', async ({ page, browser }) => {
  await createSeriesWithData(page, { name: 'Signed Out League' });
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  // The failure in #465 was that this link dropped the series for a reader
  // with no session — which is nearly every reader of a published page. It
  // now lands them in a read-only view of those results (#475); signing in
  // is asked for only if they go on to save a copy.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(path);
  await anonPage.getByRole('link', { name: 'Open in Sail Scoring' }).click();
  await expect(anonPage).toHaveURL(/\/series\/spectator-/);
  await expect(anonPage.getByRole('heading', { name: 'Signed Out League' })).toBeVisible();
  await expect(anonPage.getByRole('cell', { name: '42' }).first()).toBeVisible();
  await anon.close();
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

test('published pages carry CDN cache headers and a workspace purge tag', async ({
  page,
}) => {
  await createSeriesWithData(page);
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  const res = await page.request.get(path);
  expect(res.status()).toBe(200);
  const headers = res.headers();

  // The browser is still told to revalidate on every view, so it can never
  // hold a stale copy — the freshness guarantee is unchanged.
  expect(headers['cache-control']).toBe('public, no-cache');
  expect(headers['etag']).toBeTruthy();

  // The CDN is told something different, and only the CDN sees it: it may
  // answer that revalidation itself for a minute rather than waking a
  // function. Vercel consumes this header at the edge, so it never reaches a
  // real browser — it is visible here only because there is no CDN in front
  // of the local test server.
  expect(headers['vercel-cdn-cache-control']).toBe('public, s-maxage=60');

  // One tag per workspace, so publishing can drop every page it might have
  // changed — the navigation cascade means that is potentially all of them.
  expect(headers['vercel-cache-tag']).toMatch(/^p:.+/);
});

test('the workspace logo appears in the published index hero', async ({ page }) => {
  // Give the workspace a logo (a built-in one), then publish a series.
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Choose workspace logo' }).click();
  await page.getByRole('dialog').getByLabel('Search logos').fill('Howth');
  await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().includes('/api/v1/workspace') &&
        r.request().method() === 'PATCH' &&
        r.ok(),
    ),
    page.getByRole('dialog').getByRole('button', { name: 'Use Howth Yacht Club' }).click(),
  ]);

  await createSeriesWithData(page);
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const workspaceSlug = new URL((await link.getAttribute('href')) ?? '').pathname.split('/')[2];

  // The public workspace index hero shows the workspace logo.
  await page.goto(`/p/${workspaceSlug}`);
  const heroLogo = page.locator('.hero .wslogo img');
  await expect(heroLogo).toBeVisible();
  await expect(heroLogo).toHaveAttribute('src', /\/canonical-logos\/hyc\.png$/);
});

test('back-links chain a fleet page up to its series index and on to the workspace index', async ({ page }) => {
  await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('autumn-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const fleetPath = new URL((await link.getAttribute('href')) ?? '').pathname;
  const workspaceSlug = fleetPath.split('/')[2];

  // Fleet page → breadcrumb up to its event folder `/p/{ws}/2026/autumn-26`.
  await page.goto(fleetPath);
  await page.getByRole('link', { name: 'HYC Autumn League 2026' }).click();
  await expect(page).toHaveURL(new RegExp(`/p/${workspaceSlug}/2026/autumn-26$`));

  // Folder index → back-link up to the season index, titled by the season.
  await page.locator(`a[href="/p/${workspaceSlug}/2026"]`).click();
  await expect(page).toHaveURL(new RegExp(`/p/${workspaceSlug}/2026$`));

  // Season index → back-link up to the workspace index `/p/{ws}`.
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

  // Publish into a chosen folder.
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('autumn-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;

  // The public page is live.
  expect((await page.request.get(path)).status()).toBe(200);

  // The workspace Published tab lists it with its public URL.
  await page.goto('/workspace/published');
  await expect(
    page.getByRole('heading', { name: 'Published results' }),
  ).toBeVisible();
  await expect(page.getByText('1 page published')).toBeVisible();
  await expect(page.getByRole('link', { name: /\/2026$/ })).toBeVisible();

  // Unpublish (a confirmation guards it) → the row goes and the page 404s.
  const unpublishBtn = page.getByRole('button', {
    name: 'Unpublish HYC Autumn League 2026',
  });
  await unpublishBtn.click();
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(unpublishBtn).not.toBeVisible();
  await expect(page.getByText('Nothing published yet.')).toBeVisible();
  expect((await page.request.get(path)).status()).toBe(404);

  // The path freed: the series re-opens to a first-publish dialog (the
  // folder input is back) and re-publishing into the same folder succeeds —
  // were the path still held this would fail with a collision error.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  const folderInput = dialog.getByLabel('Folder');
  await expect(folderInput).toBeVisible();
  await folderInput.fill('autumn-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const republished = dialog.getByRole('link', { name: /\/autumn-26\/standings$/ });
  await expect(republished).toBeVisible();
  const republishedPath = new URL(
    (await republished.getAttribute('href')) ?? '',
  ).pathname;

  // Unpublishing from inside the publish dialog: the confirmation is raised
  // from one dialog and lands on top of it, and answering it leaves the
  // publish dialog usable — back to its first-publish state.
  await dialog.getByRole('button', { name: 'Unpublish' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    'Unpublish “HYC Autumn League 2026”?',
  );
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByTestId('confirm-dialog')).toHaveCount(0);
  await expect(dialog.getByLabel('Folder')).toBeVisible();
  expect((await page.request.get(republishedPath)).status()).toBe(404);
});

test('an orphaned snapshot (series deleted) stays listed and can be unpublished', async ({ page }) => {
  await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('orphan-me');
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

  // The workspace Published tab is the only surface that manages it:
  // relegated to its own "Series deleted" section, titled by its event
  // folder's pinned label (the old series name), and still unpublishable.
  await page.goto('/workspace/published');
  await expect(
    page.getByRole('heading', { name: 'Series deleted' }),
  ).toBeVisible();
  const unpublishBtn = page.getByRole('button', {
    name: 'Unpublish HYC Autumn League 2026',
  });
  await expect(unpublishBtn).toBeVisible();
  await unpublishBtn.click();
  // The series is gone, so this page is the final copy — a removal, not an
  // unpublish, and the confirmation says so.
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    'the final copy',
  );
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(unpublishBtn).not.toBeVisible();
  await expect(page.getByText('Nothing published yet.')).toBeVisible();
});

test('two series publish into one event folder → the folder lists both, no merge ceremony', async ({ page }) => {
  // First series into the event folder, its page named for its class group.
  await createSeriesWithData(page, { name: 'Lambay Races Cruisers', sail: '11' });
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('lambay-races');
  await dialog.getByLabel('Page URL').fill('cruisers');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const firstLink = dialog.getByRole('link', { name: /\/p\// });
  await expect(firstLink).toBeVisible();
  await expect(firstLink).toHaveText(/\/2026\/lambay-races\/cruisers$/);
  const folderPath = new URL(
    (await firstLink.getAttribute('href')) ?? '',
  ).pathname.replace(/\/cruisers$/, '');

  // Second series publishes into the same event folder — no ceremony, just a
  // distinct page segment (the default `standings` would collide).
  await createSeriesWithData(page, { name: 'Lambay Races One Designs', sail: '22' });
  await page.getByRole('button', { name: 'Publish' }).click();
  await dialog.getByLabel('Folder').fill('lambay-races');
  await dialog.getByLabel('Page URL').fill('one-designs');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    dialog.getByRole('link', { name: /\/2026\/lambay-races\/one-designs$/ }),
  ).toBeVisible();

  // The folder index lists both pages, each named after its series (the
  // fleet names are synthetic); a shared folder reads by its segment, not
  // the first publisher's series name.
  await page.goto(folderPath);
  await expect(page.getByRole('heading', { name: 'Lambay Races' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lambay Races Cruisers' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lambay Races One Designs' })).toBeVisible();

  // The season index unions the season's series, sub-headed per series.
  await page.goto(folderPath.replace(/\/lambay-races$/, ''));
  await expect(page.getByRole('heading', { name: 'Lambay Races Cruisers' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Lambay Races One Designs' })).toBeVisible();

  // On a fleet page the cascade's leaf spans the folder, so the sibling
  // series' page is one link away, each named after its series.
  await page.goto(`${folderPath}/cruisers`);
  await expect(page.getByRole('cell', { name: '11' }).first()).toBeVisible();
  await expect(page.locator('.sstreenav .sstreenav-current')).toHaveText(
    'Lambay Races Cruisers',
  );
  await page
    .locator('.sstreenav')
    .getByRole('link', { name: 'Lambay Races One Designs' })
    .click();
  await expect(page).toHaveURL(/\/2026\/lambay-races\/one-designs$/);
  await expect(page.getByRole('cell', { name: '22' }).first()).toBeVisible();

  // The workspace index's event row links each contributing series' page by
  // name — never the folder segment — one click from the index (ADR-011).
  await page.goto(`/p/${folderPath.split('/')[2]}`);
  const row = page.locator('li[data-event="2026/lambay-races"]');
  await row
    .locator('.pages')
    .getByRole('link', { name: 'Lambay Races One Designs' })
    .click();
  await expect(page).toHaveURL(/\/2026\/lambay-races\/one-designs$/);
  await expect(page.getByRole('cell', { name: '22' }).first()).toBeVisible();
});

test('season mode: Season + Folder compose the tree; a second event joins without ceremony (ADR-011)', async ({ page }) => {
  // A dated series opens the dialog in season mode: Season derived from the
  // start date, Folder seeded from the name.
  await createSeriesWithData(page, { name: 'Spring Regatta', sail: '11', date: '2026-04-12' });
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByLabel('Season')).toHaveValue('2026');
  await dialog.getByLabel('Folder').fill('spring-regatta');
  // The lone results page defaults to `standings` under the folder — the
  // same depth as a prizes sibling would get.
  await expect(dialog.getByLabel('Page URL')).toHaveValue('standings');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  const link = dialog.getByRole('link', { name: /\/2026\/spring-regatta\/standings$/ });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;
  await page.goto(path);
  await expect(page.getByRole('cell', { name: '11' }).first()).toBeVisible();

  // A second dated event publishes into the same season with no join
  // confirmation — sharing a season folder is the intended shape.
  await createSeriesWithData(page, { name: 'Summer Regatta', sail: '22', date: '2026-06-20' });
  await page.getByRole('button', { name: 'Publish' }).click();
  await dialog.getByLabel('Folder').fill('summer-regatta');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(
    dialog.getByRole('link', { name: /\/2026\/summer-regatta\/standings$/ }),
  ).toBeVisible();

  // The season slug now serves both events; its index lists them.
  await page.goto(path.replace(/\/spring-regatta\/standings$/, ''));
  await expect(page.getByRole('heading', { name: '2026' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Spring Regatta' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Summer Regatta' })).toBeVisible();
});

test('multi-fleet: the "Pages live under" path is the same before and after publishing', async ({ page }) => {
  await createTwoFleetSeries(page, 'Sample ORC Series 2026');

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByLabel('Season')).toHaveValue('2026');
  await expect(dialog.getByLabel('Folder')).toHaveValue('sample-orc-series-2026');

  // Season then folder, and publishing must not rewrite either: the summary
  // once named the folder twice, because the dialog read back its own
  // name-derived suggestion instead of the season the server froze.
  const preview = dialog.getByText('Pages live under');
  await expect(preview).toContainText('/2026/sample-orc-series-2026/');

  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByText(/Last published/)).toBeVisible();
  await expect(preview).toContainText('/2026/sample-orc-series-2026/');

  // Published, the line links the folder index — so it has to resolve.
  const href = (await preview.getByRole('link').getAttribute('href')) ?? '';
  await page.goto(new URL(href).pathname);
  await expect(page.getByRole('heading', { name: 'Sample ORC Series 2026' })).toBeVisible();
});

test('single-fleet: the default page URL is editable before first publish', async ({ page }) => {
  await createSeriesWithData(page);

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('autumn-26');

  // The lone default page's sub-path defaults to "standings" and is editable.
  const pageUrl = dialog.getByRole('textbox', { name: 'Page URL' });
  await expect(pageUrl).toHaveValue('standings');
  await pageUrl.fill('overall');

  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Published at the chosen sub-path; the public page renders there.
  const link = dialog.getByRole('link', { name: /\/autumn-26\/overall$/ });
  await expect(link).toBeVisible();
  const overallPath = new URL((await link.getAttribute('href')) ?? '').pathname;
  await page.goto(overallPath);
  await expect(page.getByRole('cell', { name: '42' }).first()).toBeVisible();

  // The default "standings" path never existed — it moved to the override.
  expect((await page.request.get(overallPath.replace(/\/overall$/, '/standings'))).status()).toBe(404);
});

test('single-fleet: a page collision inside a shared folder seeds a fix to edit', async ({ page }) => {
  // A founding single-fleet series holds the `standings` page in the folder.
  await createSeriesWithData(page, { name: 'Lambay Races Cruisers', sail: '11' });
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('lambay-races');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const firstLink = dialog.getByRole('link', { name: /\/p\// });
  await expect(firstLink).toBeVisible();
  const folderPath = new URL(
    (await firstLink.getAttribute('href')) ?? '',
  ).pathname.replace(/\/standings$/, '');

  // A second single-fleet series publishes into the same folder with the
  // default `standings` page — the server rejects the collision, the field
  // is seeded with a disambiguated segment, and the scorer edits it.
  await createSeriesWithData(page, { name: 'Lambay Races One Designs', sail: '22' });
  await page.getByRole('button', { name: 'Publish' }).click();
  await dialog.getByLabel('Folder').fill('lambay-races');
  const pageUrl = dialog.getByRole('textbox', { name: 'Page URL' });
  await expect(pageUrl).toHaveValue('standings');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  await expect(pageUrl).toHaveValue('lambay-races-one-designs');
  await pageUrl.fill('one-designs');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // The page lands at the edited segment.
  await expect(dialog.getByRole('link', { name: /\/2026\/lambay-races\/one-designs$/ })).toBeVisible();
  await page.goto(`${folderPath}/one-designs`);
  await expect(page.getByRole('cell', { name: '22' }).first()).toBeVisible();
  // The seeded suggestion was never published.
  expect((await page.request.get(`${folderPath}/lambay-races-one-designs`)).status()).toBe(404);
});

test('selective publishing: choose fleets and override a fleet URL segment', async ({ page }) => {
  await createTwoFleetSeries(page, 'HYC Club Series 1');

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('club-1');

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

  // Publishing Cruiser later lands it inside the event folder like its
  // siblings — the folder derives from the frozen URLs on re-publish.
  await page.goBack();
  await page.getByRole('button', { name: 'Publish' }).click();
  await dialog.getByRole('checkbox', { name: 'Publish Cruiser' }).check();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByRole('link', { name: /\/club-1\/cruiser$/ })).toBeVisible();
  expect((await page.request.get(`${base}/cruiser`)).status()).toBe(200);
});

test('the cascade moves between a publication\'s fleet pages (#320/ADR-011)', async ({ page }) => {
  await createTwoFleetSeries(page, 'HYC Spring League');

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('spring-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/spring-26\/irc$/ });
  await expect(link).toBeVisible();
  const ircPath = new URL((await link.getAttribute('href')) ?? '').pathname;

  // On a fleet page the cascade's leaf shows the current fleet unlinked and
  // links the sibling; clicking it lands on the sibling's standings.
  await page.goto(ircPath);
  await expect(page.locator('.sstreenav-current')).toHaveText('IRC');
  await page.locator('.sstreenav').getByRole('link', { name: 'Cruiser' }).click();
  await expect(page).toHaveURL(/\/spring-26\/cruiser$/);
  await expect(page.getByRole('cell', { name: '22' }).first()).toBeVisible();
  await expect(page.locator('.sstreenav-current')).toHaveText('Cruiser');
});

test('unticking a published fleet on re-publish leaves its page live and unchanged', async ({ page }) => {
  const seriesId = await (async () => {
    await createTwoFleetSeries(page, 'HYC Club Series 2');
    return page.url().match(/\/series\/([0-9a-f-]{36})/)?.[1] ?? '';
  })();

  // First publish: both fleets.
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('club-2');
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

  // Re-publish with Cruiser unticked: it's skipped, not retracted. The
  // re-opened dialog names the event folder the pages live under, derived
  // from the frozen URLs.
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog.getByText(/\/2026\/club-2\/$/)).toBeVisible();
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

test('the public workspace listing groups by season, expands the current one, and quick-jumps (#320/ADR-011)', async ({ page }) => {
  // Two series: one we'll categorise and keep active, one we'll archive.
  // Both carry a start date so the quick-jump picker has two years to offer.
  await createSeriesWithData(page, { name: 'Spring League 2026', sail: '11', date: '2026-05-01' });
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByLabel('Folder').fill('spring-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const firstLink = dialog.getByRole('link', { name: /\/p\// });
  await expect(firstLink).toBeVisible();
  const workspaceSlug = new URL((await firstLink.getAttribute('href')) ?? '').pathname.split(
    '/',
  )[2];

  await createSeriesWithData(page, {
    name: 'Lambay Race 2024',
    sail: '22',
    date: '2024-08-17',
  });
  await page.getByRole('button', { name: 'Publish' }).click();
  await dialog.getByLabel('Folder').fill('lambay-24');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByRole('link', { name: /\/lambay-24\/standings$/ })).toBeVisible();

  // Categorise both series — each in its own category, so the picker's
  // category dropdown has two values that don't span the same years — then
  // archive the old one (all from the home list).
  await page.goto('/workspace');
  await page.getByRole('button', { name: 'Manage' }).click();
  const catDialog = page.getByRole('dialog');
  for (const cat of ['Club Racing', 'Open Events']) {
    await catDialog.getByPlaceholder('New category name').fill(cat);
    await catDialog.getByRole('button', { name: 'Add' }).click();
    await expect(catDialog.getByPlaceholder('New category name')).toHaveValue('');
  }
  await catDialog.getByRole('button', { name: 'Done' }).click();

  await page.goto('/');
  await page.getByRole('button', { name: 'Actions for Spring League 2026' }).click();
  await page.getByRole('menuitem', { name: 'Move to category' }).click();
  await page.getByRole('menuitemradio', { name: 'Club Racing' }).click();
  await expect(page.getByRole('heading', { name: 'Club Racing' })).toBeVisible();

  await page.getByRole('button', { name: 'Actions for Lambay Race 2024' }).click();
  await page.getByRole('menuitem', { name: 'Move to category' }).click();
  await page.getByRole('menuitemradio', { name: 'Open Events' }).click();
  await expect(page.getByRole('heading', { name: 'Open Events' })).toBeVisible();

  await page.getByRole('button', { name: 'Actions for Lambay Race 2024' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  // Wait for the archive to land (the series drops into the Archived section)
  // before reading the public listing, so it isn't a race with the PATCH.
  await expect(page.getByRole('button', { name: /Archived \(1\)/ })).toBeVisible();

  // The public listing (ADR-011): every season a collapsible block, the
  // current one open, its events under their category headings.
  await page.goto(`/p/${workspaceSlug}`);
  await expect(page.locator('details.season[open] summary')).toHaveText('2026');
  await expect(page.getByRole('heading', { name: 'Club Racing' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Spring League 2026', exact: true })).toBeVisible();
  // Seasons are addressable (ADR-011): /p/{ws}/2026 is the season's own
  // index — titled by the season, never a lone contributor's name.
  await page.goto(`/p/${workspaceSlug}/2026`);
  await expect(page.getByRole('heading', { name: '2026' })).toBeVisible();
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page).toHaveURL(/\/2026\/spring-26\/standings$/);
  await page.goto(`/p/${workspaceSlug}`);

  const pastSeason = page.locator('details.season').filter({ hasText: '2024' });
  await expect(pastSeason.locator('summary')).toHaveText('2024');
  // Collapsed until expanded: the older series' link hides behind the summary.
  await expect(page.getByRole('link', { name: 'Lambay Race 2024', exact: true })).not.toBeVisible();
  await pastSeason.locator('summary').click();
  await expect(page.getByRole('link', { name: 'Lambay Race 2024', exact: true })).toBeVisible();

  // The quick-jump picker (#320): Season filters the listing — opening the
  // collapsed seasons that match, hiding emptied sections — and narrows the
  // category options to the categories with a publication in that season; a
  // selection that no longer applies resets.
  const picker = page.locator('.picker');
  await expect(picker).toBeVisible();
  // The Event select cascades from Season: nothing to pick until one is
  // chosen (ADR-011).
  await expect(picker.locator('#picker-series')).toBeDisabled();
  await picker.locator('#picker-cat').selectOption('Club Racing');
  await picker.locator('#picker-year').selectOption('2024');
  await expect(picker.locator('#picker-cat')).toHaveValue('');
  await expect(picker.locator('#picker-cat').locator('option')).toHaveText([
    'All categories',
    'Open Events',
  ]);
  await expect(page.getByRole('link', { name: 'Spring League 2026', exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Club Racing' })).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Lambay Race 2024', exact: true })).toBeVisible();
  await picker.locator('#picker-year').selectOption('');
  await expect(picker.locator('#picker-cat').locator('option')).toHaveText([
    'All categories',
    'Club Racing',
    'Open Events',
  ]);
  await expect(page.getByRole('link', { name: 'Spring League 2026', exact: true })).toBeVisible();

  // Picking an event (after its season) narrows the listing to its row —
  // whose page links go straight to the table, so nothing navigates on a
  // select change.
  await picker.locator('#picker-year').selectOption('2026');
  await picker.locator('#picker-series').selectOption({ label: 'Spring League 2026' });
  await expect(page.getByRole('link', { name: 'Lambay Race 2024', exact: true })).not.toBeVisible();
  await page
    .locator('li[data-event="2026/spring-26"] .pages')
    .getByRole('link', { name: 'Standings' })
    .click();
  await expect(page).toHaveURL(/\/spring-26\/standings$/);
  await expect(page.getByRole('cell', { name: '11' }).first()).toBeVisible();
  await page.goBack();

  // The workspace Published tab mirrors the same sections: the active page
  // under its category heading, the archived one behind a collapsed
  // "Past results" toggle that expands to its event year.
  await page.goto('/workspace/published');
  await expect(page.getByText('2 pages published')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Club Racing' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Spring League 2026', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lambay Race 2024', exact: true })).not.toBeVisible();
  await page.getByRole('button', { name: /Past results \(1\)/ }).click();
  await expect(page.getByRole('heading', { name: '2024' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Lambay Race 2024', exact: true })).toBeVisible();

  // Searching narrows across sections — and keeps Past results matches
  // visible regardless of the collapse.
  await page.getByLabel('Search published pages').fill('lambay');
  await expect(page.getByRole('link', { name: 'Spring League 2026', exact: true })).not.toBeVisible();
  await expect(page.getByRole('link', { name: 'Lambay Race 2024', exact: true })).toBeVisible();
  await page.getByLabel('Search published pages').fill('nothing-matches-this');
  await expect(page.getByText('No pages match.')).toBeVisible();
});

test('keyboard shortcut p opens the publish dialog', async ({ page }) => {
  await createSeriesWithData(page);
  await page.keyboard.press('p');
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
});

test('publishing pins a "Published" milestone in the History tab (#166)', async ({ page }) => {
  await createSeriesWithData(page, { name: 'Publish Milestone Series' });

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByRole('link', { name: /\/p\// })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('navigation').getByRole('link', { name: 'History' }).click();
  const list = page.getByTestId('revision-list');
  const published = list.getByRole('listitem').filter({ hasText: 'Published to /p/' });
  await expect(published).toContainText('Published');
});
