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

    // Choose the public URL (editable while private, frozen once published)
    // and go public from the start, so the page link appears on save.
    await page.getByLabel('Public URL').fill('national-ladder');
    await page.getByRole('switch', { name: 'Public page' }).check();
    await page.getByRole('button', { name: 'Save ranking' }).click();

    // The computed ladder: Aoife and Brian tie on 3 (sharing rank 1,
    // alphabetical within the tie), Cara third on 4. The table reads like
    // standings — a column per series, discards in parentheses, Total and
    // Net (Aoife sailed both regionals; best-1 discards her Munsters 2nd).
    const table = page.getByTestId('ranking-standings');
    await expect(table).toBeVisible({ timeout: 15_000 });
    await expect(table).toContainText('Nationals 2026');
    await expect(table).toContainText('Net');
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('1');
    await expect(rows.nth(0)).toContainText('Aoife Kelly');
    await expect(rows.nth(0)).toContainText('(2)');
    await expect(rows.nth(1)).toContainText('1');
    await expect(rows.nth(1)).toContainText('Brian Byrne');
    await expect(rows.nth(2)).toContainText('3');
    await expect(rows.nth(2)).toContainText('Cara Walsh');

    // Published now, so the URL is frozen in the editor.
    await expect(page.getByLabel('Public URL')).toBeDisabled();

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
    // The page lives at the chosen slug.
    expect(publicUrl).toMatch(/\/ranking\/national-ladder$/);
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

  test('a fleet filter ranks one fleet of a multi-fleet series', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'rankings-fleet');
    const { id: orgId } = await createOrgWorkspace('Fleet Ladder Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['rankings', 'competitor-identity']);
    await setActiveWorkspace(page, orgId);

    // One event, two fleets, a mixed crossing order (the IODAI shape):
    //   Senior: Fionn 1st, Grace 2nd — Junior: Dara 1st, Erin 2nd.
    const entrant = (name: string, sail: string, fleet: string) => ({
      name,
      sailNumber: sail,
      nationality: 'IRL',
      fleet,
    });
    await seedRankedSeries(orgId, {
      name: 'Leinsters 2026',
      year: 2026,
      entrants: [
        entrant('Fionn Doyle', 'IRL404', 'Senior'),
        entrant('Dara Nolan', 'IRL505', 'Junior'),
        entrant('Grace Hughes', 'IRL606', 'Senior'),
        entrant('Erin Quinn', 'IRL707', 'Junior'),
      ],
    });

    await page.goto('/workspace/rankings');
    await page.getByRole('button', { name: 'New ranking' }).click();
    await page.getByLabel('Ranking name').fill('Junior Ranking 2026');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(
      page.getByRole('heading', { name: 'Junior Ranking 2026' }),
    ).toBeVisible({ timeout: 15_000 });

    const bucket = page.getByTestId('bucket-editor').first();
    await bucket.getByLabel('Bucket name').fill('Events');
    await bucket.getByRole('checkbox', { name: /Leinsters 2026/ }).check();
    await page.getByLabel('Fleet filter').fill('Junior');
    await page.getByRole('button', { name: 'Save ranking' }).click();

    // Only the Junior fleet's standings feed the ladder.
    const table = page.getByTestId('ranking-standings');
    await expect(table).toBeVisible({ timeout: 15_000 });
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Dara Nolan');
    await expect(rows.nth(1)).toContainText('Erin Quinn');
    await expect(page.getByText(/Junior fleet only/)).toBeVisible();

    // The Senior ladder is the same config with the other fleet name.
    await page.getByLabel('Fleet filter').fill('Senior');
    await page.getByRole('button', { name: 'Save ranking' }).click();
    await expect(rows.nth(0)).toContainText('Fionn Doyle', {
      timeout: 15_000,
    });
    await expect(rows.nth(1)).toContainText('Grace Hughes');
    await expect(table.getByText('Dara Nolan')).toBeHidden();

    expect(errors).toEqual([]);
  });

  test('recomputed places count among home sailors only', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'rankings-nat');
    const { id: orgId } = await createOrgWorkspace('Compression Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['rankings', 'competitor-identity']);
    await setActiveWorkspace(page, orgId);

    // The Dylan case: a visiting GBR sailor wins, the home sailors follow.
    await seedRankedSeries(orgId, {
      name: 'Leinsters 2026',
      year: 2026,
      entrants: [
        { name: 'Sasha Brown', sailNumber: 'GBR100', nationality: 'GBR' },
        { name: 'Dylan Byrne', sailNumber: 'IRL200', nationality: 'IRL' },
        { name: 'Eva Murphy', sailNumber: 'IRL300', nationality: 'IRL' },
      ],
    });

    await page.goto('/workspace/rankings');
    await page.getByRole('button', { name: 'New ranking' }).click();
    await page.getByLabel('Ranking name').fill('Home Ranking 2026');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(
      page.getByRole('heading', { name: 'Home Ranking 2026' }),
    ).toBeVisible({ timeout: 15_000 });

    const bucket = page.getByTestId('bucket-editor').first();
    await bucket.getByLabel('Bucket name').fill('Events');
    await bucket.getByRole('checkbox', { name: /Leinsters 2026/ }).check();
    await page.getByLabel('Nationality filter').fill('IRL');
    await page
      .getByRole('checkbox', { name: /Count places among IRL sailors only/ })
      .check();
    await page.getByRole('button', { name: 'Save ranking' }).click();

    // Dylan finished 2nd behind the GBR boat but counts a 1st.
    const table = page.getByTestId('ranking-standings');
    await expect(table).toBeVisible({ timeout: 15_000 });
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText('Dylan Byrne');
    await expect(rows.nth(0).locator('td').last()).toHaveText('1');
    await expect(rows.nth(1)).toContainText('Eva Murphy');
    await expect(rows.nth(1).locator('td').last()).toHaveText('2');
    await expect(table.getByText('Sasha Brown')).toBeHidden();
    await expect(
      page.getByText(/Places counted among IRL sailors only/),
    ).toBeVisible();

    // Switching recomputation off restores the published places.
    await page
      .getByRole('checkbox', { name: /Count places among IRL sailors only/ })
      .uncheck();
    await page.getByRole('button', { name: 'Save ranking' }).click();
    await expect(rows.nth(0).locator('td').last()).toHaveText('2', {
      timeout: 15_000,
    });

    expect(errors).toEqual([]);
  });

  test('a manual adjustment supplies an asterisked place with its note', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'rankings-adjust');
    const { id: orgId } = await createOrgWorkspace('Adjustment Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['rankings', 'competitor-identity']);
    await setActiveWorkspace(page, orgId);

    // Brian misses the Ulsters on Worlds team duty (the Donagh case).
    const aoife = { name: 'Aoife Kelly', sailNumber: 'IRL101', nationality: 'IRL' };
    const brian = { name: 'Brian Byrne', sailNumber: 'IRL202', nationality: 'IRL' };
    await seedRankedSeries(orgId, {
      name: 'Nationals 2026',
      year: 2026,
      entrants: [brian, aoife],
    });
    await seedRankedSeries(orgId, {
      name: 'Ulsters 2026',
      year: 2026,
      entrants: [aoife],
    });

    await page.goto('/workspace/rankings');
    await page.getByRole('button', { name: 'New ranking' }).click();
    await page.getByLabel('Ranking name').fill('Season 2026');
    await page.getByRole('button', { name: 'Create' }).click();
    await expect(
      page.getByRole('heading', { name: 'Season 2026' }),
    ).toBeVisible({ timeout: 15_000 });

    // One bucket, both events, both required — Brian misses the floor.
    const bucket = page.getByTestId('bucket-editor').first();
    await bucket.getByLabel('Bucket name').fill('Events');
    await bucket.getByRole('checkbox', { name: /Nationals 2026/ }).check();
    await bucket.getByRole('checkbox', { name: /Ulsters 2026/ }).check();
    await bucket.getByLabel('Count best').fill('2');
    await bucket.getByLabel('Need at least').fill('2');
    await page.getByRole('button', { name: 'Save ranking' }).click();
    await expect(page.getByText(/Not yet ranked:.*Brian Byrne/)).toBeVisible({
      timeout: 15_000,
    });

    // The committee awards him an averaged 1.5 for the missed event.
    const card = page.getByTestId('adjustments-card');
    await card.getByLabel('Adjustment sailor').selectOption({ label: 'Brian Byrne' });
    await card.getByLabel('Adjustment series').selectOption({ label: 'Ulsters 2026' });
    await card.getByLabel('Adjustment place').fill('1.5');
    await card.getByLabel('Adjustment note').fill('Worlds team duty');
    await card.getByRole('button', { name: 'Add adjustment' }).click();
    await page.getByRole('button', { name: 'Save ranking' }).click();

    // Brian ranks first on 2.5 (Nationals 1 + adjusted 1.5), the adjusted
    // place asterisked with the note as its tooltip.
    const table = page.getByTestId('ranking-standings');
    await expect(table).toBeVisible({ timeout: 15_000 });
    const rows = table.locator('tbody tr');
    await expect(rows).toHaveCount(2, { timeout: 15_000 });
    await expect(rows.nth(0)).toContainText('Brian Byrne');
    await expect(rows.nth(0)).toContainText('1.5*');
    await expect(rows.nth(0).locator('td').last()).toHaveText('2.5');
    await expect(
      rows.nth(0).locator('td[title="Worlds team duty"]'),
    ).toHaveCount(1);
    await expect(page.getByText(/Not yet ranked/)).toBeHidden();

    expect(errors).toEqual([]);
  });
});
