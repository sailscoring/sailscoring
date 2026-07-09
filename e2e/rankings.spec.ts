/**
 * Workspace cross-series rankings (#209): create a ladder from the Rankings
 * tab, configure the IODAI-style buckets (a championship bucket + a best-N
 * regional bucket), and verify the computed standings — including the tie
 * sharing a rank — then the public page, which counts published series only.
 */
import { test, expect } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  enableOrgFeatures,
  seedRankedSeries,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('cross-series rankings', () => {
  test('configure a ladder, read the standings, publish the public page', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'rankings');
    const { id: orgId } = await createOrgWorkspace('Ranking Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['rankings', 'competitor-identity']);
    await setActiveWorkspace(page, orgId);

    // Three sailors across three series. Finish order = array order.
    //   Nationals (published):  Brian 1, Aoife 2, Cara 3
    //   Ulsters   (published):  Aoife 1, Brian 2
    //   Munsters  (unpublished): Cara 1, Aoife 2, Brian 3
    // Bucket National (best 1) + bucket Regional (best 1 of the two):
    //   Aoife 2+1=3, Brian 1+2=3 (tie), Cara 3+1=4.
    const entrant = (name: string, sail: string) => ({
      name,
      sailNumber: sail,
      club: 'RCYC',
      nationality: 'IRL',
    });
    const aoife = entrant('Aoife Kelly', 'IRL101');
    const brian = entrant('Brian Byrne', 'IRL202');
    const cara = entrant('Cara Walsh', 'IRL303');
    await seedRankedSeries(orgId, {
      name: 'Nationals 2026',
      year: 2026,
      published: true,
      entrants: [brian, aoife, cara],
    });
    await seedRankedSeries(orgId, {
      name: 'Ulsters 2026',
      year: 2026,
      published: true,
      entrants: [aoife, brian],
    });
    await seedRankedSeries(orgId, {
      name: 'Munsters 2026',
      year: 2026,
      entrants: [cara, aoife, brian],
    });

    // Reach the surface through its tab.
    await page.goto('/');
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Rankings' })
      .click();
    await expect(page).toHaveURL(/\/workspace\/rankings$/);

    // Create the ladder.
    await page.getByRole('button', { name: 'New ranking' }).click();
    await page.getByLabel('Ranking name').fill('National Ranking 2026');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/workspace\/rankings\/[0-9a-f-]+$/);
    await expect(
      page.getByRole('heading', { name: 'National Ranking 2026' }),
    ).toBeVisible({ timeout: 15_000 });

    // Bucket 1: the championship.
    const national = page.getByTestId('bucket-editor').nth(0);
    await national.getByLabel('Bucket name').fill('National');
    await national.getByRole('checkbox', { name: /Nationals 2026/ }).check();

    // Bucket 2: best 1 of the two regionals.
    await page.getByRole('button', { name: 'Add bucket' }).click();
    const regional = page.getByTestId('bucket-editor').nth(1);
    await regional.getByLabel('Bucket name').fill('Regional');
    await regional.getByRole('checkbox', { name: /Ulsters 2026/ }).check();
    await regional.getByRole('checkbox', { name: /Munsters 2026/ }).check();

    // Public from the start, so the page link appears on save.
    await page.getByRole('switch', { name: 'Public page' }).check();
    await page.getByRole('button', { name: 'Save ranking' }).click();

    // The computed ladder: Aoife and Brian tie on 3 (sharing rank 1,
    // alphabetical within the tie), Cara third on 4.
    const table = page.getByTestId('ranking-standings');
    await expect(table).toBeVisible({ timeout: 15_000 });
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('1');
    await expect(rows.nth(0)).toContainText('Aoife Kelly');
    await expect(rows.nth(1)).toContainText('1');
    await expect(rows.nth(1)).toContainText('Brian Byrne');
    await expect(rows.nth(2)).toContainText('3');
    await expect(rows.nth(2)).toContainText('Cara Walsh');

    // The in-app view counts Munsters, but warns that the public page won't.
    await expect(
      page.getByText(/public page only counts published series/i),
    ).toBeVisible();
    await expect(page.getByText(/Munsters 2026 is not published yet/)).toBeVisible();

    // The public ladder: published series only, so the Regional bucket is
    // Ulsters alone — Cara never sailed it, misses the floor, and drops off.
    const publicLink = page.getByRole('link', { name: /\/p\/.*\/ranking\// });
    const publicUrl = await publicLink.getAttribute('href');
    expect(publicUrl).toBeTruthy();
    const res = await page.goto(publicUrl!);
    expect(res?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'National Ranking 2026' }),
    ).toBeVisible();
    await expect(page.getByText('Aoife Kelly')).toBeVisible();
    await expect(page.getByText('Brian Byrne')).toBeVisible();
    await expect(page.getByText('Cara Walsh')).toBeHidden();
    // The basis names exactly what was counted — and never the unpublished.
    await expect(page.getByText(/Based on:.*Nationals 2026.*Ulsters 2026/)).toBeVisible();
    await expect(page.getByText('Munsters 2026')).toBeHidden();
    // Sailor names deep-link to the public competitor timelines.
    await expect(
      page.getByRole('link', { name: 'Aoife Kelly' }),
    ).toHaveAttribute('href', /\/competitor\/aoife-kelly-/);

    expect(errors).toEqual([]);

    // Switch the public page off: the URL stops resolving.
    await page.goBack();
    await page.getByRole('switch', { name: 'Public page' }).uncheck();
    await page.getByRole('button', { name: 'Save ranking' }).click();
    // The public link disappears once the save lands — then the page 404s.
    await expect(page.getByRole('link', { name: /\/p\/.*\/ranking\// })).toHaveCount(0);
    const gone = await page.goto(publicUrl!);
    expect(gone?.status()).toBe(404);
  });
});
