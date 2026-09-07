import { type Page } from '@playwright/test';
import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * E2E for reading finishes from the RaceSense player.
 *
 * The regatta document behind a player replay is read server-side and
 * narrowed before it reaches the browser; here the API route is stubbed
 * with a regatta shaped like the narrowed read, so the whole dialog — the
 * URL prompt, the division choice, the plan, the commit, the re-read — runs
 * without touching Vakaros. The fetcher itself is covered by its unit
 * tests against a stand-in for Firebase.
 *
 * The regatta mirrors the workbook fixture the export import is tested
 * with: three boats in Fleet A, an ordinary race, a race with an OCS whose
 * only record is the start's lists, and a race still on the water — which
 * is the one the read must leave alone.
 */

const REGATTA_ID = 'abc123abc123abc123ab';
const PLAYER_URL = `https://player.vakaros.com/watch/${REGATTA_ID}/Fleet%20A`;

const TZ_MS = 3_600_000;

function start(startTime: string, patch: Record<string, unknown> = {}) {
  return {
    startNumber: 1,
    startTime,
    stopReason: 'finished',
    prepFlag: 'p',
    checkedIn: ['15', '22', '254'],
    ocs: [],
    exonerated: [],
    clearedOcs: [],
    startingStats: [
      { sailNumber: '15', dtlMm: 1230 },
      { sailNumber: '22', dtlMm: -250 },
      { sailNumber: '254', dtlMm: 3010 },
    ],
    ...patch,
  };
}

function finish(sailNumber: string, finishingTime: string) {
  return { sailNumber, finishingTime, maxSpeedKts: 11.2, distanceM: 2730 };
}

const REGATTA = {
  id: REGATTA_ID,
  name: 'Spring Championship',
  startDate: '2026-04-10T23:00:00Z',
  endDate: '2026-04-11T23:00:00Z',
  modifiedTs: '2026-04-11T12:30:00Z',
  sequenceNumber: 12,
  divisions: [
    {
      name: 'Fleet A',
      fleetIndex: 1,
      boatClass: 'ILCA',
      participants: [
        { sailNumber: '15', boatName: 'Alice Pearson', bowNumber: '' },
        { sailNumber: '22', boatName: 'Bob Dickson', bowNumber: '' },
        { sailNumber: '254', boatName: 'Carol Walls', bowNumber: '' },
      ],
      races: [
        {
          raceNumber: 1, name: 'Race 1', stage: 'finished', isPractice: false,
          timezoneOffsetMs: TZ_MS, endTime: '2026-04-11T10:20:00Z', protestingBoats: [],
          starts: [start('2026-04-11T10:00:01Z')],
          finishes: [finish('15', '2026-04-11T10:14:20.450Z'), finish('22', '2026-04-11T10:15:00.000Z')],
        },
        {
          raceNumber: 2, name: 'Race 2', stage: 'finished', isPractice: false,
          timezoneOffsetMs: TZ_MS, endTime: '2026-04-11T11:20:00Z', protestingBoats: [],
          // 22 was over the line and never cleared; 15 was over and cleared.
          starts: [start('2026-04-11T11:00:01Z', { ocs: ['15', '22'], exonerated: ['15'] })],
          finishes: [finish('254', '2026-04-11T11:14:00.000Z'), finish('15', '2026-04-11T11:15:00.000Z')],
        },
        {
          raceNumber: 3, name: 'Race 3', stage: 'racing', isPractice: false,
          timezoneOffsetMs: TZ_MS, endTime: null, protestingBoats: [],
          starts: [start('2026-04-11T12:00:01Z')],
          finishes: [],
        },
      ],
    },
    {
      name: 'Fleet B',
      fleetIndex: 2,
      boatClass: 'ILCA',
      participants: [
        { sailNumber: '7', boatName: 'Dan Otter', bowNumber: '' },
        { sailNumber: '9', boatName: 'Eve Fowler', bowNumber: '' },
      ],
      races: [
        {
          raceNumber: 1, name: 'Race 1', stage: 'finished', isPractice: false,
          timezoneOffsetMs: TZ_MS, endTime: '2026-04-11T10:25:00Z', protestingBoats: [],
          starts: [start('2026-04-11T10:05:01Z', { checkedIn: ['7', '9'], startingStats: [] })],
          finishes: [finish('9', '2026-04-11T10:19:00.000Z'), finish('7', '2026-04-11T10:19:30.000Z')],
        },
      ],
    },
  ],
};

const ROUTE = '**/api/v1/racesense/regatta?*';

/** The regatta's three Fleet A boats, entered into a series with three empty
 *  races. Leaves the browser on the Races tab. */
async function seriesForTheRegatta(page: Page, name: string) {
  await createSeriesQuick(page, { name });

  for (const c of REGATTA.divisions[0].participants) {
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill(c.sailNumber);
    await page.getByLabel('Competitor name').fill(c.boatName);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: c.sailNumber, exact: true })).toBeVisible();
  }

  await page.getByRole('link', { name: 'Races' }).click();
  await expect(page.getByRole('button', { name: 'Add race' })).toBeVisible();
  for (let i = 1; i <= 3; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${i}`, { exact: true })).toBeVisible();
  }
}

async function openPlayerPrompt(page: Page) {
  await page.getByRole('button', { name: 'More RaceSense import options' }).click();
  await page.getByRole('menuitem', { name: 'Read from the RaceSense player…' }).click();
  await expect(page.getByTestId('racesense-player')).toBeVisible();
}

test.beforeEach(async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['racesense-import']);
});

test('read a regatta from the player, race by race, and read it again', async ({ page }) => {
  await page.route(ROUTE, (route) => route.fulfill({ json: REGATTA }));
  await seriesForTheRegatta(page, 'RaceSense Player');

  // ── 1. The URL prompt ────────────────────────────────────────────────────
  await openPlayerPrompt(page);
  await page.getByLabel('Player URL').fill(PLAYER_URL);
  await page.getByTestId('racesense-player-read').click();

  // ── 2. The plan, on the division the URL was watching ────────────────────
  const plan = page.getByTestId('racesense-plan');
  await expect(plan).toBeVisible();
  await expect(plan).toContainText('Spring Championship');
  await expect(page.getByTestId('racesense-division')).toHaveValue('Fleet A');

  // The read is on the record, and the race still on the water is listed
  // rather than offered.
  await expect(page.getByTestId('racesense-workbook-notes')).toContainText('Read from the RaceSense player');
  await expect(page.getByTestId('racesense-workbook-notes')).toContainText('Race 3 is still in progress');
  await expect(page.getByTestId('racesense-row-3')).toHaveCount(0);

  await expect(page.getByTestId('racesense-row-1')).toContainText('New');
  await expect(page.getByTestId('racesense-row-1')).toContainText('2 finished, 1 coded');
  await expect(page.getByTestId('racesense-row-1')).toContainText('track data for 3');
  await expect(page.getByTestId('racesense-row-2')).toContainText('New');
  await expect(page.getByTestId('racesense-confirm')).toHaveText('Import 2 races');
  await page.getByTestId('racesense-confirm').click();
  await expect(plan).toBeHidden();

  // ── 3. Race 2: the OCS survives, the cleared OCS keeps her finish ─────────
  await page.getByText('Race 2', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Switch race' })).toContainText('Race 2');
  await expect(page.getByTestId('non-finisher-22')).toContainText('OCS');
  await expect(page.getByRole('listitem').nth(0)).toContainText('254');
  await expect(page.getByRole('listitem').nth(1)).toContainText('15');

  // ── 4. Read again: the URL is remembered, and nothing has changed ─────────
  await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
  await expect(page).toHaveURL(/\/races$/);
  await openPlayerPrompt(page);
  await expect(page.getByLabel('Player URL')).toHaveValue(PLAYER_URL);
  await page.getByTestId('racesense-player-read').click();
  await expect(plan).toBeVisible();
  await expect(page.getByTestId('racesense-row-1')).toContainText('Unchanged');
  await expect(page.getByTestId('racesense-row-2')).toContainText('Unchanged');
  await expect(page.getByTestId('racesense-confirm')).toBeDisabled();

  // ── 5. Another division of the same read, without reading again ──────────
  await page.getByTestId('racesense-division').selectOption('Fleet B');
  await expect(plan).toContainText('Fleet B');
  await expect(page.getByTestId('racesense-row-1')).toContainText('Differs');
  await expect(page.getByTestId('racesense-row-1')).toContainText('2 unresolved');
  await expect(page.getByTestId('racesense-row-2')).toHaveCount(0);

  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(plan).toBeHidden();
});

test('a refused read says why, and a bad URL never leaves the browser', async ({ page }) => {
  await seriesForTheRegatta(page, 'RaceSense Player Refused');

  // ── 1. Not a player URL: caught before any request is made ───────────────
  let requests = 0;
  await page.route(ROUTE, (route) => {
    requests++;
    return route.fulfill({
      status: 502,
      json: {
        error: 'upstream',
        source: 'racesense-player',
        message: 'The RaceSense player refused the read (HTTP 403). Its data may no longer be open to read this way. Import the committee’s RaceSense export instead.',
      },
    });
  });

  await openPlayerPrompt(page);
  await page.getByLabel('Player URL').fill('https://vakaros.com/racesense');
  await page.getByTestId('racesense-player-read').click();
  await expect(page.getByTestId('racesense-player-error')).toContainText('isn’t a RaceSense player URL');
  expect(requests).toBe(0);

  // ── 2. The player refused: the server's sentence, verbatim ───────────────
  await page.getByLabel('Player URL').fill(PLAYER_URL);
  await page.getByTestId('racesense-player-read').click();
  await expect(page.getByTestId('racesense-player-error'))
    .toContainText('refused the read (HTTP 403)');
  await expect(page.getByTestId('racesense-player-error'))
    .toContainText('Import the committee’s RaceSense export instead.');
  expect(requests).toBe(1);

  // Still on the prompt, ready to try again; nothing was written.
  await expect(page.getByTestId('racesense-player')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByTestId('racesense-player')).toBeHidden();
  await expect(page.getByText('0 finishers').first()).toBeVisible();
});
