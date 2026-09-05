import { signedInTest as test, expect } from './fixtures';
import { addCompetitor, createFleets, createSeriesQuick, enableFeatures } from './helpers';

/**
 * The published competitor list (#423). The point of the page is the window it
 * covers: before race one, when there are no standings to publish but the
 * entry list is exactly what competitors are looking for. So the test runs a
 * series with competitors and no races at all, and checks the page reaches the
 * public URL carrying the roster and none of the results furniture.
 */

const entries = [
  { sailNumber: 'IRL 215', name: 'Mark McLoughlin', tally: 'T0001' },
  { sailNumber: 'GBR 41', name: 'Hannah Mills', tally: 'T0002' },
];

test('the competitor list publishes before any race is sailed', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['entry-list']);

  await createSeriesQuick(page, { name: 'ILCA 7 Worlds 2026', venue: 'Dun Laoghaire' });

  // ── 1. Enable the tally field, so the list carries more than the basics ──
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Competitor fields' })
    .locator('..')
    .getByRole('button', { name: 'Edit ▸' })
    .click();
  await page.getByRole('checkbox', { name: 'Tally number' }).check();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── 2. A roster, and deliberately no races ───────────────────────────────
  await page.getByRole('link', { name: 'Competitors' }).click();
  await expect(page.getByRole('button', { name: 'Add competitor' })).toBeVisible();
  for (const c of entries) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByLabel('Tally number').fill(c.tally);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // ── 3. Publish from the Competitors tab — the page the list is made of ───
  await page.getByRole('button', { name: 'Publish…' }).click();
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Publish results' })).toHaveCount(0);

  // ── 4. Standings has nothing to show, but says the list can go up ────────
  await page.getByRole('link', { name: 'Standings' }).click();
  await expect(page.getByText('The competitor list can be published now.')).toBeVisible();

  // ── 5. Publish it ────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('URL for Entries')).toHaveValue('entries');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // The only live page is the entry list, so it gets exactly one row: the
  // dialog's lone-results-page line is left out when there are no results.
  const link = dialog.getByRole('link', { name: /\/entries$/ });
  await expect(link).toHaveCount(1);
  await expect(link).toBeVisible();
  const entriesPath = new URL((await link.getAttribute('href')) ?? '').pathname;

  // ── 6. The public page: the roster, and nothing derived from racing ──────
  await page.goto(entriesPath);
  await expect(page.getByRole('columnheader', { name: 'Sail Number' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Tally' })).toBeVisible();
  await expect(page.getByText('Entries: 2')).toBeVisible();
  for (const c of entries) {
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
    await expect(page.getByRole('cell', { name: c.tally })).toBeVisible();
  }
  await expect(page.getByRole('columnheader', { name: 'Rank' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Total' })).toHaveCount(0);

  // ── 7. And it is listed on the event index ───────────────────────────────
  await page.goto(entriesPath.replace(/\/entries$/, ''));
  await expect(page.getByRole('link', { name: 'Entries' })).toBeVisible();
});

/**
 * Which pages go public is the scorer's call, including the results page. A
 * series with a race sailed can still publish its entry list alone — the
 * standings stay unpublished until the scorer wants them out.
 */
test('the results page can be left unpublished while the entry list goes out', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['entry-list']);
  await createSeriesQuick(page, { name: 'Entries Only' });

  for (const c of entries) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.name);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber })).toBeVisible();
  }

  // A sailed race, so standings genuinely exist to be withheld.
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await expect(page.getByText('Race 1')).toBeVisible();
  await page.getByText('Race 1').click();
  for (const c of entries) {
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByRole('button', { name: 'Add' }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('navigation').getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();

  // Untick the results page; publish the entry list on its own.
  const standings = dialog.getByRole('checkbox', { name: 'Publish Standings' });
  await expect(standings).toBeChecked();
  await standings.uncheck();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  const link = dialog.getByRole('link', { name: /\/entries$/ });
  await expect(link).toBeVisible();
  const entriesPath = new URL((await link.getAttribute('href')) ?? '').pathname;

  // The choice survives into the published view: the row is still tickable,
  // so the scorer can go on withholding the standings.
  const liveStandings = dialog.getByRole('checkbox', { name: 'Publish Standings' });
  await expect(liveStandings).toBeVisible();
  await expect(liveStandings).toBeEnabled();
  await expect(liveStandings).not.toBeChecked();

  // The entry list is public; the standings page was never created. Checked
  // over HTTP rather than by navigating, which would close the dialog.
  const standingsPath = entriesPath.replace(/\/entries$/, '/standings');
  expect((await page.request.get(standingsPath)).status()).toBe(404);

  // ...and it can be published later. A page held back is offered again,
  // unticked, rather than disappearing once a publication exists.
  await liveStandings.check();
  await dialog.getByRole('button', { name: 'Re-publish' }).click();
  const standingsLink = dialog.getByRole('link', { name: /\/standings$/ });
  await expect(standingsLink).toBeVisible();
  // It lands beside the entry list, in the same event folder — not adrift at
  // the top of the season.
  const livePath = new URL((await standingsLink.getAttribute('href')) ?? '').pathname;
  expect(livePath).toBe(standingsPath);

  await page.goto(entriesPath);
  await expect(page.getByText('Entries: 2')).toBeVisible();
  await page.goto(standingsPath);
  // The sail number appears in the summary table and again in the race table.
  await expect(page.getByRole('cell', { name: entries[0].sailNumber }).first()).toBeVisible();
});

/**
 * The starters checklist prints from the published competitor list: one
 * table per start, not per fleet, so a class scored under IRC and HPH at once
 * is one table with each boat on it once. The button sets a body class for
 * the duration of the print and the print stylesheet does the rest, so the
 * test stubs the print dialog and looks at the page under print media.
 */
test('the competitor list prints as a starters checklist, one table per start', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['entry-list']);
  await createSeriesQuick(page, { name: 'Autumn League' });
  await createFleets(page, ['Class 1 IRC', 'Class 1 HPH', 'Class 2 HPH']);
  await page.getByRole('navigation').getByRole('link', { name: 'Competitors' }).click();

  // Checkmate is scored under both Class 1 systems; the others under one.
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number *').fill('IRL 1234');
  await page.getByLabel('Competitor name').fill('Checkmate');
  await page.getByRole('checkbox', { name: 'Class 1 IRC' }).check();
  await page.getByRole('checkbox', { name: 'Class 1 HPH' }).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: 'IRL 1234' })).toBeVisible();
  await addCompetitor(page, { sailNumber: 'IRL 88', name: 'Storm', fleet: 'Class 1 HPH' });
  await addCompetitor(page, { sailNumber: 'IRL 2001', name: 'Gecko', fleet: 'Class 2 HPH' });

  await page.getByRole('button', { name: 'Publish…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/entries$/ });
  await expect(link).toBeVisible();
  const entriesPath = new URL((await link.getAttribute('href')) ?? '').pathname;

  await page.goto(entriesPath);
  await expect(page.getByText('Entries: 3')).toBeVisible();

  // On screen the checklist is nowhere to be seen; the button is.
  const checklist = page.locator('.starterslist');
  await expect(checklist).toBeHidden();
  await page.evaluate(() => {
    (window as unknown as { __printed: boolean }).__printed = false;
    window.print = () => {
      (window as unknown as { __printed: boolean }).__printed = true;
    };
  });
  await page.getByRole('button', { name: 'Print starters checklist' }).click();
  expect(await page.evaluate(() => (window as unknown as { __printed: boolean }).__printed)).toBe(true);
  await expect(page.locator('body')).toHaveClass(/\bstarters\b/);

  // What the printer sees: the checklist in place of the entry list, two
  // tables headed by the class, and Checkmate once.
  await page.emulateMedia({ media: 'print' });
  await expect(checklist).toBeVisible();
  await expect(page.locator('table.summarytable')).toBeHidden();
  await expect(checklist.getByRole('heading', { name: 'Class 1', exact: true })).toBeVisible();
  await expect(checklist.getByRole('heading', { name: 'Class 2 HPH', exact: true })).toBeVisible();
  await expect(checklist.locator('td.sail', { hasText: 'IRL 1234' })).toHaveCount(1);
  await expect(checklist.locator('td.sail')).toHaveCount(3);
  await expect(checklist.getByRole('heading', { name: 'Class 1 IRC' })).toHaveCount(0);

  // Once the dialog closes the page is its ordinary self again.
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  await expect(page.locator('body')).not.toHaveClass(/\bstarters\b/);
  await expect(checklist).toBeHidden();
  await expect(page.locator('table.summarytable')).toBeVisible();
});
