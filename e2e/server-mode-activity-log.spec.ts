/**
 * Activity log across a shared workspace (#153, ADR-008 Phase 10).
 *
 * The Phase 10 exit criterion: two accounts in one workspace can both edit a
 * series and see each other's changes through the activity log. Sarah scores;
 * Brian — a co-scorer in the same workspace who never touched the series —
 * sees her work on the per-series Activity tab and on the series-list recency
 * strip, attributed to her.
 *
 * Base Playwright (not ./fixtures): two browser contexts means two sessions,
 * and the fixture's console guard only watches its own page. Both pages are
 * clean autosave paths (no 409), so we guard console errors manually and fail
 * if either page logged one.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  createSeriesQuick,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('activity log on a shared workspace', () => {
  test("a co-scorer sees another scorer's edits in the activity log", async ({
    browser,
  }) => {
    const ctxSarah = await browser.newContext();
    const ctxBrian = await browser.newContext();
    const sarah: Page = await ctxSarah.newPage();
    const brian: Page = await ctxBrian.newPage();

    const errors: string[] = [];
    for (const [who, pg] of [
      ['sarah', sarah],
      ['brian', brian],
    ] as const) {
      pg.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      pg.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${who}: ${m.text()}`);
      });
    }

    try {
      const stamp = Date.now();
      const emailSarah = await signInFreshUser(sarah, `act-sarah-${stamp}`);
      const emailBrian = await signInFreshUser(brian, `act-brian-${stamp}`);
      const sarahName = emailSarah.split('@')[0];

      const org = await createOrgWorkspace(`Activity Panel ${stamp}`);
      await addMemberByEmail(org.id, emailSarah, 'owner');
      await addMemberByEmail(org.id, emailBrian, 'admin');
      await setActiveWorkspace(sarah, org.id);
      await setActiveWorkspace(brian, org.id);

      // Sarah scores: create the series, add a competitor + a race, record a
      // finish (per-row autosave).
      const seriesName = `Shared Regatta ${stamp}`;
      await createSeriesQuick(sarah, { name: seriesName });

      await sarah.getByRole('button', { name: 'Add competitor' }).click();
      await sarah.getByLabel('Sail number').fill('SH1');
      await sarah.getByLabel('Competitor name').fill('Boat One');
      await sarah.getByRole('button', { name: 'Save' }).click();
      await expect(sarah.getByRole('cell', { name: 'SH1' })).toBeVisible();

      await sarah.getByRole('link', { name: 'Races' }).click();
      await sarah.getByRole('button', { name: 'Add race' }).click();
      await sarah.getByText('Race 1').click();
      await sarah.getByLabel('Sail number').fill('SH1');
      await sarah.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(sarah.getByTestId('autosave-status')).toHaveText(
        'All changes saved',
      );

      // Brian — same workspace, but he has not opened the series. He finds it
      // on the home list, where the recency strip already names Sarah.
      await brian.goto('/');
      const card = brian.getByText(seriesName).locator('..');
      await expect(card).toContainText('Recorded finishes for Race 1');
      await expect(card).toContainText(sarahName);

      // Open the series and read its Activity tab.
      await brian.getByText(seriesName).click();
      await expect(brian).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
      await brian.getByRole('navigation').getByRole('link', { name: 'Activity' }).click();
      await expect(brian).toHaveURL(/\/series\/[0-9a-f-]{36}\/activity$/);

      const feed = brian.getByTestId('activity-feed');
      await expect(feed).toBeVisible();
      await expect(feed).toContainText('Created the series');
      await expect(feed).toContainText('Added Race 1');
      await expect(feed).toContainText('Recorded finishes for Race 1');
      // Attributed to Sarah, not Brian.
      await expect(feed).toContainText(sarahName);
    } finally {
      await ctxSarah.close();
      await ctxBrian.close();
      if (errors.length > 0) {
        throw new Error(`unexpected console/page errors:\n${errors.join('\n')}`);
      }
    }
  });
});
