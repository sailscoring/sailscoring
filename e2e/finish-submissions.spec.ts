import { type Page } from '@playwright/test';

import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick, enableFeatures } from './helpers';

/**
 * Finish sheet submissions (#671): a recording of a race's finishes, made by
 * someone who may not be the scorer, held beside the race until a scorer
 * applies it to the finish sheet or dismisses it.
 *
 * Gated behind the operator-managed `finish-submissions` feature.
 */

/** A quick series with three boats and one race; returns the ids and leaves
 *  the browser on the Races tab. */
async function seriesWithARace(page: Page, name: string): Promise<{ seriesId: string; raceId: string }> {
  await createSeriesQuick(page, { name });
  const seriesId = /\/series\/([0-9a-f-]{36})\//.exec(page.url())![1];
  for (const [sailNumber, helm] of [['15', 'Alice Pearson'], ['22', 'Bob Dickson'], ['254', 'Carol Walls']]) {
    await addCompetitor(page, { sailNumber, name: helm });
  }
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1', { exact: true })).toBeVisible();
  const races = await page.request.get(`/api/v1/series/${seriesId}/races`);
  const [race] = (await races.json()) as { id: string }[];
  return { seriesId, raceId: race.id };
}

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['finish-submissions']);
});

test('a scorer reviews a submitted finish sheet and applies it', async ({ page }) => {
  const { raceId } = await seriesWithARace(page, 'Submitted Sheet');

  // A recording arrives from the committee boat (a scorer may submit too).
  const submissionId = crypto.randomUUID();
  const sent = await page.request.put(`/api/v1/races/${raceId}/submissions/${submissionId}`, {
    data: {
      revision: 1,
      recordedBy: 'Committee boat',
      finishes: [
        { id: 'f1', sailNumber: '22' },
        { id: 'f2', sailNumber: '15' },
        { id: 'f3', sailNumber: '999' },
        { id: 'f4', sailNumber: '254', resultCode: 'DNF' },
      ],
      complete: true,
    },
  });
  expect(sent.ok()).toBe(true);
  expect(await sent.json()).toMatchObject({ match: { matched: 3, unknownSailNumbers: ['999'], skipped: [] } });

  // The Races tab says which race has a sheet waiting.
  await page.reload();
  await expect(page.getByTestId('race-submissions-badge')).toHaveText('Finish sheet to review');

  await page.getByText('Race 1', { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/races/${raceId}$`));
  const panel = page.getByTestId('finish-submissions-panel');
  await expect(panel).toContainText('A finish sheet is waiting for review');
  await expect(panel).toContainText('Committee boat');

  // The review shows what the sheet becomes, boat by boat, before anything is written.
  await panel.getByRole('button', { name: 'Review' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('3 finishers, 1 coded entry (1 unresolved sail number)');
  const diff = dialog.getByTestId('submission-diff');
  await expect(diff.getByRole('row')).toHaveCount(5);
  await expect(diff.getByRole('row').nth(1)).toContainText('22');
  await expect(diff.getByRole('row').nth(4)).toContainText('DNF');
  await dialog.getByRole('button', { name: 'Apply to the finish sheet' }).click();
  await expect(dialog).toBeHidden();
  await expect(panel).toBeHidden();

  // The finish sheet is the submission's, the unknown boat left to resolve.
  await expect.poll(async () => {
    const res = await page.request.get(`/api/v1/races/${raceId}/finishes`);
    const rows = (await res.json()) as { sortOrder: number | null; unknownSailNumber?: string; resultCode: string | null }[];
    return rows.map((f) => [f.sortOrder, f.unknownSailNumber ?? null, f.resultCode]).sort();
  }).toEqual([[1, null, null], [2, null, null], [3, '999', null], [null, null, 'DNF']].sort());

  const submissions = await page.request.get(`/api/v1/races/${raceId}/submissions`);
  expect(await submissions.json()).toMatchObject([{ id: submissionId, status: 'applied', reviewedRevision: 1 }]);

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByText('Race 1', { exact: true })).toBeVisible();
  await expect(page.getByTestId('race-submissions-badge')).toHaveCount(0);
});
