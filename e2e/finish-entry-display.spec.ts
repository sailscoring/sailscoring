import { signedInTest as test, expect } from './fixtures';
import { createFleets, createSeriesQuick } from './helpers';

/**
 * E2E for the finish-entry competitor label and fleet badge (issues #156, #151).
 *
 * One keelboat ("Eclipse", helm "Hogan") entered in two fleets that share a
 * start — a handicap fleet and a scratch fleet. Verifies that at finish entry:
 *   #156 — the row leads with the boat name ("Eclipse — Hogan"), not just the
 *          helm, because boatName is an enabled display field.
 *   #151 — the fleet badge reflects *both* fleets, not just the first.
 */

test('finish entry shows the boat name and every fleet badge', async ({ page }) => {
  // ── 1. Series (boatName is an enabled field by default) ───────────────────
  await createSeriesQuick(page, { name: 'Keelboat Display 2025', venue: 'HYC' });

  // ── 2. Two fleets sharing a start ─────────────────────────────────────────
  await createFleets(page, ['Puppeteer HPH', 'Puppeteer Scr']);

  // ── 3. One boat entered in both fleets, with a boat name ──────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('20');
  await page.getByLabel('Competitor name').fill('Hogan');
  await page.getByLabel('Boat name').fill('Eclipse');
  await page.getByLabel('Club').fill('HYC');
  await page.getByRole('checkbox', { name: 'Puppeteer HPH' }).check();
  await page.getByRole('checkbox', { name: 'Puppeteer Scr' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '20' })).toBeVisible();

  // ── 4. Add a race and open finish entry ───────────────────────────────────
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // ── 5. Finish the boat ────────────────────────────────────────────────────
  const sailInput = page.getByLabel('Sail number');
  await sailInput.fill('20');
  await sailInput.press('Enter');

  // #156 — the row leads with the boat name, then the helm. Scoped to the
  // finishing order: the same label is echoed beside the input (#610).
  await expect(page.getByRole('listitem').getByText('Eclipse — Hogan')).toBeVisible();

  // #151 — both fleets are badged, not just the first-registered one. With no
  // start recorded, every fleet is implied racing, so both memberships show.
  const badge = page.getByTestId('fleet-badge-20');
  await expect(badge).toContainText('Puppeteer HPH');
  await expect(badge).toContainText('Puppeteer Scr');
});

/**
 * #327 — once a race is scoped by a start, the finish-entry fleet badges show
 * only the fleets actually racing this sheet, not every fleet the boat carries.
 * Same two-fleet boat as above, but a membership-only start for one fleet drops
 * the other fleet's badge as noise.
 */
test('finish entry scopes fleet badges to the race’s started fleets', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Scoped Badges 2025', venue: 'HYC' });
  await createFleets(page, ['Puppeteer HPH', 'Puppeteer Scr']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('20');
  await page.getByLabel('Competitor name').fill('Hogan');
  await page.getByLabel('Boat name').fill('Eclipse');
  await page.getByRole('checkbox', { name: 'Puppeteer HPH' }).check();
  await page.getByRole('checkbox', { name: 'Puppeteer Scr' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: '20' })).toBeVisible();

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  // Membership-only start for the HPH fleet only — scopes the race to HPH.
  await page.getByRole('button', { name: 'Edit ▸' }).click();
  await page.getByRole('button', { name: 'Add start' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Add start' })).toBeVisible();
  await dialog.getByRole('checkbox', { name: 'Puppeteer HPH' }).check();
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog).toBeHidden();

  // Finish the boat.
  const sailInput = page.getByLabel('Sail number');
  await sailInput.fill('20');
  await sailInput.press('Enter');
  await expect(page.getByRole('listitem').getByText('Eclipse — Hogan')).toBeVisible();

  // Only the started (HPH) fleet is badged; the Scr membership is dropped.
  const badge = page.getByTestId('fleet-badge-20');
  await expect(badge).toContainText('Puppeteer HPH');
  await expect(badge).not.toContainText('Puppeteer Scr');
});

/**
 * #610 — the confirmation of the last entry sits beside the input, where the
 * eye already is. Reported by Kieran Barker (Howth Yacht Club), transcribing a
 * paper finish sheet: the row just added drops out of sight once enough boats
 * are in, so there is nothing to check a typed number against.
 */
test('the last boat entered stays echoed beside the sail-number input', async ({ page }) => {
  await createSeriesQuick(page, { name: 'Last In Echo 2026' });
  await createFleets(page, ['Fleet A']);

  await page.getByRole('link', { name: 'Competitors' }).click();
  for (const [sail, name] of [
    ['11', 'Alice'],
    ['22', 'Bob'],
    ['33', 'Carol'],
  ]) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(sail);
    await page.getByLabel('Competitor name').fill(name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: sail })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await expect(page.getByText('Race 1 — results')).toBeVisible();

  const echo = page.getByTestId('last-recorded');
  // Nothing entered yet, nothing to echo.
  await expect(echo).toHaveCount(0);

  const sailInput = page.getByLabel('Sail number');
  for (const [i, sail] of ['11', '22', '33'].entries()) {
    await sailInput.fill(sail);
    await sailInput.press('Enter');
    // It names what went in and where it went, and stays until the next one.
    await expect(echo).toContainText(sail);
    await expect(echo).toContainText(['1st', '2nd', '3rd'][i]);
  }
  await expect(echo).toContainText('Carol');

  // Clicking it flashes the row it names.
  await echo.click();
  await expect(page.locator('[data-entry-key]').nth(2)).toHaveClass(/ring-primary/);
});
