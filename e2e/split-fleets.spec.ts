import { signedInTest as test, expect } from './fixtures';
import {
  createSeriesQuick,
  createSplitFleetSeries,
  enableFeatures,
  openSeriesActionsMenu,
} from './helpers';

/**
 * Split Fleets smoke (also the demo script): enable the feature, create a
 * series, seed demo competitors, enable split fleets (2 qualifying fleets),
 * commit Round 1 (Q1–Q2 created), enter Q1 finishes for both fleets, watch
 * Q1 flip to "counts" while Q2 awaits, see the provisional cut line,
 * reassign Round 2, split into Gold/Silver, check the rehomed standings
 * surfaces (hidden Standings tab, Preview with the championship +
 * assignments pages, the settings card), and select the medal fleet.
 *
 * The series takes the default format preset, which is ILCA's 2026 wording:
 * its stages are the Preliminary, Elimination and Final series, and its races
 * run Q1…Qn across the first two before restarting at F. So the assertions
 * below are also the end-to-end check that the vocabulary reaches every
 * surface — a stage word here reading "qualifying" or "medal" would mean it
 * had not.
 */

// Mirrors the page's demo data: sails 210001 + i*137, seeded by sail-number
// order through the 2-fleet pattern Y B B Y | Y B B Y …
const DEMO_COUNT = 24;
const sails = Array.from({ length: DEMO_COUNT }, (_, i) => `${210001 + i * 137}`);
const yellowSails = sails.filter((_, i) => [0, 3].includes(i % 4));
const blueSails = sails.filter((_, i) => [1, 2].includes(i % 4));

async function enterFinishes(page: import('@playwright/test').Page, sailNumbers: string[]) {
  for (const sail of sailNumbers) {
    await page.getByLabel('Sail number').fill(sail);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
}

test('split fleets: seed → race → reassign → split → medal', async ({ page, signedInEmail }) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  // ── Setup: a championship from the wizard, then seed demo competitors from
  // the tab it lands on ─────────────────────────────────────────────────────
  await createSplitFleetSeries(page, {
    name: 'ILCA Demo Worlds',
    venue: 'Dun Laoghaire',
    fleetCount: 2,
  });
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  // The demo button reloads the page; wait for the empty-list card to
  // disappear (post-reload, competitors present) before touching the round
  // controls — they exist pre-reload too, and the reload would kill the dialog.
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();

  // ── The help beside the tab speaks this series' words ─────────────────────
  // The chapter is not series-scoped; the panel reads the vocabulary from the
  // series it is open beside, and its page link carries it so the shareable
  // form opens in the same words. The demo import reloads the page, so wait
  // for the reloaded tab before opening help — a keypress mid-reload is lost.
  await expect(page.getByRole('button', { name: 'Assign Preliminary fleets' })).toBeVisible();
  await page.getByRole('button', { name: 'Help' }).click();
  const help = page.getByTestId('help-panel');
  await help.getByRole('button', { name: 'Split-fleet championships' }).first().click();
  await expect(help.locator('#help-vocabulary')).toHaveValue('qualification-final');
  await expect(help.getByText('Matching the championship you have open.')).toBeVisible();
  await expect(
    help.locator('#split-fleets p').filter({ hasText: 'Big one-design championships' }),
  ).toContainText('Preliminary fleets');
  await expect(help.getByRole('link', { name: 'Open as a page' })).toHaveAttribute(
    'href',
    '/help/running-a-series?vocab=qualification-final#split-fleets',
  );
  await help.getByRole('button', { name: 'Minimise help' }).click();

  // ── Round 1: seeded, Q1–Q2 created ────────────────────────────────────────
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  await expect(page.getByRole('dialog')).toContainText('Make the initial assignment');
  await page.getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();
  await expect(page.getByText('does not count yet')).toHaveCount(2);

  // ── Q1: one start sequence, one combined sheet ────────────────────────────
  // Both fleet chips open the same race — Yellow and Blue start in sequence
  // and finish onto one combined crossing-order sheet.
  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /Yellow · enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  const q1Url = page.url();
  await enterFinishes(page, yellowSails);
  await page.goBack();
  await q1Row.getByRole('link', { name: /Blue · enter finishes/ }).click();
  await expect(page).toHaveURL(q1Url);
  await enterFinishes(page, blueSails);
  await page.goBack();

  await expect(page.getByText('counts', { exact: true })).toBeVisible();
  await expect(page.getByText('does not count yet')).toHaveCount(1); // Q2 only
  await expect(page.getByText('1 of 2 Preliminary series races count')).toBeVisible();

  // Standings: combined table with the provisional cut line.
  await expect(page.getByText(/cut if the Preliminary series ended now/)).toBeVisible();

  // Fleet markers: the combined table carries a Fleet column with the current
  // round's assignment, and a legend keys the per-cell dots.
  const standingsSection = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'Standings', exact: true }) });
  await expect(
    standingsSection.getByText('Race cells are marked with the fleet the race was sailed in'),
  ).toBeVisible();
  await expect(standingsSection.getByRole('columnheader', { name: 'Fleet' })).toBeVisible();

  // ── Round 2: rank-pattern reassignment from the Q1 ranking ────────────────
  await page.getByRole('button', { name: 'Assign Round 2' }).click();
  await expect(page.getByRole('dialog')).toContainText('From the ranking after Q1');
  // With one counted race, each fleet's Nth boats hold identical score lines
  // RRS A8 cannot separate: the preview numbers such a pair by its shared
  // rank and warns that the deal — not the ranking — split them across fleets.
  await expect(page.getByRole('dialog')).toContainText(
    `${sails[0]}, ${sails[1]} share rank 1 and RRS A8 cannot separate them`,
  );
  await page.getByRole('button', { name: /Commit Round 2/ }).click();
  await expect(page.getByText('Round 2 · Q3 onward')).toBeVisible();

  // ── Split into Gold / Silver ──────────────────────────────────────────────
  await page.getByRole('button', { name: 'End the Preliminary series → split fleets' }).click();
  await expect(page.getByRole('dialog')).toContainText('The split is frozen once committed');
  await page.getByRole('button', { name: /Commit split \(12 \/ 12\)/ }).click();
  await expect(page.getByText('Split committed')).toBeVisible();
  // Labelled Q5, not F1: the default ILCA format numbers its final-series
  // races on from the qualifying series (Q1–Q4 exist), as its SIs do.
  await expect(page.getByRole('link', { name: /Q5 · enter finishes/ })).toHaveCount(2);

  // Tiered standings: one table per final fleet. The Fleet column is gone —
  // the per-fleet headings name it instead.
  await expect(page.getByRole('heading', { name: /Gold/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Silver/ })).toBeVisible();
  await expect(standingsSection.getByRole('columnheader', { name: 'Fleet' })).toHaveCount(0);

  // ── Rehomed standings surfaces ────────────────────────────────────────────
  // The regular Standings tab is hidden for a split-fleet series; preview and
  // publish live on this page instead. Preview builds the three published
  // pages: the championship standings, the per-race results and the rolling
  // fleet assignments.
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Standings' }),
  ).toHaveCount(0);

  // The `?` shortcut dialog tracks the visible tabs: Split Fleets gets its
  // go-to chord row, the hidden Standings tab gets none.
  await page.keyboard.press('?');
  const shortcutHelp = page.getByRole('dialog');
  await expect(shortcutHelp.getByText('Go to Split Fleets')).toBeVisible();
  await expect(shortcutHelp.getByText('Go to Standings')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(shortcutHelp).toBeHidden();

  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('Preview results');
  await preview.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: 'Championship' })).toBeVisible();
  await expect(page.getByRole('option', { name: 'Race results' })).toBeVisible();
  // Pick a page rather than dismissing the popup — closing a select and its
  // parent dialog with back-to-back Escapes leaves Radix's aria-hidden
  // restore in a broken state that strips the nav's accessibility role.
  await page.getByRole('option', { name: 'Fleet assignments' }).click();
  await preview.getByRole('button', { name: 'Close' }).click();
  await expect(preview).toBeHidden();

  // The format lives in this page's own Format section; Settings has nothing
  // to say about it beyond hiding the scoring card.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('h2', { hasText: /^Fleets$/ })).toBeVisible();
  await expect(page.getByRole('main').locator('h2', { hasText: /Split-fleet/ })).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await expect(page.getByText('Split committed')).toBeVisible();
  await page.getByRole('button', { name: /^Format/ }).click();
  const formatSection = page.getByTestId('split-fleets-editor');
  await expect(formatSection).toBeVisible();
  const si = page.getByTestId('sf-si-translation');
  await expect(si).toContainText('will count for total points in the Qualification series');

  // Reaching a setting marks the sentences it writes, so which clause a field
  // governs doesn't have to be found by flipping it.
  await formatSection.locator('#sf-equalization').hover();
  await expect(si.locator('[data-sentence="fleet-equalisation"]')).toHaveAttribute(
    'data-marked',
    'true',
  );
  await expect(si.locator('[data-sentence="discards"]')).not.toHaveAttribute('data-marked', 'true');
  // Focus wins over the pointer: the mouse is still resting on the setting
  // above, but the scorer is typing in this one.
  await formatSection.getByLabel('Scores excluded').first().focus();
  await expect(si.locator('[data-sentence="discards"]')).toHaveAttribute('data-marked', 'true');
  await expect(si.locator('[data-sentence="final-discard-cap"]')).toHaveAttribute(
    'data-marked',
    'true',
  );
  await expect(si.locator('[data-sentence="fleet-equalisation"]')).not.toHaveAttribute(
    'data-marked',
    'true',
  );
  // The panel is capped at the window's height with the sentences scrolling
  // inside it, so the last setting's sentence is brought into view rather
  // than left below the fold where the mark can't be read.
  await formatSection.getByLabel('How ties between the top boats are broken').focus();
  const tieBreak = si.locator('[data-sentence="medal-tie-break"]');
  await expect(tieBreak).toHaveAttribute('data-marked', 'true');
  await expect(tieBreak).toBeInViewport();

  // ── Medal fleet ───────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Select Final series fleet…' }).click();
  await expect(page.getByRole('dialog')).toContainText('Select the Final series fleet');
  await page.getByRole('button', { name: /Commit Final series fleet \(top 10\)/ }).click();
  // The ILCA format calls this stage the Final series and scores it ×1.
  await expect(page.getByText('Final series score ×1')).toBeVisible();
  // One race, for the Final series fleet alone. The boats who miss the cut
  // sail one more Elimination race with their own fleet (SI 7.7), added from
  // the Elimination series section — the ceremony deals no second fleet here.
  await expect(page.getByRole('link', { name: /F1/ })).toHaveCount(1);
  await expect(page.getByText('Gold last race')).toHaveCount(0);
  // And the section says where that race comes from, and what it scores.
  await expect(page.getByText('add that race from the Elimination series section')).toBeVisible();
  await expect(page.getByText('In the fleet they left it scores from 11')).toBeVisible();

  // ── Promote into the Final series fleet as redress ────────────────────────
  // The protest committee directs an eleventh boat into the deciding fleet;
  // she keeps her Gold membership, and the dialog says what the extra boat
  // does to a Q12 added afterwards.
  await page.getByRole('button', { name: 'Promote (redress)…' }).click();
  const promoteDialog = page.getByRole('dialog');
  await expect(promoteDialog).toContainText('With 11 boats');
  await expect(promoteDialog).toContainText('score from 12');
  await promoteDialog.locator('#sf-promote-boat').selectOption({ index: 1 });
  await promoteDialog.getByRole('button', { name: 'Promote', exact: true }).click();
  await expect(promoteDialog).toBeHidden();
  await expect(page.getByText('Final series11')).toBeVisible();

  // ── The way back: both ceremonies can be undone, newest first ─────────────
  // Delete the Final series fleet — its memberships and F1 go with it, and
  // the Elimination series is once again the deciding stage.
  await page.getByRole('button', { name: 'Delete the Final series fleet…' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Delete the Final series fleet?');
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(page.getByRole('button', { name: 'Select Final series fleet…' })).toBeVisible();
  await expect(page.getByRole('link', { name: /F1/ })).toHaveCount(0);
  // With the Final series fleet gone, the split itself can be undone too.
  await page.getByRole('button', { name: 'Delete the split…' }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText('Delete the split?');
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(
    page.getByRole('button', { name: 'End the Preliminary series → split fleets' }),
  ).toBeVisible();
});

/**
 * The abandoned-fleet flow: Q1 starts Yellow and Blue in one sequence, but
 * Blue's race is abandoned (no wind) before any Blue boat finishes. The
 * scorer abandons Blue's start — the sequence keeps Yellow's completed
 * sheet — and later adds a catch-up race for Blue alone, with its own sheet.
 */
test('split fleets: abandon one fleet of a sequence, then re-race it', async ({
  page,
  signedInEmail,
}) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Abandon Worlds', venue: 'Dun Laoghaire', fleetCount: 2 });
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  await page.getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();

  // Yellow finishes on the combined sheet; Blue never got a race in.
  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /Yellow · enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  const sequenceUrl = page.url();
  await enterFinishes(page, yellowSails);
  await page.goBack();

  // Abandon Blue's race: the start leaves the sequence, Yellow stands.
  await q1Row.getByRole('button', { name: "Abandon Blue's race" }).click();
  await expect(page.getByTestId('confirm-dialog')).toContainText(
    "Abandon Blue's Q1?",
  );
  await page.getByTestId('confirm-dialog-confirm').click();
  await expect(q1Row.getByText('Blue — no race')).toBeVisible();
  await expect(q1Row.getByText(/Yellow ✓/)).toBeVisible();
  await expect(page.getByText('does not count yet')).toHaveCount(2); // Q1 and Q2

  // The catch-up race: Blue alone, its own sheet on its own race.
  await q1Row.getByRole('button', { name: 'Add catch-up race' }).click();
  await q1Row.getByRole('link', { name: /Blue · enter finishes/ }).click();
  await expect(page).toHaveURL(/\/races\//);
  expect(page.url()).not.toBe(sequenceUrl);
  await enterFinishes(page, blueSails);
  await page.goBack();
  await expect(page.getByText('counts', { exact: true })).toBeVisible();
  await expect(page.getByText('1 of 2 Preliminary series races count')).toBeVisible();
});

/**
 * Publishing a split-fleet series through the ADR-011 Season + Folder dialog:
 * the championship standings, per-race results and rolling fleet-assignments
 * pages land in the publication tree, the event folder lists them, and the
 * public pages render — with the championship's race columns deep-linking
 * into the race page. This is the seam where the split-fleets publish output
 * meets the publication-tree model — covered end-to-end here.
 */
test('split fleets: publish lands the championship + race + assignments pages in the tree', async ({
  page,
  browser,
  signedInEmail,
}) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSplitFleetSeries(page, { name: 'Publish Worlds', venue: 'Dun Laoghaire', fleetCount: 2 });
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  await page.getByRole('button', { name: /Commit Round 1/ }).click();

  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /Yellow · enter finishes/ }).click();
  await enterFinishes(page, [...yellowSails, ...blueSails]);
  await page.goBack();
  await expect(page.getByText('1 of 2 Preliminary series races count')).toBeVisible();

  // Publish through the Season + Folder dialog.
  await page.getByRole('button', { name: 'Publish…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByLabel('Season')).toHaveValue('2026');
  await dialog.getByLabel('Folder').fill('worlds-26');
  // Before publishing, the dialog names every page it is about to put out.
  // The championship is the lone results page — called "Championship" here as
  // it is in Preview, not the generic "Standings" — and the per-race results
  // and rolling assignments pages ride with it.
  await expect(dialog.getByText('Championship')).toBeVisible();
  await expect(dialog.getByText('Race results')).toBeVisible();
  await expect(dialog.getByText('Fleet assignments')).toBeVisible();
  // Tickable like any other page — a scorer may publish a subset — and ticked
  // by default on a first publish.
  await expect(dialog.getByRole('checkbox', { name: 'Publish Race results' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Publish Fleet assignments' })).toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'Publish Fleet assignments' })).toBeEnabled();
  await expect(dialog.getByLabel('URL for Race results')).toHaveValue('race-results');
  const assignmentsUrl = dialog.getByLabel('URL for Fleet assignments');
  await expect(assignmentsUrl).toHaveValue('fleet-assignments');
  await assignmentsUrl.fill('who-is-in-what-fleet');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // All three pages get URLs under /p/{ws}/2026/worlds-26/.
  const champLink = dialog.getByRole('link', { name: /worlds-26\/standings$/ });
  await expect(champLink).toBeVisible();
  // Exactly one row per page: the extra pages are listed by the extra-pages
  // block, not also as results pages.
  await expect(dialog.getByRole('link', { name: /worlds-26\/race-results$/ })).toHaveCount(1);
  await expect(dialog.getByRole('link', { name: /worlds-26\/who-is-in-what-fleet$/ })).toHaveCount(1);
  const champPath = new URL((await champLink.getAttribute('href')) ?? '').pathname;

  // The public championship page renders the combined qualifying table, in the
  // same shell as every other published page — including the cascade to its
  // sibling pages, which a hand-rolled document had no way to show (#428).
  await page.goto(champPath);
  await expect(page.getByText('Publish Worlds').first()).toBeVisible();
  await expect(page.getByRole('link', { name: /Publish Worlds/ }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save as PDF' })).toBeVisible();
  await expect(page.getByText(yellowSails[0]).first()).toBeVisible();

  // The Q1 column header deep-links into the per-race results page, which
  // pulls the start sequence's combined sheet apart into one ranked table per
  // fleet.
  await page.getByRole('link', { name: 'Q1', exact: true }).click();
  await expect(page).toHaveURL(/\/worlds-26\/race-results#q1$/);
  await expect(page.getByRole('heading', { name: 'Yellow fleet' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Blue fleet' })).toBeVisible();
  await expect(page.getByText(yellowSails[0]).first()).toBeVisible();

  // The event folder lists all three pages; assignments shows the round's
  // fleets.
  await page.goto(champPath.replace(/\/standings$/, ''));
  await expect(page.getByRole('heading', { name: 'Publish Worlds' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Championship' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Race results' })).toBeVisible();
  await page.getByRole('link', { name: 'Fleet assignments' }).click();
  await expect(page).toHaveURL(/\/worlds-26\/who-is-in-what-fleet$/);
  await expect(page.getByText(/Preliminary series round 1/)).toBeVisible();

  // The published standings state the format they were scored under, in the
  // language a sailing instruction's scoring section uses — folded away, and
  // in this series' own vocabulary (#498).
  await page.goto(champPath);
  const formatBlock = page.locator('details.sfformat');
  await expect(formatBlock.locator('li').first()).toBeHidden();
  await formatBlock.getByText('How this championship is scored').click();
  await expect(formatBlock.locator('li').first()).toBeVisible();
  await expect(formatBlock).toContainText(/Preliminary/);

  // A championship publishes its data file like any other results page
  // (#496), carrying the assignment rounds its pages were built from.
  const dataHref =
    (await page
      .getByRole('link', { name: 'Data (.sailscoring.json)' })
      .getAttribute('href')) ?? '';
  expect(dataHref).toMatch(/\.sailscoring\.json$/);
  const exported = await (await page.request.get(dataHref)).json();
  expect(exported.splitFleets.rounds.length).toBeGreaterThan(0);

  // And a reader with no account gets the championship standings they were
  // looking at — one ranking over the stages — rather than a table per round
  // fleet, which is what the data file with no rounds behind it would give.
  const anon = await browser.newContext();
  const anonPage = await anon.newPage();
  await anonPage.goto(champPath);
  await anonPage.getByRole('link', { name: 'Open in Sail Scoring' }).click();
  await expect(anonPage).toHaveURL(/\/series\/spectator-/);
  await expect(anonPage.getByRole('columnheader', { name: 'Q1', exact: true })).toBeVisible();
  await expect(anonPage.getByRole('columnheader', { name: 'Nett' })).toBeVisible();
  await expect(anonPage.getByText(yellowSails[0]).first()).toBeVisible();
  // …with the same statement of the format under it (#498).
  await anonPage.getByRole('button', { name: 'How this championship is scored' }).click();
  await expect(anonPage.getByTestId('sf-format').getByRole('listitem').first()).toBeVisible();
  await expect(anonPage.getByTestId('sf-format')).toContainText(/Preliminary/);
  await anon.close();
});

/**
 * The setup wizard asks what kind of series this is before anything else, and
 * a split-fleet championship's setup is two steps that land on the tab, with
 * the Format section open to be checked against the sailing instructions.
 */
test('split fleets: the kind of series is chosen first, and setup lands on the tab', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  await page.goto('/series/new');
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/setup$/);
  await page.getByLabel('Name').fill('Wizard Worlds');

  // A series has four steps; a championship has no fleets or scoring steps,
  // and the choice can be reversed while nothing has been built on it.
  const kind = page.getByTestId('series-kind');
  await expect(page.getByRole('button', { name: /4\. Scoring/ })).toBeVisible();
  await kind.getByRole('radio', { name: /Split-fleet championship/ }).click();
  await expect(page.getByRole('button', { name: /3\. Fleets/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /2\. Competitors/ })).toBeVisible();
  await kind.getByRole('radio', { name: /^Series\b/ }).click();
  await expect(page.getByRole('button', { name: /4\. Scoring/ })).toBeVisible();
  await kind.getByRole('radio', { name: /Split-fleet championship/ }).click();
  await expect(page.getByRole('button', { name: /3\. Fleets/ })).toHaveCount(0);

  // The entry list is imported knowing what it is for, and setup ends here.
  await page.getByRole('button', { name: /Next: Competitors/ }).click();
  await expect(page.getByText(/seeding committee/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Next: Fleets/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Finish setup/ }).click();

  await expect(page).toHaveURL(/\/split-fleets$/);
  // Format is open until Round 1, settings beside their sailing-instruction
  // translation, with the initial format filled in.
  await expect(page.locator('#sf-fleet-count')).toHaveValue('3');
  await expect(page.getByTestId('sf-si-translation')).toContainText(
    'will count for total points in the Qualification series',
  );
  await expect(page.getByRole('button', { name: 'Assign Preliminary fleets' })).toBeVisible();

  // A series that isn't a championship has no such tab, and Settings offers
  // no way to become one.
  await createSeriesQuick(page, { name: 'Plain Series' });
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }),
  ).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.locator('h2', { hasText: /^Fleets$/ })).toBeVisible();
  await expect(page.getByRole('main').locator('h2', { hasText: /Split-fleet/ })).toHaveCount(0);
});

/**
 * A saved championship survives a round-trip through a `.sailscoring` file
 * (#365). The in-app open replays in the browser, so the split-fleet block
 * only lands if the client repository can write it — before the fix the
 * series imported with no format, no rounds and no Split Fleets tab.
 */
test('split fleets: the format and rounds survive a file round-trip', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  await createSplitFleetSeries(page, { name: 'Round Trip Worlds', venue: 'Dun Laoghaire', fleetCount: 2 });
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Assign Preliminary fleets' }).click();
  await page.getByRole('button', { name: /Commit Round 1/ }).click();
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();

  // ── Save to file ──────────────────────────────────────────────────────────
  await openSeriesActionsMenu(page);
  const item = page.getByRole('menuitem', { name: 'Save to File' });
  await expect(item).toBeVisible();
  const download = page.waitForEvent('download');
  await item.click();
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const saved = JSON.parse(Buffer.concat(chunks).toString('utf-8'));
  expect(saved.splitFleets.rounds).toHaveLength(1);

  // Fresh seriesId so the import takes the "new series" branch rather than
  // offering to update the series it came from.
  const freshId = crypto.randomUUID();
  const fresh = {
    ...saved,
    seriesId: freshId,
    series: { ...saved.series, id: freshId, name: 'Round Trip Reopened' },
  };

  // ── Import it back ────────────────────────────────────────────────────────
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible();
  await page.getByRole('button', { name: 'Import Series' }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByTestId('import-format-sailscoring').click(),
  ]);
  await fileChooser.setFiles({
    name: 'round-trip.sailscoring',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fresh)),
  });
  await expect(page).toHaveURL(/\/series\/[^/]+\/races$/);
  await expect(page.getByRole('heading', { name: 'Round Trip Reopened' })).toBeVisible();

  // ── The championship came with it ─────────────────────────────────────────
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await expect(page.getByText('Round 1 · Q1 onward')).toBeVisible();
  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await expect(q1Row.getByRole('link', { name: /Yellow · enter finishes/ })).toBeVisible();
  await expect(q1Row.getByRole('link', { name: /Blue · enter finishes/ })).toBeVisible();
});
