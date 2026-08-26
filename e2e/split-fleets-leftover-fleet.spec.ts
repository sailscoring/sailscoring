import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * The ceremony's leftover-fleet offer: a series whose competitors were
 * entered before it became a championship carries a fleet ("Default" here)
 * that assignment rounds never use. The round-1 dialog offers to remove it —
 * pre-checked for the app's own synthetic name — and the commit strips the
 * memberships and deletes the fleet in the same transaction.
 */
test('round 1 offers to remove a leftover Default fleet', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSeriesQuick(page, { name: 'Converted Worlds', venue: 'Howth' });

  // A pre-championship fleet with members: the leftover under test.
  await createFleets(page, ['Default']);
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();
  for (let i = 0; i < 4; i++) {
    await addCompetitor(page, { sailNumber: `21000${i}`, name: `Helm ${i}` });
  }

  // Become a championship, then run the round-1 ceremony.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const sfSetupCard = page.getByTestId('split-fleets-card');
  await sfSetupCard.locator('#sf-fleet-count').selectOption('2');
  await sfSetupCard.getByRole('button', { name: 'Enable split fleets' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();

  const dialog = page.getByRole('dialog');
  const offer = dialog.getByRole('checkbox', { name: /Also remove the fleet/ });
  await expect(offer).toBeChecked();
  await expect(dialog).toContainText('“Default”');
  await page.getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();

  // The leftover is gone: the Fleets card lists only the round's two fleets.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const fleetsRow = page.locator('h2', { hasText: 'Fleets' }).locator('..');
  await fleetsRow.locator('button').click();
  await expect(page.getByTestId('fleet-row')).toHaveCount(2);
  await expect(page.getByTestId('fleet-row').filter({ hasText: 'Default' })).toHaveCount(0);
});
