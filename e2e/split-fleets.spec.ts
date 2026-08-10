import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures, openSeriesActionsMenu } from './helpers';

/**
 * Split Fleets smoke (also the demo script): enable the feature, create a
 * series, seed demo competitors, enable split fleets (2 qualifying fleets),
 * commit Round 1 (Q1–Q2 created), enter Q1 finishes for both fleets, watch
 * Q1 flip to "counts" while Q2 awaits, see the provisional cut line,
 * reassign Round 2, split into Gold/Silver, check the rehomed standings
 * surfaces (hidden Standings tab, Preview with the championship +
 * assignments pages, the settings card), and select the medal fleet.
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

  await createSeriesQuick(page, { name: 'ILCA Demo Worlds', venue: 'Dun Laoghaire' });

  // ── Setup: enable from Settings (no Split Fleets tab until configured),
  // then seed demo competitors from the new tab ─────────────────────────────
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }),
  ).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const sfSetupCard = page.getByTestId('split-fleets-card');
  await expect(sfSetupCard).toContainText('Split-fleet championship');
  await sfSetupCard.locator('#sf-fleet-count').selectOption('2');
  await sfSetupCard.getByRole('button', { name: 'Enable split fleets' }).click();

  // The tab appears (leading the bar) once the series carries a config.
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  // The demo button reloads the page; wait for the empty-list card to
  // disappear (post-reload, competitors present) before touching the round
  // controls — they exist pre-reload too, and the reload would kill the dialog.
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();

  // ── Round 1: seeded, Q1–Q2 created ────────────────────────────────────────
  await page.getByRole('button', { name: 'Assign qualifying fleets' }).click();
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
  await expect(page.getByText('1 of 2 qualifying races count')).toBeVisible();

  // Standings: combined table with the provisional cut line.
  await expect(page.getByText(/cut if qualifying ended now/)).toBeVisible();

  // ── Round 2: rank-pattern reassignment from the Q1 ranking ────────────────
  await page.getByRole('button', { name: 'Assign Round 2' }).click();
  await expect(page.getByRole('dialog')).toContainText('From the ranking after Q1');
  await page.getByRole('button', { name: /Commit Round 2/ }).click();
  await expect(page.getByText('Round 2 · Q3 onward')).toBeVisible();

  // ── Split into Gold / Silver ──────────────────────────────────────────────
  await page.getByRole('button', { name: 'End qualifying → split fleets' }).click();
  await expect(page.getByRole('dialog')).toContainText('The split is frozen once committed');
  await page.getByRole('button', { name: /Commit split \(12 \/ 12\)/ }).click();
  await expect(page.getByText('Split committed')).toBeVisible();
  await expect(page.getByRole('link', { name: /F1 · enter finishes/ })).toHaveCount(2);

  // Tiered standings: one table per final fleet.
  await expect(page.getByRole('heading', { name: /Gold/ })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Silver/ })).toBeVisible();

  // ── Rehomed standings surfaces ────────────────────────────────────────────
  // The regular Standings tab is hidden for a split-fleet series; preview and
  // publish live on this page instead. Preview builds the two published
  // pages: the championship standings and the rolling fleet assignments.
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Standings' }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.getByRole('dialog');
  await expect(preview).toContainText('Preview results');
  await preview.getByRole('combobox').click();
  await expect(page.getByRole('option', { name: 'Championship' })).toBeVisible();
  // Pick a page rather than dismissing the popup — closing a select and its
  // parent dialog with back-to-back Escapes leaves Radix's aria-hidden
  // restore in a broken state that strips the nav's accessibility role.
  await page.getByRole('option', { name: 'Fleet assignments' }).click();
  await preview.getByRole('button', { name: 'Close' }).click();
  await expect(preview).toBeHidden();

  // The format lives in this page's own Format section, not in Settings.
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByTestId('split-fleets-card')).toHaveCount(0);
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await expect(page.getByText('Split committed')).toBeVisible();
  await page.getByRole('button', { name: /^Format/ }).click();
  const formatSection = page.getByTestId('split-fleets-editor');
  await expect(formatSection).toBeVisible();
  await expect(page.getByTestId('sf-si-translation')).toContainText(
    'will count for total points in the championship',
  );

  // ── Medal fleet ───────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Select medal fleet…' }).click();
  await expect(page.getByRole('dialog')).toContainText('Select the medal fleet');
  await page.getByRole('button', { name: /Commit medal fleet \(top 10\)/ }).click();
  await expect(page.getByText('Medal races score ×2')).toBeVisible();
  await expect(page.getByRole('link', { name: /M1/ })).toHaveCount(2);
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
  await createSeriesQuick(page, { name: 'Abandon Worlds', venue: 'Dun Laoghaire' });

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const sfSetupCard = page.getByTestId('split-fleets-card');
  await sfSetupCard.locator('#sf-fleet-count').selectOption('2');
  await sfSetupCard.getByRole('button', { name: 'Enable split fleets' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Assign qualifying fleets' }).click();
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
  await expect(page.getByText('1 of 2 qualifying races count')).toBeVisible();
});

/**
 * Publishing a split-fleet series through the ADR-011 Season + Folder dialog:
 * the championship standings and rolling fleet-assignments pages land in the
 * publication tree, the event folder lists both, and the public pages render.
 * This is the seam where the split-fleets publish output meets the
 * publication-tree model — covered end-to-end here.
 */
test('split fleets: publish lands the championship + assignments pages in the tree', async ({
  page,
  signedInEmail,
}) => {
  test.setTimeout(240_000);
  await enableFeatures(page, signedInEmail, ['split-fleets']);
  await createSeriesQuick(page, { name: 'Publish Worlds', venue: 'Dun Laoghaire' });

  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const sfSetupCard = page.getByTestId('split-fleets-card');
  await sfSetupCard.locator('#sf-fleet-count').selectOption('2');
  await sfSetupCard.getByRole('button', { name: 'Enable split fleets' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Assign qualifying fleets' }).click();
  await page.getByRole('button', { name: /Commit Round 1/ }).click();

  const q1Row = page.getByTestId('logical-race-qualifying-1');
  await q1Row.getByRole('link', { name: /Yellow · enter finishes/ }).click();
  await enterFinishes(page, [...yellowSails, ...blueSails]);
  await page.goBack();
  await expect(page.getByText('1 of 2 qualifying races count')).toBeVisible();

  // Publish through the Season + Folder dialog.
  await page.getByRole('button', { name: 'Publish…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByLabel('Season')).toHaveValue('2026');
  await dialog.getByLabel('Folder').fill('worlds-26');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();

  // Both pages get URLs under /p/{ws}/2026/worlds-26/.
  const champLink = dialog.getByRole('link', { name: /worlds-26\/standings$/ });
  await expect(champLink).toBeVisible();
  await expect(dialog.getByRole('link', { name: /worlds-26\/fleet-assignments$/ })).toBeVisible();
  const champPath = new URL((await champLink.getAttribute('href')) ?? '').pathname;

  // The public championship page renders the combined qualifying table.
  await page.goto(champPath);
  await expect(page.getByText('Publish Worlds').first()).toBeVisible();
  await expect(page.getByText(yellowSails[0]).first()).toBeVisible();

  // The event folder lists both pages; assignments shows the round's fleets.
  await page.goto(champPath.replace(/\/standings$/, ''));
  await expect(page.getByRole('heading', { name: 'Publish Worlds' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Championship' })).toBeVisible();
  await page.getByRole('link', { name: 'Fleet assignments' }).click();
  await expect(page).toHaveURL(/\/worlds-26\/fleet-assignments$/);
  await expect(page.getByText(/Qualifying round 1/)).toBeVisible();
});

/**
 * The setup wizard's championship-format opt-in (gated on `split-fleets`):
 * enabling it there makes the Split Fleets tab appear, and finishing setup
 * lands on it rather than on Competitors.
 */
test('split fleets: set up from the series wizard and land on the tab', async ({
  page,
  signedInEmail,
}) => {
  await enableFeatures(page, signedInEmail, ['split-fleets']);

  await page.goto('/series/new');
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/setup$/);
  await page.getByLabel('Name').fill('Wizard Worlds');
  await page.getByRole('button', { name: /Next: Competitors/ }).click();
  await page.getByRole('button', { name: /Next: Fleets/ }).click();

  // The format opt-in lives beside the scoring-mode choice on the Fleets step.
  await page.getByRole('checkbox', { name: /Split-fleet championship/ }).check();
  await page.locator('#sf-fleet-count').selectOption('2');
  // The same editor the Settings card shows: the format fills the fields, and
  // the configuration is restated as sailing-instruction prose to check.
  await page.getByRole('button', {
    name: /How this configuration translates to sailing instructions/,
  }).click();
  await expect(page.getByTestId('sf-si-translation')).toContainText(
    'will count for total points in the championship',
  );
  await page.getByRole('button', { name: 'Enable split fleets' }).click();
  await expect(page.getByText(/Split fleets enabled/)).toBeVisible();

  // Enabling ends setup: the fleets and scoring steps belong to the Format
  // section from here, so the wizard is three steps and finishes now.
  await expect(page.getByRole('button', { name: /3\. Format/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Next: Scoring/ })).toHaveCount(0);
  await page.getByRole('button', { name: /Finish setup/ }).click();

  await expect(page).toHaveURL(/\/split-fleets$/);
  await expect(page.getByRole('button', { name: 'Assign qualifying fleets' })).toBeVisible();
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

  await createSeriesQuick(page, { name: 'Round Trip Worlds', venue: 'Dun Laoghaire' });
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  const sfSetupCard = page.getByTestId('split-fleets-card');
  await sfSetupCard.locator('#sf-fleet-count').selectOption('2');
  await sfSetupCard.getByRole('button', { name: 'Enable split fleets' }).click();
  await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
  await page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }).click();
  await expect(
    page.getByRole('button', { name: `Add ${DEMO_COUNT} demo competitors` }),
  ).toBeHidden();
  await page.getByRole('button', { name: 'Assign qualifying fleets' }).click();
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
