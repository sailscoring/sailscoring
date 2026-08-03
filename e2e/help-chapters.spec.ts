import { signedInTest as test, expect } from './fixtures';

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
});
