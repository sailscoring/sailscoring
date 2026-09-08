import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createSeriesQuick, enableFeatures } from './helpers';

/**
 * A note on a published page (#511).
 *
 * The happy path is the one the feature exists for: the scorer writes a
 * sentence in Preview, sees it land in the page, publishes, and a reader with
 * no account reads it above the results — and so does anyone who takes the
 * page's data file. Then a second publish carries it without retyping.
 */

/** One-competitor, one-race series on the Standings tab; returns its id. */
async function seedSeries(page: import('@playwright/test').Page, name: string): Promise<string> {
  await createSeriesQuick(page, { name });
  const seriesId = page.url().match(/\/series\/([0-9a-f-]{36})/)?.[1];
  if (!seriesId) throw new Error(`Not on a series page: ${page.url()}`);
  await addCompetitor(page, { sailNumber: '42', name: 'Alice' });

  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('42');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  return seriesId;
}

const NOTE =
  'Race 3 was abandoned and resailed; see [the notice](https://results.hyc.ie/notice) for the detail.';

test('a note written in Preview lands on the published page and in its data file', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['page-notes']);
  const seriesId = await seedSeries(page, 'Note League 2026');

  // ── Written where the page is in view ────────────────────────────────────
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview results' });
  await expect(preview).toBeVisible();
  await page.frameLocator('iframe[title="Results preview"]').locator('body').waitFor();

  await preview.getByRole('button', { name: 'Add a note' }).click();
  await preview.getByTestId('page-note-text').fill(NOTE);
  await preview.getByRole('button', { name: 'Save' }).click();

  // The preview rebuilds, so the note is read in place before anyone else
  // reads it — and the link is a link, not the source text.
  const frame = page.frameLocator('iframe[title="Results preview"]');
  await expect(frame.locator('.pagenotes')).toContainText('Race 3 was abandoned and resailed');
  await expect(frame.locator('.pagenotes a')).toHaveAttribute(
    'href',
    'https://results.hyc.ie/notice',
  );
  await page.keyboard.press('Escape');
  await expect(preview).toBeHidden();

  // ── Published ────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const path = new URL((await link.getAttribute('href')) ?? '').pathname;
  await page.keyboard.press('Escape');

  // ── Read, with no account, above the results ─────────────────────────────
  await page.goto(path);
  const note = page.locator('.pagenotes');
  await expect(note).toContainText('Race 3 was abandoned and resailed');
  await expect(note.getByRole('link', { name: 'the notice' })).toHaveAttribute(
    'href',
    'https://results.hyc.ie/notice',
  );

  // The data file beside the page carries it too, so a reader who takes the
  // data keeps the sentence that explained the figures (ADR-012).
  const dataHref =
    (await page.getByRole('link', { name: 'Data (.sailscoring.json)' }).getAttribute('href')) ?? '';
  const exported = await (await page.request.get(dataHref)).json();
  expect(exported.series.pageNotes[0].text).toBe(NOTE);

  // ── Survives a re-publish without being retyped ──────────────────────────
  await page.goto(`/series/${seriesId}/standings`);
  await page.getByRole('button', { name: 'Publish' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  await expect(dialog.getByRole('link', { name: /\/p\// })).toBeVisible();
  await page.goto(path);
  await expect(page.locator('.pagenotes')).toContainText('Race 3 was abandoned and resailed');
});

test('the publish dialog writes a note on the page whose row it is on', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['page-notes']);
  await seedSeries(page, 'Row Note League 2026');

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();

  // The note that goes on every page of the publication.
  await dialog.getByTestId('page-note-button-every-page').click();
  await dialog.getByTestId('page-note-text').fill('Corrected 16:40.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByTestId('page-note-editor')).toBeHidden();
  await expect(dialog.getByText('Corrected 16:40.')).toBeVisible();

  // And this page's own, from its row.
  await dialog.getByTestId('page-note-button-@default').click();
  await dialog.getByTestId('page-note-text').fill('Sailed in fog.');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(dialog.getByTestId('page-note-editor')).toBeHidden();

  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  await page.goto(new URL((await link.getAttribute('href')) ?? '').pathname);

  // Both, series note first.
  const note = page.locator('.pagenotes');
  await expect(note).toContainText('Corrected 16:40.');
  await expect(note).toContainText('Sailed in fog.');
  await expect(note.locator('p').first()).toHaveText('Corrected 16:40.');
});

test('without the feature there is no note to write and none is published', async ({ page }) => {
  await seedSeries(page, 'Ungated League 2026');

  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Preview results' });
  await expect(preview).toBeVisible();
  await page.frameLocator('iframe[title="Results preview"]').locator('body').waitFor();
  await expect(preview.getByTestId('page-note-strip')).toHaveCount(0);
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('page-note-button-every-page')).toHaveCount(0);
});
