import { test as baseTest, type Page } from '@playwright/test';

import { todayIsoDate } from '../lib/race-schedule';
import { signedInTest as test, expect } from './fixtures';
import {
  addCompetitor,
  addMemberByEmail,
  createOrgWorkspace,
  createSeriesQuick,
  enableFeatures,
  enableOrgFeatures,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

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
  await createSeriesQuick(page, { name, date: todayIsoDate() });
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

test('a scorer reviews a submitted finish sheet and applies it', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['finish-submissions']);
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

baseTest('a recorder takes a race down on the Record finishes page; the scorer applies it', async ({ browser }) => {
  const ctxScorer = await browser.newContext();
  const ctxRecorder = await browser.newContext();
  const scorer = await ctxScorer.newPage();
  const recorder = await ctxRecorder.newPage();
  const errors: string[] = [];
  for (const [who, pg] of [['scorer', scorer], ['recorder', recorder]] as const) {
    pg.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    pg.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource|Failed to fetch/.test(m.text())) errors.push(`${who}: ${m.text()}`);
    });
  }

  try {
    const stamp = Date.now();
    const scorerEmail = await signInFreshUser(scorer, `submit-scorer-${stamp}`);
    const recorderEmail = await signInFreshUser(recorder, `submit-recorder-${stamp}`);
    const org = await createOrgWorkspace(`Finish Hut ${stamp}`);
    await enableOrgFeatures(org.id, ['finish-submissions']);
    await addMemberByEmail(org.id, scorerEmail, 'owner');
    await addMemberByEmail(org.id, recorderEmail, 'recorder');
    await setActiveWorkspace(scorer, org.id);
    await setActiveWorkspace(recorder, org.id);

    const { seriesId, raceId } = await seriesWithARace(scorer, `Thursday League ${stamp}`);

    // The recorder's workspace has a tab for it; the race is under Today.
    await recorder.goto('/');
    await recorder.getByRole('link', { name: 'Record finishes' }).click();
    await expect(recorder).toHaveURL(/\/workspace\/record$/);
    const picker = recorder.getByTestId('record-race-picker');
    await expect(picker.getByRole('heading', { name: 'Today' })).toBeVisible();
    await picker.getByRole('button', { name: /Race 1/ }).click();

    // The finishing order, as the boats cross.
    const sail = recorder.getByLabel('Sail number');
    const time = recorder.getByLabel('Finish time', { exact: true });
    for (const [n, t] of [['22', '12:42:13'], ['15', '12:43:02'], ['999', '']]) {
      await sail.fill(n);
      await time.fill(t);
      await recorder.getByRole('button', { name: 'Add', exact: true }).click();
    }
    const rows = recorder.getByTestId('recording-rows').getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Bob Dickson');
    await expect(recorder.getByText('1 finisher has no finish time.')).toBeVisible();
    await expect(recorder.getByText(/1 unresolved sail number/)).toBeVisible();
    await recorder.getByLabel('Recorded by').fill('Committee boat');
    await recorder.getByRole('button', { name: 'Submit for review' }).click();
    await expect(recorder.getByRole('status')).toHaveText(
      'Submitted for review: 2 boats matched, 1 sail number for the scorer to resolve.',
    );
    await expect(recorder.getByTestId('submission-status')).toContainText('Waiting for the scorer');

    // A boat that retired: correct it, and submit again.
    await sail.fill('254');
    await recorder.getByRole('button', { name: 'Add', exact: true }).click();
    await recorder.getByLabel('Code for 254').selectOption('RET');
    await recorder.getByText('That’s every boat').click();
    await recorder.getByRole('button', { name: 'Submit again' }).click();
    await expect(recorder.getByTestId('submission-status')).toContainText('revision 2');

    // The scorer applies it from the race.
    await scorer.goto(`/series/${seriesId}/races/${raceId}`);
    const panel = scorer.getByTestId('finish-submissions-panel');
    await expect(panel).toContainText('Committee boat');
    await expect(panel).not.toContainText('still recording');
    await panel.getByRole('button', { name: 'Review' }).click();
    const dialog = scorer.getByRole('dialog');
    await expect(dialog.getByTestId('submission-diff').getByRole('row')).toHaveCount(5);
    await dialog.getByRole('button', { name: 'Apply to the finish sheet' }).click();
    await expect(panel).toBeHidden();

    // And the recorder sees it went on.
    await recorder.reload();
    await expect(recorder.getByTestId('submission-status')).toContainText('Applied to the finish sheet');
    await expect(recorder.getByRole('button', { name: 'Withdraw' })).toHaveCount(0);

    // A recorder writes nothing to the sheet directly.
    const direct = await recorder.request.post(`/api/v1/races/${raceId}/finishes`, { data: { finishes: [] } });
    expect(direct.status()).toBe(403);
  } finally {
    await ctxScorer.close();
    await ctxRecorder.close();
    if (errors.length > 0) throw new Error(`unexpected console/page errors:\n${errors.join('\n')}`);
  }
});
