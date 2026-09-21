import { signedInTest as test, expect } from './fixtures';
import { enableFeatures } from './helpers';

/**
 * The help docs are chapters (/help/<group>) fed by the manifest in
 * app/help/sections.ts. The landing page indexes every chapter's sections,
 * and old single-page anchors (/help#section) forward to the section's
 * chapter — those links are in the wild, so the redirect is load-bearing.
 */
test('help landing indexes chapters and old anchors redirect to them', async ({ page }) => {
  // Landing: chapter headings and section links, both from the manifest.
  await page.goto('/help');
  await expect(page.getByRole('heading', { name: 'Help' })).toBeVisible();
  // Both the chapter heading and its same-named section are links; the
  // chapter link renders first.
  await page.getByRole('link', { name: 'Entering results' }).first().click();
  await expect(page).toHaveURL(/\/help\/entering-results$/);
  await expect(page.getByRole('heading', { name: 'Entering results', level: 1 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Redress (RDG)' })).toBeVisible();

  // A chapter links back to the landing page.
  await page.getByRole('link', { name: '← Help' }).click();
  await expect(page).toHaveURL(/\/help$/);

  // Old-style deep link into the single page forwards to the chapter and
  // keeps the anchor. Leave /help first: navigating to the same path with
  // only a hash is a fragment scroll, not the fresh load a stale external
  // link actually arrives as.
  await page.goto('/');
  await page.goto('/help#redress');
  await expect(page).toHaveURL(/\/help\/entering-results#redress$/);
  await expect(page.getByRole('heading', { name: 'Redress (RDG)' })).toBeVisible();

  // A landing-page anchor stays on the landing page.
  await page.goto('/help#what-is-sail-scoring');
  await expect(page).toHaveURL(/\/help#what-is-sail-scoring$/);
  await expect(page.getByRole('heading', { name: 'What is Sail Scoring?' })).toBeVisible();

  // A chapter whose every section is feature-gated off for this viewer
  // (Across series: competitor-identity and rankings, both operator-managed
  // and off here) is hidden entirely — absent from the index, URL a 404.
  await expect(page.getByRole('link', { name: 'Across series and seasons' })).toHaveCount(0);
  const response = await page.goto('/help/across-series');
  expect(response!.status()).toBe(404);
});

/**
 * #613 — a search box over the help index. Reported by Kieran Barker (Howth
 * Yacht Club): "In 'Help' I expected to find a box that I could type a key
 * word into…"
 *
 * The feature is only as good as its keywords, so the test types the words a
 * scorer actually reaches for rather than words already in a title.
 */
test('help can be searched by the words a scorer types', async ({ page }) => {
  await page.goto('/help');
  const box = page.getByTestId('help-search');
  await expect(box).toBeVisible();

  // With the box empty the index is exactly what it was.
  await expect(page.getByTestId('help-search-results')).toHaveCount(0);

  // A code no section title contains.
  await box.fill('DNC');
  const results = page.getByTestId('help-search-results');
  await expect(results).toContainText('Entering results');
  await results.getByRole('link', { name: 'Entering results' }).click();
  await expect(page).toHaveURL(/\/help\/entering-results#entering-results$/);

  // Two words narrow rather than widen.
  await page.goto('/help');
  await page.getByTestId('help-search').fill('discard rule');
  await expect(page.getByTestId('help-search-results')).toContainText('Discard rules');

  // A section gated off for this workspace is not listed and not searched —
  // the search filters the index the viewer can already see.
  await page.getByTestId('help-search').fill('blw');
  await expect(page.getByTestId('help-search-results')).toContainText('Nothing matches');

  // A word nobody wrote says so, rather than showing everything.
  await page.getByTestId('help-search').fill('zzzznothing');
  await expect(page.getByTestId('help-search-results')).toContainText('Nothing matches');

  // `/` reaches the box without a mouse.
  await page.goto('/help');
  await page.keyboard.press('/');
  await expect(page.getByTestId('help-search')).toBeFocused();
});

test('a gated section is searchable once the workspace has the feature', async ({ page, signedInEmail }) => {
  // The other half of the gating: with the feature on, Sailwave's own
  // vocabulary finds the section that covers it, which is how a scorer
  // arriving from Sailwave would look for it.
  await enableFeatures(page, signedInEmail, ['sailwave-import']);
  await page.goto('/help');
  await page.getByTestId('help-search').fill('blw');
  await expect(page.getByTestId('help-search-results')).toContainText('Importing from Sailwave');
});

test('the help panel can be searched too, and lands on the section', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Help' }).first().click();
  const search = page.getByTestId('help-panel-search');
  await expect(search).toBeVisible();

  await search.fill('burgee');
  const results = page.getByTestId('help-panel-search-results');
  await expect(results).toContainText('The logo library');
  await results.getByRole('button', { name: 'The logo library' }).click();
  // The panel navigates in place — the page underneath keeps its URL.
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'The logo library' })).toBeVisible();
});
