import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * The search box on the workspace home list narrows active and archived
 * series together: a match in the collapsed Archived section is shown without
 * opening it, a query can mix words from the name, venue and year, and
 * clearing it puts the list back as it was.
 */
test('search finds series in the active list and the archive', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Autumn League 2023', venue: 'Howth', date: '2023-09-16' });
  await createSeriesQuick(page, { name: 'Autumn League 2025', venue: 'Howth', date: '2025-09-13' });
  await createSeriesQuick(page, { name: 'Frostbites', venue: 'Dun Laoghaire', date: '2025-11-02' });

  // Archive the 2023 Autumn League; it drops into the collapsed Archived section.
  await page.goto('/');
  const rows = page.getByTestId('series-row');
  await expect(rows).toHaveCount(3);
  await page.getByRole('button', { name: 'Actions for Autumn League 2023' }).click();
  await page.getByRole('menuitem', { name: 'Archive' }).click();
  const archivedToggle = page.getByRole('button', { name: /Archived \(1\)/ });
  await expect(archivedToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(rows).toHaveCount(2);
  const dragHandles = page.locator('[data-testid^="series-drag-"]');
  await expect(dragHandles).toHaveCount(2);

  // `/` jumps to the search box.
  await page.keyboard.press('/');
  const search = page.getByLabel('Search series');
  await expect(search).toBeFocused();

  // A name match shows the archived one too, without opening the toggle.
  await search.fill('autumn');
  await expect(rows).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Archived (1 of 1)' })).toBeVisible();
  // No drag-reorder in a narrowed list.
  await expect(dragHandles).toHaveCount(0);

  // Words match across fields: venue + year.
  await search.fill('howth 2025');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Autumn League 2025');
  await expect(page.getByRole('heading', { name: /Archived/ })).toBeHidden();

  await search.fill('dun laoghaire');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Frostbites');

  await search.fill('regatta');
  await expect(rows).toHaveCount(0);
  await expect(page.getByText('No series match “regatta”.')).toBeVisible();

  // Escape clears the search and the Archived section collapses again.
  await search.press('Escape');
  await expect(search).toHaveValue('');
  await expect(rows).toHaveCount(2);
  await expect(archivedToggle).toHaveAttribute('aria-expanded', 'false');
  await expect(dragHandles).toHaveCount(2);
});
