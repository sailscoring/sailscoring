/**
 * Restore-from-history across a shared workspace (#166, revision history).
 *
 * Two scorers each make an edit (each its own revision, since auto revisions
 * coalesce per actor). The second scorer restores the first's version from the
 * History tab and sees the later edit rolled back — with the restore itself
 * recorded as a new "Revert" version.
 *
 * Base Playwright (not ./fixtures): two contexts means two sessions. Both pages
 * are clean autosave paths, so console errors are guarded manually.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  createSeriesQuick,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('restore from history on a shared workspace', () => {
  test('a scorer restores an earlier version, rolling back a co-scorer’s edit', async ({
    browser,
  }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const alex: Page = await ctxA.newPage();
    const bea: Page = await ctxB.newPage();

    const errors: string[] = [];
    for (const [who, pg] of [
      ['alex', alex],
      ['bea', bea],
    ] as const) {
      pg.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      pg.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${who}: ${m.text()}`);
      });
    }

    try {
      const stamp = Date.now();
      const emailAlex = await signInFreshUser(alex, `rev-alex-${stamp}`);
      const emailBea = await signInFreshUser(bea, `rev-bea-${stamp}`);

      const org = await createOrgWorkspace(`Revert Panel ${stamp}`);
      await addMemberByEmail(org.id, emailAlex, 'owner');
      await addMemberByEmail(org.id, emailBea, 'admin');
      await setActiveWorkspace(alex, org.id);
      await setActiveWorkspace(bea, org.id);

      // Alex creates the series and adds Race 1 (one coalesced revision).
      const seriesName = `Restore Regatta ${stamp}`;
      await createSeriesQuick(alex, { name: seriesName });
      await alex.getByRole('link', { name: 'Races' }).click();
      await alex.getByRole('button', { name: 'Add race' }).click();
      await expect(alex.getByText('Race 1')).toBeVisible();

      // Bea opens the same series and adds Race 2 (her own revision).
      await bea.goto('/');
      await bea.getByText(seriesName).click();
      await bea.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
      await bea.getByRole('button', { name: 'Add race' }).click();
      await expect(bea.getByText('Race 2')).toBeVisible();

      // Bea goes to History: two versions, newest (her Race 2) first.
      await bea.getByRole('navigation').getByRole('link', { name: 'History' }).click();
      await expect(bea).toHaveURL(/\/series\/[0-9a-f-]{36}\/history$/);
      const list = bea.getByTestId('revision-list');
      await expect(list).toContainText('Added Race 2');
      await expect(list).toContainText('Added Race 1');

      // Restore Alex's earlier version (the one headlined "Added Race 1").
      const alexRow = list.getByRole('listitem').filter({ hasText: 'Added Race 1' });
      await alexRow.getByRole('button', { name: 'Restore' }).click();
      const dialog = bea.getByRole('dialog', { name: 'Restore this version?' });
      await dialog.getByRole('button', { name: 'Restore' }).click();

      // The restore is recorded as a new "Revert" version.
      await expect(list).toContainText('Revert');

      // Race 2 is gone; Race 1 remains.
      await bea.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
      await expect(bea.getByText('Race 1')).toBeVisible();
      await expect(bea.getByText('Race 2')).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
      if (errors.length > 0) {
        throw new Error(`Console/page errors:\n${errors.join('\n')}`);
      }
    }
  });
});
