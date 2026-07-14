/**
 * As-published archives (ADR-010, #283): ingest through the API, the
 * auto-published public page, the read-only in-app view, and the 423 on the
 * standard write surface. The ingest runs over the signed-in owner's session
 * (owners hold archive-ingest); the CI path differs only in credential.
 */
import { test, expect } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('as-published archives', () => {
  test('ingest → public page → read-only in-app view', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'asp');
    const { id: orgId, slug } = await createOrgWorkspace('Archive Club');
    await addMemberByEmail(orgId, email, 'owner');
    await setActiveWorkspace(page, orgId);

    const seriesId = crypto.randomUUID();
    const fleetId = crypto.randomUUID();
    const aoife = crypto.randomUUID();
    const brian = crypto.randomUUID();
    const doc = {
      formatVersion: 1,
      series: {
        id: seriesId,
        name: 'Ulsters 2014 Optimists',
        venue: 'BYC',
        startDate: '2014-06-14',
        publishedSlug: 'iodai-ulsters-2014',
        source: 'sailwave',
      },
      fleets: [
        {
          id: fleetId,
          name: 'Main Fleet',
          subPath: 'main-fleet',
          results: {
            caption: 'Sailed: 3, Discards: 1, Entries: 2',
            leadColumns: [
              { key: 'sailno', label: 'Sail Number' },
              { key: 'helmname', label: 'Helm' },
            ],
            raceHeaders: [{ label: 'R1' }, { label: 'R2' }, { label: 'R3' }],
            summaryColumns: [
              { key: 'total', label: 'Total' },
              { key: 'nett', label: 'Nett' },
            ],
            rows: [
              {
                competitorId: aoife,
                rank: 1,
                rankLabel: '1st',
                leadCells: ['IRL1200', 'Aoife Murphy'],
                raceCells: [
                  { text: '1', rank: 1 },
                  { text: '(2)', discard: true },
                  { text: '1', rank: 1 },
                ],
                summaryCells: ['4', '2'],
              },
              {
                competitorId: brian,
                rank: 2,
                rankLabel: '2nd',
                leadCells: ['IRL1300', 'Brian Byrne'],
                raceCells: [
                  { text: '2' },
                  { text: '1' },
                  { text: '(3 DNC)', discard: true },
                ],
                summaryCells: ['6', '3'],
              },
            ],
            raceTables: [
              {
                label: 'Race 1',
                columns: [
                  { key: 'rank', label: 'Place' },
                  { key: 'sailno', label: 'Sail Number' },
                  { key: 'helmname', label: 'Helm' },
                ],
                rows: [
                  { rank: 1, cells: ['1', 'IRL1200', 'Aoife Murphy'] },
                  { rank: 2, cells: ['2', 'IRL1300', 'Brian Byrne'] },
                ],
              },
            ],
          },
        },
      ],
      competitors: [
        {
          id: aoife,
          fleetIds: [fleetId],
          sailNumber: 'IRL1200',
          name: 'Aoife Murphy',
          club: 'RCYC',
        },
        {
          id: brian,
          fleetIds: [fleetId],
          sailNumber: 'IRL1300',
          name: 'Brian Byrne',
          club: 'HYC',
        },
      ],
    };

    // Ingest over the signed-in session (owner holds archive-ingest).
    const put = await page.request.put(`/api/v1/archive/series/${seriesId}`, {
      data: doc,
    });
    expect(put.status()).toBe(200);
    const result = await put.json();
    expect(result.unchanged).toBe(false);
    expect(result.published.slug).toBe('iodai-ulsters-2014');

    // Idempotent: the same document is a no-op.
    const again = await page.request.put(`/api/v1/archive/series/${seriesId}`, {
      data: doc,
    });
    expect((await again.json()).unchanged).toBe(true);

    // The public page is live, no publish step, results as published.
    const pub = await page.goto(`/p/${slug}/iodai-ulsters-2014/main-fleet`);
    expect(pub?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { name: 'Ulsters 2014 Optimists' }),
    ).toBeVisible();
    // (twice on the page now: the summary table and the race detail table)
    await expect(page.getByText('Aoife Murphy').first()).toBeVisible();
    await expect(page.getByText('(3 DNC)')).toBeVisible();
    await expect(page.getByText('Sailed: 3, Discards: 1')).toBeVisible();
    // Podium colouring: the summary race cells and the per-race detail
    // table's Place cells carry the rank classes.
    expect(await page.locator('td.rank1').count()).toBeGreaterThanOrEqual(2);
    await expect(
      page.getByRole('heading', { name: 'Race 1' }),
    ).toBeVisible();
    await expect(
      page.locator('table.racetable td.rank1'),
    ).toHaveText('1');

    // In-app: a new as-published series lands *archived* (history belongs
    // collapsed under the year groups), badged "As published" on its row.
    await page.goto('/');
    await page.getByRole('button', { name: /Archived \(1\)/ }).click();
    const row = page
      .getByTestId('series-row')
      .filter({ hasText: 'Ulsters 2014 Optimists' });
    await expect(row.getByTestId('as-published-chip')).toBeVisible();
    await row.getByRole('link', { name: /Ulsters 2014 Optimists/ }).click();
    await expect(page).toHaveURL(/\/competitors$/);
    await expect(page.getByTestId('as-published-notice')).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByTestId('as-published-notice').getByRole('link', { name: 'Main Fleet' }),
    ).toHaveAttribute('href', /\/p\/.*\/iodai-ulsters-2014\/main-fleet$/);
    // Tabs: Competitors + Standings only; the trimmed ⋯ menu offers no file
    // round-trips, copy, or delete.
    const seriesNav = page
      .getByRole('navigation')
      .filter({ has: page.getByRole('link', { name: 'Competitors' }) })
      .last();
    await expect(seriesNav.getByRole('link', { name: 'Races' })).toHaveCount(0);
    await expect(seriesNav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Series actions' }).click();
    await expect(
      page.getByRole('menuitem', { name: 'Save to File' }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('menuitem', { name: /Delete/ }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('menuitem', { name: 'Unarchive' }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    // The competitor list renders, without add/edit affordances.
    await expect(page.getByText('Aoife Murphy')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /add competitor/i }),
    ).toHaveCount(0);

    // The Standings tab shows the stored tables, exactly as published.
    await seriesNav.getByRole('link', { name: 'Standings' }).click();
    const standings = page.getByTestId('as-published-standings');
    await expect(standings).toBeVisible({ timeout: 15_000 });
    await expect(standings).toContainText('Aoife Murphy');
    await expect(standings).toContainText('(3 DNC)');
    // Podium race cells get the medal badge treatment.
    expect(
      await standings.getByTestId('podium-badge').count(),
    ).toBeGreaterThanOrEqual(2);
    await expect(page.getByText('Sailed: 3, Discards: 1, Entries: 2')).toBeVisible();

    // The standard write surface answers 423 for the regime.
    const edit = await page.request.put(
      `/api/v1/series/${seriesId}/competitors/${aoife}`,
      {
        data: {
          id: aoife,
          seriesId,
          fleetIds: [fleetId],
          sailNumber: 'IRL1200',
          name: 'Renamed By Hand',
          club: '',
          gender: '',
          age: null,
          createdAt: Date.now(),
        },
      },
    );
    expect(edit.status()).toBe(423);
    expect((await edit.json()).reason).toBe('series-as-published');

    expect(errors).toEqual([]);
  });
});
