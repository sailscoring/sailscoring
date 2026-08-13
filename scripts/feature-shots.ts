/**
 * Capture feature screenshots for the marketing site and help docs, driven by
 * the inventory in docs/design/feature-inventory.md. Each shot in the registry
 * below is keyed by a slug and states the inventory row it illustrates; run
 * them all or name the ones you want:
 *
 *   pnpm feature-shots                       # every registered shot
 *   pnpm feature-shots publish-dialog redress
 *
 * Output: full-resolution PNGs to screenshots/features/ (gitignored), and
 * web-ready WebPs (2000px wide, matching the existing marketing shots) to the
 * marketing repo at ../sailscoring.ie/public/screenshots/features/. Override
 * with SCREENSHOT_OUT / WEBP_OUT.
 *
 * ── TWO MODES ──────────────────────────────────────────────────────────────
 * Local (preferred, fully reproducible):
 *
 *   pnpm db:up && pnpm db:migrate:test
 *   pnpm start:test          # in another terminal; builds, then serves
 *   pnpm feature-shots:local
 *
 * Signs a fresh user in through the local magic-link stub (the same
 * tests/.magic-links.log flow the e2e suite uses), which arrives with the
 * seeded sample series. Each run is a fresh sign-in, and magic links are
 * rate-limited to 5 per 10 minutes per IP (lib/auth.ts) — the e2e webServer
 * avoids this with E2E_DISABLE_RATE_LIMIT=1, so after a burst of runs either
 * restart `pnpm start:test` with that set, or clear the counter:
 *
 *   pnpm db:psql:test -c 'DELETE FROM rate_limit;' Because the data is disposable, local mode also does
 * one piece of prep the shots need: it actually publishes the sample series
 * (right after capturing the pristine publish dialog) so the public
 * publication-tree pages exist.
 *
 * Production (`pnpm feature-shots`) runs against the live app with the saved
 * session at scripts/.auth/app.json, shared with scripts/screenshots.ts. To
 * (re)create it:
 *
 *   npx playwright codegen --save-storage=scripts/.auth/app.json \
 *     https://app.sailscoring.ie/sign-in
 *
 * ── READ-ONLY AGAINST PRODUCTION ───────────────────────────────────────────
 * In production mode, captures may open dialogs, menus, and dropdowns, and
 * may type into a dialog to make it show a preview — but must NEVER commit
 * anything: no Save, Add, Create, Publish, or Delete. Every dialog is
 * dismissed with Escape. Mutations (like the publish prep above) must be
 * gated on LOCAL. Keep it that way when adding shots.
 *
 * ── DATA ───────────────────────────────────────────────────────────────────
 * Shots are framed against the sample series in the personal workspace
 * (WORKSPACE_NAME / SERIES_NAME to override). Note the script switches the
 * account's active workspace, like an org run of scripts/screenshots.ts does.
 * A shot whose flow can't be satisfied by the data it finds fails on its own;
 * the run continues and reports which shots need attention.
 */

import { mkdir, access, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium, type BrowserContext, type Page } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import sharp from 'sharp';

import * as schema from '../lib/db/schema';
import { type FeatureKey } from '../lib/features';
import { setOrgFeature } from './provision-org';

// ── Config ───────────────────────────────────────────────────────────────────

/** `--local`: capture from a locally running `pnpm start:test` server with a
 *  fresh throwaway user instead of the saved production session. */
const LOCAL = process.argv.includes('--local');

const BASE =
  process.env.SCREENSHOT_BASE_URL ??
  (LOCAL
    ? `http://localhost:${process.env.SS_APP_PORT ?? '3000'}`
    : 'https://app.sailscoring.ie');
const AUTH_STATE = resolve(__dirname, '.auth', 'app.json');

const PNG_OUT =
  process.env.SCREENSHOT_OUT ?? resolve(__dirname, '..', 'screenshots', 'features');
const WEBP_OUT =
  process.env.WEBP_OUT ??
  resolve(__dirname, '..', '..', 'sailscoring.ie', 'public', 'screenshots', 'features');
/** The in-app help docs embed the same captures at a lighter width (the help
 *  column is ~672px, so 1400px covers retina). */
const HELP_OUT =
  process.env.HELP_WEBP_OUT ?? resolve(__dirname, '..', 'public', 'help', 'shots');

const WORKSPACE_NAME = process.env.WORKSPACE_NAME ?? 'My Workspace';
const SERIES_NAME = process.env.SERIES_NAME ?? 'Sample Tuesday Evening League 2026';

/** Same frame as scripts/screenshots.ts: retina-crisp desktop. */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;
/** Marketing images ship at this width (see the existing five). */
const WEBP_WIDTH = 2000;

// ── Shot registry ────────────────────────────────────────────────────────────

interface ShotContext {
  page: Page;
  /** Anonymous context for public (signed-out) captures. */
  anon: BrowserContext;
  /** Resolved id of SERIES_NAME, fetched lazily on first use. */
  seriesId(): Promise<string>;
  shot(name: string, opts?: { fullPage?: boolean; page?: Page }): Promise<void>;
}

interface Shot {
  /** Matches the feature's slug-ish name in docs/design/feature-inventory.md. */
  slug: string;
  /** Inventory group, for the run report. */
  group: string;
  capture(ctx: ShotContext): Promise<void>;
}

const SHOTS: Shot[] = [
  {
    // Inventory: Series list, categories, ordering.
    slug: 'series-list',
    group: 'Running a series',
    async capture({ page, shot }) {
      await page.goto(`${BASE}/`);
      await settle(page);
      await shot('series-list.png');
    },
  },
  {
    // Inventory: Competitor list and fields.
    slug: 'competitor-list',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await shot('competitor-list.png');
    },
  },
  {
    // Inventory: Alternative sail numbers. The competitor dialog carries the
    // field; the finish-row tag needs a race entered under one, which the
    // sample series doesn't have, so this shows the entry side.
    slug: 'alternative-sail-numbers',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      await page
        .getByRole('heading', { name: 'Competitor fields' })
        .locator('..')
        .getByRole('button', { name: 'Edit ▸' })
        .click();
      await page.getByRole('checkbox', { name: 'Alternative sail numbers' }).check();
      await page.getByRole('button', { name: 'Done' }).click();
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('cell', { name: 'IRL2046' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByLabel('Alternative sail numbers').fill('IRL 99, 7');
      await settle(page);
      await shot('alternative-sail-numbers.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Sorting the competitor list. Stacks two keys so the shot
    // shows the position badges, which are the part that needs explaining.
    slug: 'competitor-sorting',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('columnheader', { name: 'Club' }).getByRole('button').click();
      await page
        .getByRole('columnheader', { name: 'Sail no.' })
        .getByRole('button')
        .click({ modifiers: ['Shift'] });
      await settle(page);
      await shot('competitor-sorting.png');
    },
  },
  {
    // Inventory: Adding races, bulk add. Fills the generator dialog to make
    // the date preview render, then Escapes without creating anything.
    slug: 'add-races-bulk',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/races`);
      await settle(page);
      await page.getByRole('button', { name: 'More add-race options' }).click();
      await page.getByRole('menuitem', { name: 'Add multiple races…' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByText('Add multiple races').waitFor();
      await dialog.getByLabel('First race date').fill('2026-05-05'); // a Tuesday
      await dialog.getByRole('spinbutton').fill('8');
      await dialog.getByText('8 races will be created:').waitFor();
      await shot('add-races-bulk.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Result codes — the grouped dropdown on a non-finisher.
    slug: 'result-codes',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      // Race 2 of the sample carries a DNF, so its non-finisher list is live.
      await openRace(page, await seriesId(), 2);
      const rows = page.getByTestId(/^non-finisher-/);
      const count = await rows.count();
      if (count === 0) throw new Error('the race has no non-finisher rows to open a code dropdown on');
      // Frame the non-finisher panel, then open the dropdown and ring it.
      await scrollTo(page.getByText('Non-finishers', { exact: false }).first());
      const combo = rows.first().getByRole('combobox');
      await combo.click();
      const listbox = page.getByRole('listbox');
      await listbox.waitFor();
      await highlight(listbox);
      await shot('result-codes.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: Redress — the RRS A9 dialog, opened from a finisher's row
    // actions and dismissed without saving.
    slug: 'redress',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      await openRace(page, await seriesId(), 1);
      await page.getByRole('button', { name: /^Row actions for / }).first().click();
      await page.getByRole('menuitem', { name: /redress/i }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await settle(page);
      await shot('redress.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: One-click publish — the dialog, not the act. Escapes without
    // publishing.
    slug: 'publish-dialog',
    group: 'Publishing',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/standings`);
      await settle(page);
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await settle(page);
      await shot('publish-dialog.png');
      if (LOCAL) {
        // Disposable local data: actually publish, so the publication-tree
        // shot below has public pages to show. NEVER in production mode.
        await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
        await dialog.locator('a[href*="/p/"]').first().waitFor({ timeout: 30_000 });
        await settle(page);
      }
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: The publication tree — the workspace's public index, found
    // via the in-app Published tab and captured signed-out, full page.
    slug: 'publication-tree',
    group: 'Publishing',
    async capture({ page, anon, shot }) {
      if (LOCAL) {
        // Give the index a second event: publish the other seeded sample too.
        await publishSeries(page, 'Sample Junior Regatta 2026');
      }
      await page.goto(`${BASE}/workspace/published`);
      await settle(page);
      const href = await page
        .locator('a[href*="/p/"]')
        .first()
        .getAttribute('href', { timeout: 10_000 });
      if (!href) throw new Error('no published page link found on /workspace/published');
      const ws = new URL(href, BASE).pathname.split('/')[2];
      const pub = await anon.newPage();
      await pub.goto(`${BASE}/p/${ws}`);
      await settle(pub);
      await shot('publication-tree.png', { fullPage: true, page: pub });
      await pub.close();
    },
  },

  // ── Batch 2 ────────────────────────────────────────────────────────────────
  // Registry order matters within a full run: the feature-toggles shot below
  // switches the batch's self-service gates on, so it (and everything gated)
  // comes after the ungated batch-1 shots, which capture the default UI.
  {
    // Inventory: Feature toggles — doubles as the prep that enables the
    // gates the rest of this batch needs.
    slug: 'feature-toggles',
    group: 'Collaboration and accounts',
    async capture({ page, shot }) {
      for (const key of BATCH_GATES) await ensureFeature(page, key);
      await page.goto(`${BASE}/workspace`);
      await settle(page);
      await page
        .getByTestId(`feature-toggle-${BATCH_GATES[0]}`)
        .scrollIntoViewIfNeeded()
        .catch(() => {});
      await shot('feature-toggles.png');
    },
  },
  {
    // Inventory: Series creation — the wizard filled in, nothing submitted.
    slug: 'series-creation',
    group: 'Running a series',
    async capture({ page, shot }) {
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole('link', { name: 'New series' }).click();
      await settle(page);
      const name = page.getByLabel('Name');
      if (await name.isVisible().catch(() => false)) await name.fill('Autumn League 2026');
      const venue = page.getByLabel('Venue');
      if (await venue.isVisible().catch(() => false)) await venue.fill('Howth Yacht Club');
      await shot('series-creation.png');
    },
  },
  {
    // Inventory: Fleets — the Settings card summarising fleets and their
    // scoring systems.
    slug: 'fleets',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      await openCardEdit(page, 'Fleets');
      await page.getByTestId('fleet-row').first().waitFor();
      await scrollTo(page.getByText('Fleets', { exact: true }).first());
      await shot('fleets.png');
    },
  },
  {
    // Inventory: Start sequences — the editor open on the sample's three
    // staggered class starts.
    slug: 'start-sequences',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      await openCardEdit(page, 'Fleets');
      // The sample carries per-race starts but no series default, so build
      // the classic three-class sequence in the editor — shown, not saved.
      const editor = page.getByText('Default start sequence').locator('..');
      for (let n = 1; n <= 3; n++) {
        await editor.getByRole('button', { name: '+ Add start group' }).click();
        await editor.getByRole('combobox').last().click();
        await page.getByRole('option', { name: `Class ${n} IRC` }).click();
        await editor.getByRole('combobox').last().click();
        await page.getByRole('option', { name: `Class ${n} ECHO` }).click();
        if (n > 1) await editor.locator('input[type="number"]').last().fill('5');
      }
      await editor.getByText(/min after Start 2/).waitFor();
      await scrollTo(page.getByText('Default start sequence', { exact: false }).first());
      await shot('start-sequences.png');
    },
  },
  {
    // Inventory: Discard rules — the Scoring card with the sample's rule.
    slug: 'discard-rules',
    group: 'Scoring correctness',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      await openCardEdit(page, 'Scoring');
      await scrollTo(page.getByText('Scoring', { exact: true }).first());
      await shot('discard-rules.png');
    },
  },
  {
    // Inventory: Sub-series — the Races tab of the demo the gate seeds.
    slug: 'sub-series',
    group: 'Running a series',
    async capture({ page, shot }) {
      await ensureFeature(page, 'sub-series');
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole('link', { name: 'Sample Club League 2026' }).click({ timeout: 30_000 });
      await page.waitForURL(/\/series\/[^/]+/);
      await page.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
      await page.getByRole('button', { name: 'New sub-series' }).waitFor();
      await settle(page);
      await shot('sub-series.png');
    },
  },
  {
    // Inventory: Follow-on series — the create dialog, cancelled unsaved.
    slug: 'follow-on-series',
    group: 'Running a series',
    async capture({ page, shot }) {
      await ensureFeature(page, 'follow-on-series');
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole('button', { name: `Actions for ${SERIES_NAME}` }).click();
      await page.getByRole('menuitem', { name: 'Create follow-on series…' }).click();
      await page.getByLabel('Name').waitFor();
      await settle(page);
      await shot('follow-on-series.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: Race conditions and management team — the record dialog
    // filled in but never saved.
    slug: 'race-management',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'race-management-metadata');
      await openRace(page, await seriesId(), 1);
      await page.getByTestId('race-metadata').click();
      const dialog = page.getByTestId('race-metadata-dialog');
      await dialog.waitFor();
      await dialog.getByLabel('Minimum wind speed in knots').fill('12');
      await dialog.getByLabel('Maximum wind speed in knots').fill('18');
      await dialog.getByTestId('race-conditions-notes').fill('Windward-leeward, ebb tide');
      await dialog.getByTestId('race-add-official').click();
      await dialog.getByLabel('Name for team member 1').fill('Jane Smith');
      await shot('race-management.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Scoring penalties — the ZFP/SCP/DPI editor on a finisher.
    slug: 'scoring-penalties',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      await openRace(page, await seriesId(), 1);
      await page.getByRole('button', { name: /^Row actions for / }).first().click();
      await page.getByRole('menuitem', { name: 'Set scoring penalty' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      // Show a penalty actually chosen, not the "No penalty" default.
      await dialog.getByRole('combobox').click();
      await page.getByRole('option', { name: /SCP/ }).click();
      await settle(page);
      await shot('scoring-penalties.png');
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Start check-in — the sample race's 45 checked-in boats.
    slug: 'start-check-in',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      await openRace(page, await seriesId(), 1);
      await page.getByRole('button', { name: /Start check-in/ }).click();
      await settle(page);
      await shot('start-check-in.png');
    },
  },
  {
    // Inventory: Finish-sheet import — the confirm step of a CSV import,
    // cancelled before it replaces anything.
    slug: 'finish-sheet-import',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'csv-finish-import');
      await openRace(page, await seriesId(), 3);
      const csv = [
        'sailNumber,finishTime,resultCode',
        'IRL2046,19:38:12,',
        'IRL7887,19:40:41,',
        'IRL3429,19:41:57,',
        'IRL32032,19:43:05,',
        'IRL2237,,DNF',
      ].join('\n');
      await page.getByTestId('finish-sheet-csv-input').setInputFiles({
        name: 'race-3-finish-sheet.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
      await page.getByRole('heading', { name: /map columns/i }).waitFor();
      await page.getByRole('button', { name: /Preview \d+ rows/i }).click();
      await page.getByRole('heading', { name: /confirm finish sheet import/i }).waitFor();
      await settle(page);
      await shot('finish-sheet-import.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: Per-fleet race exclusion — the column-header menu naming
    // the underlying race.
    slug: 'race-exclusion',
    group: 'Reading and checking',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/standings`);
      await settle(page);
      await page
        .getByRole('table')
        .first()
        .getByRole('button', { name: 'R5', exact: true })
        .click();
      await page.getByRole('menuitem', { name: 'Exclude from this fleet' }).waitFor();
      await shot('race-exclusion.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: IRC — the Update-handicaps dialog on the worldwide rating
    // list, previewed only. Needs network to fetch the list; matches are the
    // sample's realistic Irish sail numbers.
    slug: 'update-handicaps-irc',
    group: 'Rating and handicap systems',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('button', { name: 'Update handicaps' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByText(/IRC TCC/i).first().click();
      await dialog.getByRole('button', { name: 'Next' }).click();
      await dialog.getByText(/Preview:/i).waitFor({ timeout: 90_000 });
      await settle(page);
      await shot('update-handicaps-irc.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Rating transparency — a published ECHO page with the
    // calculation columns revealed.
    slug: 'rating-transparency',
    group: 'Rating and handicap systems',
    async capture({ page, anon, shot }) {
      // Find the fleet page from the public workspace index, where each event
      // row links its results tables.
      await page.goto(`${BASE}/workspace/published`);
      await settle(page);
      const anyHref = await page
        .locator('a[href*="/p/"]')
        .first()
        .getAttribute('href', { timeout: 10_000 });
      if (!anyHref) throw new Error('no published pages found');
      const ws = new URL(anyHref, BASE).pathname.split('/')[2];
      const pub = await anon.newPage();
      await pub.goto(`${BASE}/p/${ws}`);
      await settle(pub);
      const echoHref = await pub
        .locator('a[href*="class-1-echo"]')
        .first()
        .getAttribute('href', { timeout: 10_000 });
      if (!echoHref) throw new Error('no class-1-echo link on the public index');
      await pub.goto(new URL(echoHref, BASE).toString());
      await settle(pub);
      await pub.getByText('Show ECHO rating calculations').click();
      await pub.getByText('New H', { exact: true }).first().scrollIntoViewIfNeeded();
      await settle(pub);
      await shot('rating-transparency.png', { page: pub });
      await pub.close();
    },
  },
  {
    // Inventory: Provisional and final results — the finalise checklist,
    // cancelled unconfirmed.
    slug: 'results-status-final',
    group: 'Publishing',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'results-status');
      await page.goto(`${BASE}/series/${await seriesId()}/standings`);
      await settle(page);
      await page.getByRole('button', { name: 'Mark as final' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await settle(page);
      await shot('results-status-final.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Competitor spreadsheet import — the column-mapping dialog
    // with samples, cancelled before importing.
    slug: 'competitor-import',
    group: 'Data in and out',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      const csv = [
        'Sail Number,Boat,Class,Owner,Club,Fleet',
        'IRL1234,Windshift,J/109,Sarah Byrne,Howth Yacht Club,Class 2 IRC|Class 2 ECHO',
        'GBR8871R,Meridian Blue,First 40.7,Tom Nolan,Royal Cork Yacht Club,Class 1 IRC|Class 1 ECHO',
        'IRL355,Slipstream,Sigma 33,Anne Kelly,Howth Yacht Club,Class 3 IRC|Class 3 ECHO',
        'IRL9021,Tempo,X-332,Mick Dwyer,Royal Irish Yacht Club,Class 2 IRC|Class 2 ECHO',
      ].join('\n');
      await page.getByTestId('competitor-import-input').setInputFiles({
        name: 'entries.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(csv),
      });
      await page.getByRole('dialog').waitFor();
      await settle(page);
      await shot('competitor-import.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: Per-race scoring options — the dialog with a weighting and
    // discard behaviour chosen, cancelled unsaved.
    slug: 'race-scoring-options',
    group: 'Scoring correctness',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'race-scoring-options');
      await openRace(page, await seriesId(), 4);
      await page.getByTestId('race-scoring-options').click();
      const dialog = page.getByTestId('race-scoring-options-dialog');
      await dialog.waitFor();
      await dialog.getByRole('radio', { name: /Must count/ }).check();
      await dialog.getByLabel('Points multiplier').fill('2');
      await settle(page);
      await shot('race-scoring-options.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Published-page management — the workspace Published tab
    // after this run's publishes.
    slug: 'published-management',
    group: 'Publishing',
    async capture({ page, shot }) {
      await page.goto(`${BASE}/workspace/published`);
      await settle(page);
      await shot('published-management.png');
    },
  },
  {
    // Inventory: Passwordless sign-in — captured signed out.
    slug: 'sign-in',
    group: 'Collaboration and accounts',
    async capture({ anon, shot }) {
      const pub = await anon.newPage();
      await pub.goto(`${BASE}/sign-in`);
      await settle(pub);
      await shot('sign-in.png', { page: pub });
      await pub.close();
    },
  },
  // ── Batch 3 — the rest of the inventory ────────────────────────────────────
  {
    // Inventory: Standings (and the Low Point row it illustrates).
    slug: 'standings',
    group: 'Reading and checking',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/standings`);
      await settle(page);
      await shot('standings.png');
    },
  },
  {
    // Inventory: Preview — the in-app render of the exact published page.
    slug: 'preview',
    group: 'Reading and checking',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/standings`);
      await settle(page);
      await page.getByRole('button', { name: 'Preview', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByRole('heading', { name: 'Preview results' }).waitFor();
      await page.frameLocator('iframe[title="Results preview"]').locator('body').waitFor();
      await settle(page);
      await shot('preview.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Finish entry — the core entry screen, refreshed.
    slug: 'finish-entry',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      await openRace(page, await seriesId(), 1);
      await scrollTo(page.getByText('Finishing order', { exact: true }).first());
      await shot('finish-entry.png');
    },
  },
  {
    // Inventory: Keyboard-first workflow — the ? reference dialog.
    slug: 'keyboard-shortcuts',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/races`);
      await settle(page);
      await page.keyboard.press('?');
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await settle(page);
      await shot('keyboard-shortcuts.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Race-scoped fleets — the Race starts editor.
    slug: 'race-starts',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await openRace(page, await seriesId(), 1);
      await page.evaluate(() => {
        const heads = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,div,span')].filter(
          (e) => e.childElementCount === 0 && e.textContent?.trim() === 'Race starts',
        );
        for (const h of heads) {
          for (let node = h.parentElement, i = 0; node && i < 8; node = node.parentElement, i++) {
            const btn = [...node.querySelectorAll('button')].find(
              (b) => b.textContent?.trim() === 'Edit ▸',
            );
            if (btn) {
              btn.click();
              return;
            }
          }
        }
        throw new Error('Race starts Edit ▸ not found');
      });
      await settle(page);
      await shot('race-starts.png');
    },
  },
  {
    // Inventory: Bulk clean-up — Set field over a header-checkbox selection.
    slug: 'bulk-cleanup',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('checkbox', { name: 'Select all shown competitors' }).check();
      await page.getByRole('button', { name: /Set field/ }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await settle(page);
      await shot('bulk-cleanup.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: .sailscoring files — the series actions menu with Save to
    // File / Update from File / Duplicate / Copy to workspace.
    slug: 'series-actions',
    group: 'Data in and out',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('button', { name: 'Series actions' }).click();
      await page.getByRole('menuitem', { name: /Save to File/ }).waitFor();
      await shot('series-actions.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: A5.3 starting-area scoring — the Scoring card's options.
    slug: 'a53-scoring',
    group: 'Scoring correctness',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      const heading = page.getByRole('heading', { name: 'Scoring', exact: true });
      await heading.locator('..').getByRole('button', { name: 'Edit ▸' }).click();
      await scrollTo(
        page.getByLabel('Boats in the starting area (RRS A5.3 — alternative)'),
        'center',
      );
      await shot('a53-scoring.png');
    },
  },
  {
    // Inventory: Proportional discards — the One-per-so-many mode with its
    // steps-up readback, left unsaved.
    slug: 'proportional-discards',
    group: 'Scoring correctness',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'proportional-discards');
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      const heading = page.getByRole('heading', { name: 'Scoring', exact: true });
      await heading.locator('..').getByRole('button', { name: 'Edit ▸' }).click();
      await page.getByRole('radio', { name: 'One per so many races' }).check();
      await page.getByText(/steps up at/).waitFor();
      await scrollTo(page.getByText('Scoring', { exact: true }).first());
      await shot('proportional-discards.png');
    },
  },
  {
    // Inventory: ECHO — the Update-handicaps dialog on the Irish Sailing
    // national list, previewed only. Needs network.
    slug: 'update-handicaps-echo',
    group: 'Rating and handicap systems',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('button', { name: 'Update handicaps' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByText(/Irish Sailing/i).first().click();
      await dialog.getByRole('button', { name: 'Next' }).click();
      await dialog.getByText(/Preview:/i).waitFor({ timeout: 90_000 });
      await settle(page);
      await shot('update-handicaps-echo.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Scratch — a one-design fleet's per-race table on the
    // published regatta.
    slug: 'scratch-results',
    group: 'Rating and handicap systems',
    async capture({ page, anon, shot }) {
      const pub = await openPublicFleetPage(page, anon, 'optimist');
      await pub
        .getByText('Race 1', { exact: false })
        .first()
        .scrollIntoViewIfNeeded({ timeout: 10_000 })
        .catch(() => {}); // fall back to the top of the page
      await settle(pub);
      await shot('scratch-results.png', { page: pub });
      await pub.close();
    },
  },
  {
    // Inventory: Public results pages — a full fleet page, refreshed.
    slug: 'public-results-page',
    group: 'Publishing',
    async capture({ page, anon, shot }) {
      const pub = await openPublicFleetPage(page, anon, 'class-1-irc');
      await shot('public-results-page.png', { fullPage: true, page: pub });
      await pub.close();
    },
  },
  {
    // Inventory: JSON export and Open in Sail Scoring — the public footer.
    slug: 'open-in-sailscoring',
    group: 'Data in and out',
    async capture({ page, anon, shot }) {
      const pub = await openPublicFleetPage(page, anon, 'class-1-irc');
      const link = pub.getByText('Open in Sail Scoring');
      await scrollTo(link, 'center');
      await highlight(link);
      await settle(pub);
      await shot('open-in-sailscoring.png', { page: pub });
      await pub.close();
    },
  },
  {
    // Inventory: Logo library — the picker with the built-in canonical set.
    slug: 'logo-library',
    group: 'Publishing',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      await page
        .locator('h2', { hasText: 'Basic' })
        .locator('..')
        .getByRole('button', { name: /Edit/ })
        .click();
      await page.getByRole('button', { name: 'Choose Event logo from library' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await settle(page);
      await shot('logo-library.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Sailwave import — the wizard's detected preview, abandoned
    // without creating the series.
    slug: 'sailwave-import',
    group: 'Data in and out',
    async capture({ page, shot }) {
      await ensureFeature(page, 'sailwave-import');
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole('button', { name: 'Import Series' }).click();
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser'),
        page.getByTestId('import-format-sailwave').click(),
      ]);
      await chooser.setFiles(
        resolve(__dirname, '..', 'tests', 'fixtures', 'sailwave', '2026 ILCA Leinsters results.blw'),
      );
      await page.getByRole('heading', { name: 'Import from Sailwave' }).waitFor();
      await settle(page);
      await shot('sailwave-import.png');
      await page.goto(`${BASE}/`); // walk away — nothing was created
    },
  },
  {
    // Inventory: rrs.org competitor push — the import dialog's rrs section.
    slug: 'rrs-push',
    group: 'Data in and out',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'rrs-import');
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      // With the gate on, the button is plain "Import" and opens an options
      // step (spreadsheet / rrs.org) before any file is chosen.
      await page.getByRole('button', { name: 'Import', exact: true }).click();
      await page.getByRole('heading', { name: 'Import competitors' }).waitFor();
      await page.getByRole('checkbox', { name: 'rrs.org' }).check();
      await page.getByLabel('Event UUID').fill('2f6d4c8a-91b3-4e5f-8a07-c3d1e9b64a20');
      await settle(page);
      await shot('rrs-push.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: World Sailing Sailor IDs — the ID field on a competitor,
    // typed but unsaved.
    slug: 'world-sailing-id',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'world-sailing-id');
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      await page
        .getByRole('heading', { name: 'Competitor fields' })
        .locator('..')
        .getByRole('button', { name: 'Edit ▸' })
        .click();
      await page.getByRole('checkbox', { name: 'World Sailing ID' }).check();
      await page.getByRole('button', { name: 'Done' }).click();
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('cell', { name: 'IRL2046' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByLabel('World Sailing ID').fill('IRLPS7');
      await shot('world-sailing-id.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Multi-person fields — a full crew list in the dialog,
    // unsaved.
    slug: 'multi-person-fields',
    group: 'Running a series',
    async capture({ page, seriesId, shot }) {
      await ensureFeature(page, 'multi-person-fields');
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      await page
        .getByRole('heading', { name: 'Competitor fields' })
        .locator('..')
        .getByRole('button', { name: 'Edit ▸' })
        .click();
      await page.getByRole('checkbox', { name: 'Crew', exact: true }).check();
      await page.getByRole('checkbox', { name: 'Allow multiple Crew' }).check();
      await page.getByRole('button', { name: 'Done' }).click();
      await page.goto(`${BASE}/series/${await seriesId()}/competitors`);
      await settle(page);
      await page.getByRole('cell', { name: 'IRL2046' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await dialog.getByLabel('Crew 1').fill('Aoife Byrne');
      await dialog.getByRole('button', { name: 'Add crew' }).click();
      await dialog.getByLabel('Crew 2').fill('Conor Walsh');
      await dialog.getByRole('button', { name: 'Add crew' }).click();
      await dialog.getByLabel('Crew 3').fill('Niamh Doyle');
      await shot('multi-person-fields.png');
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden' }).catch(() => {});
    },
  },
  {
    // Inventory: Combined pages — define an Overall page, publish it, and
    // capture the published composite.
    slug: 'combined-pages',
    group: 'Publishing',
    async capture({ page, anon, seriesId, shot }) {
      await ensureFeature(page, 'combined-pages');
      await page.goto(`${BASE}/series/${await seriesId()}/settings`);
      await settle(page);
      const card = page.getByTestId('combined-pages-card');
      await card.getByRole('button', { name: 'Edit ▸' }).click();
      await card.getByRole('button', { name: '+ Add page' }).click();
      await card.getByRole('button', { name: 'Done' }).click();
      await page.goto(`${BASE}/series/${await seriesId()}/standings`);
      await settle(page);
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      // The series is already live at this point in a run, so the dialog is
      // in re-publish mode and the new Overall row starts unticked.
      const overall = dialog.getByRole('checkbox', { name: /Overall/ });
      if (!(await overall.isChecked())) await overall.check();
      await dialog.getByRole('button', { name: /^(Publish|Re-publish)$/ }).click();
      const overallLink = dialog.getByRole('link', { name: /\/overall$/ });
      await overallLink.waitFor({ timeout: 30_000 });
      const href = await overallLink.getAttribute('href');
      await page.keyboard.press('Escape');
      const pub = await anon.newPage();
      await pub.goto(new URL(href!, BASE).toString());
      await settle(pub);
      await shot('combined-pages.png', { fullPage: true, page: pub });
      await pub.close();
    },
  },
  {
    // Inventory: Per-division pages — give the fleet a Division, publish a
    // page sectioned by it, and capture the public per-division tables.
    // LOCAL-only: stages competitor data on the sample series.
    slug: 'per-division-pages',
    group: 'Publishing',
    async capture({ page, anon, seriesId, shot }) {
      if (!LOCAL) throw new Error('per-division-pages stages data and is local-mode only');
      await ensureFeature(page, 'combined-pages');
      const id = await seriesId();
      // Enabling the Division field seeds its first axis, so no axis editing
      // is needed — the default label is the one the shot wants.
      await page.goto(`${BASE}/series/${id}/settings`);
      await settle(page);
      // The heading's parent is the card's header row (which holds Edit), not
      // the card body the field checkboxes live in — so only Edit is scoped.
      await page
        .getByRole('heading', { name: 'Competitor fields' })
        .locator('..')
        .getByRole('button', { name: 'Edit ▸' })
        .click();
      const division = page.getByRole('checkbox', { name: 'Division' });
      if (!(await division.isChecked())) await division.check();
      // The axis editor appearing is the signal that the field is on and its
      // first axis is seeded — leaving before that loses both.
      await page.getByLabel('Axis 1 label').waitFor();
      await page.getByRole('button', { name: 'Done' }).click();

      // Divisions are awarded on merit, and the page leads with the division
      // of the leading boat — so a sample split by anything other than the
      // standings would publish "Silver, Bronze, Gold" and read as a bug.
      // Take the first fleet's standings order and cut it into tiers.
      await page.goto(`${BASE}/series/${id}/standings`);
      await settle(page);
      const standingsRows = page.locator('table').first().locator('tbody tr');
      const ranked: string[] = [];
      for (let i = 0; i < (await standingsRows.count()); i++) {
        const sail = (await standingsRows.nth(i).locator('td').nth(1).innerText()).trim();
        if (sail) ranked.push(sail);
      }
      const tier = Math.max(1, Math.round(ranked.length / 3));
      const tiers: Array<[string, string[]]> = [
        ['Gold', ranked.slice(0, tier)],
        ['Silver', ranked.slice(tier, tier * 2)],
        ['Bronze', ranked.slice(tier * 2)],
      ];

      // Row order on the competitors page is stable, so one pass builds the
      // sail-number → row-index map that every tier then selects through.
      await page.goto(`${BASE}/series/${id}/competitors`);
      await settle(page);
      const rows = page.locator('tbody tr');
      const rowIndexBySail = new Map<string, number>();
      for (let i = 0; i < (await rows.count()); i++) {
        const sail = (await rows.nth(i).locator('td').nth(1).innerText()).trim();
        if (sail) rowIndexBySail.set(sail, i);
      }

      const setDivision = async (value: string, sails: string[]) => {
        await page.goto(`${BASE}/series/${id}/competitors`);
        await settle(page);
        const boxes = page.getByRole('checkbox', { name: 'Select row' });
        for (const sail of sails) {
          const i = rowIndexBySail.get(sail);
          if (i !== undefined) await boxes.nth(i).check();
        }
        await page.getByRole('button', { name: /Set field/ }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.getByRole('combobox').first().click();
        await page.getByRole('option', { name: 'Division', exact: true }).click();
        await dialog.getByLabel('Value').fill(value);
        await dialog.getByRole('button', { name: /^Apply to/ }).click();
        await dialog.waitFor({ state: 'hidden' }).catch(() => {});
      };
      for (const [value, sails] of tiers) await setDivision(value, sails);

      await page.goto(`${BASE}/series/${id}/settings`);
      await settle(page);
      const card = page.getByTestId('combined-pages-card');
      await card.getByRole('button', { name: 'Edit ▸' }).click();
      await card.getByRole('button', { name: '+ Add page' }).click();
      const row = card.getByTestId('combined-page-row').last();
      await row.getByRole('textbox').first().fill('By division');
      await row.getByRole('textbox').first().press('Enter');
      await row.getByRole('button', { name: 'One per Division' }).click();
      await settle(page);
      // Scope it to the first fleet: the shot is about the division split, and
      // a page spanning six fleets would be ten sections of "fleet — value".
      await row.getByRole('button', { name: 'Choose fleets' }).click();
      await settle(page);
      // One click, then wait for the round-trip: `check()` re-clicks when the
      // state hasn't caught up yet, and each click toggles the member back off.
      const memberBox = row.getByRole('checkbox').first();
      await memberBox.click();
      for (let i = 0; i < 20 && !(await memberBox.isChecked()); i++) {
        await page.waitForTimeout(250);
      }
      await settle(page);
      await card.getByRole('button', { name: 'Done' }).click();

      await page.goto(`${BASE}/series/${id}/standings`);
      await settle(page);
      await page.getByRole('button', { name: 'Publish', exact: true }).click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      const byDivision = dialog.getByRole('checkbox', { name: /By division/ });
      if (!(await byDivision.isChecked())) await byDivision.check();
      await dialog.getByRole('button', { name: /^(Publish|Re-publish)$/ }).click();
      const link = dialog.getByRole('link', { name: /\/by-division$/ });
      await link.waitFor({ timeout: 30_000 });
      const href = await link.getAttribute('href');
      await page.keyboard.press('Escape');
      const pub = await anon.newPage();
      await pub.goto(new URL(href!, BASE).toString());
      await settle(pub);
      await shot('per-division-pages.png', { fullPage: true, page: pub });
      await pub.close();
    },
  },
  {
    // Inventory: Split-fleet championships — the guided tab of the worked
    // championship sample. Operator-gated, so local mode flips the gate at
    // the database like provision-org would, then imports the demo.
    slug: 'split-fleets',
    group: 'Running a series',
    async capture({ page, shot }) {
      // Flip the operator gate through provision-org's seam (which seeds the
      // worked championship demo), then bust the persisted client cache so
      // the fresh feature set — and the Split Fleets tab — actually renders.
      // Enabling only now keeps the split-fleet setup card out of every
      // other series' settings shots. (The in-app `.sailscoring` import can
      // NOT be used here: it silently drops the file's splitFleets block.)
      await dbEnableOperatorFeature('split-fleets');
      await page.evaluate(() => localStorage.clear());
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole('link', { name: 'Sample Championship 2026' }).first().click();
      await page.waitForURL(/\/series\/[^/]+/);
      await page.getByRole('navigation').getByRole('link', { name: 'Split Fleets' }).click();
      await settle(page);
      await shot('split-fleets.png');
    },
  },
  {
    // Inventory: Workspace requests — the Account page's request card.
    slug: 'workspace-request',
    group: 'Collaboration and accounts',
    async capture({ page, shot }) {
      await page.goto(`${BASE}/account`);
      await settle(page);
      await shot('workspace-request.png');
    },
  },
  {
    // Inventory: Help panel. The point of the shot is that both things are
    // on screen at once, so it captures the standings with the panel open on
    // the section covering them.
    slug: 'help-panel',
    group: 'Collaboration and accounts',
    async capture({ page, seriesId, shot }) {
      await page.goto(`${BASE}/series/${await seriesId()}/standings`);
      await settle(page);
      await page.getByRole('button', { name: 'Help' }).click();
      const panel = page.getByTestId('help-panel');
      await panel.getByText('For this page').waitFor();
      // The pinned For-this-page entry, not the same title in the index below.
      await panel.getByRole('button', { name: 'Reading the standings' }).first().click();
      await panel.getByRole('heading', { name: 'Reading the standings' }).waitFor();
      await settle(page);
      await shot('help-panel.png');
      await panel.getByRole('button', { name: 'Minimise help' }).click();
    },
  },
  {
    // Inventory: Send feedback — the dialog with its attached context.
    slug: 'send-feedback',
    group: 'Collaboration and accounts',
    async capture({ page, shot }) {
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByTestId('user-menu').click();
      await page.getByTestId('user-menu-feedback').click();
      const dialog = page.getByTestId('feedback-dialog');
      await dialog.waitFor();
      await page
        .getByTestId('feedback-message')
        .fill('The finish-entry screen is a joy — could the race switcher remember my last fleet filter?');
      await settle(page);
      await shot('send-feedback.png');
      await page.keyboard.press('Escape');
    },
  },
  {
    // Inventory: Tie-breaking — two boats crossing together, tied per A8.
    // LOCAL-only mutation: adds an empty race and two tied finishers.
    slug: 'tied-finishes',
    group: 'Entering results',
    async capture({ page, shot }) {
      if (!LOCAL) throw new Error('tied-finishes stages data and is local-mode only');
      // Use the scratch regatta: no start times, so rows commit instantly and
      // carry the tie affordance.
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole('link', { name: 'Sample Junior Regatta 2026' }).click();
      await page.waitForURL(/\/series\/[^/]+/);
      const id = new URL(page.url()).pathname.split('/')[2];
      await page.goto(`${BASE}/series/${id}/races`);
      await settle(page);
      const rows = page.getByTestId('race-row');
      const before = await rows.count();
      await page.getByRole('button', { name: 'Add race', exact: true }).click();
      for (let i = 0; i < 40 && (await rows.count()) === before; i++) {
        await page.waitForTimeout(250);
      }
      await openRace(page, id, before + 1);
      // Two boats picked from the suggestions, then tie the second.
      for (let n = 0; n < 2; n++) {
        await page.getByLabel('Sail number').fill('1');
        await page.getByRole('option').first().click();
        await page.getByRole('listitem').nth(n).waitFor();
      }
      await page.getByRole('checkbox', { name: /^Tie / }).last().check();
      await settle(page);
      await shot('tied-finishes.png');
    },
  },
  {
    // Inventory: Unknown sail numbers — an unknown crossing recorded in the
    // finishing order, ready to Resolve. LOCAL-only mutation: adds an empty
    // race on the league to type into. Late in the registry so the extra
    // race stays out of every other shot.
    slug: 'unknown-sail',
    group: 'Entering results',
    async capture({ page, seriesId, shot }) {
      if (!LOCAL) throw new Error('unknown-sail stages data and is local-mode only');
      const id = await seriesId();
      await page.goto(`${BASE}/series/${id}/races`);
      await settle(page);
      const rows = page.getByTestId('race-row');
      const before = await rows.count();
      await page.getByRole('button', { name: 'Add race', exact: true }).click();
      for (let i = 0; i < 40 && (await rows.count()) === before; i++) {
        await page.waitForTimeout(250);
      }
      await openRace(page, id, before + 1);
      // A value that prefixes registered boats without matching one exactly,
      // filed as unknown with Shift+Enter — the recorded row is the shot.
      const input = page.getByLabel('Sail number');
      await input.fill('IRL2');
      await page.getByTestId('record-unknown-option').waitFor();
      await input.press('Shift+Enter');
      const unknownRow = page
        .getByRole('listitem')
        .filter({ hasText: /not registered|Unknown/i })
        .first();
      await unknownRow.waitFor();
      await scrollTo(page.getByText('Finishing order', { exact: true }).first());
      await highlight(unknownRow);
      await shot('unknown-sail.png');
    },
  },
  {
    // Inventory: Version history — the History tab with real texture: the
    // run's publishes and edits, plus a named checkpoint staged here.
    // LOCAL-only (the checkpoint is a mutation); late so the entries exist.
    slug: 'version-history',
    group: 'Reading and checking',
    async capture({ page, seriesId, shot }) {
      const id = await seriesId();
      if (LOCAL) {
        await page.goto(`${BASE}/series/${id}/history`);
        await settle(page);
        await page.getByRole('button', { name: 'Name this version' }).click();
        const dialog = page.getByRole('dialog');
        await dialog.waitFor();
        await dialog.getByRole('textbox').fill('Before protest hearing — R4');
        await dialog.getByRole('button', { name: /Name|Save/ }).click();
        await dialog.waitFor({ state: 'hidden' }).catch(() => {});
      }
      await page.goto(`${BASE}/series/${id}/history`);
      await settle(page);
      const list = page.getByTestId('revision-list');
      await list.waitFor();
      // Expand the newest expandable version's change detail.
      await list.getByRole('button').first().click().catch(() => {});
      await settle(page);
      await shot('version-history.png');
    },
  },
  {
    // Inventory: Archive and trash — the foot of the series list with both
    // sections populated. LOCAL-only mutations, deliberately dead last.
    slug: 'archive-trash',
    group: 'Running a series',
    async capture({ page, shot }) {
      if (!LOCAL) throw new Error('archive-trash stages data and is local-mode only');
      // Archive the regatta and delete it into the Trash, then archive the
      // championship so both foot sections are populated. All from the home
      // page, mirroring the archive-series / delete-series e2e flows.
      await page.goto(`${BASE}/`);
      await settle(page);
      const regatta = 'Sample Junior Regatta 2026';
      await page.getByRole('button', { name: `Actions for ${regatta}` }).click();
      await page.getByRole('menuitem', { name: 'Archive' }).click();
      await page.getByRole('button', { name: /Archived \(1\)/ }).click();
      await page.getByRole('button', { name: `Actions for ${regatta}` }).click();
      await page.getByRole('menuitem', { name: /Delete/ }).click();
      await page.getByRole('button', { name: 'Delete series' }).click();
      await page.getByRole('button', { name: 'Actions for Sample Championship 2026' }).click();
      await page.getByRole('menuitem', { name: 'Archive' }).click();
      // Expand both sections and frame the foot of the list.
      await page.getByRole('button', { name: /Archived \(1\)/ }).click();
      await page.getByRole('button', { name: /Trash \(1\)/ }).click();
      await settle(page);
      await page.getByRole('button', { name: /Trash \(1\)/ }).scrollIntoViewIfNeeded();
      await shot('archive-trash.png');
    },
  },
];

/** Open a published fleet page (by URL substring) in the anonymous context,
 *  resolved via the workspace's public index. */
async function openPublicFleetPage(
  page: Page,
  anon: BrowserContext,
  urlPart: string,
): Promise<Page> {
  await page.goto(`${BASE}/workspace/published`);
  await settle(page);
  const anyHref = await page
    .locator('a[href*="/p/"]')
    .first()
    .getAttribute('href', { timeout: 10_000 });
  if (!anyHref) throw new Error('no published pages found');
  const ws = new URL(anyHref, BASE).pathname.split('/')[2];
  const pub = await anon.newPage();
  await pub.goto(`${BASE}/p/${ws}`);
  await settle(pub);
  const href = await pub
    .locator(`a[href*="${urlPart}"]`)
    .first()
    .getAttribute('href', { timeout: 10_000 });
  if (!href) throw new Error(`no ${urlPart} link on the public index`);
  await pub.goto(new URL(href, BASE).toString());
  await settle(pub);
  return pub;
}

/** The self-service gates batch 2 needs — switched on through the real
 *  Features card (which is itself the feature-toggles shot). */
const BATCH_GATES = [
  'sub-series',
  'follow-on-series',
  'race-management-metadata',
  'csv-finish-import',
  'race-scoring-options',
  'results-status',
] as const;

const enabledGates = new Set<string>();

/** LOCAL-only: switch an operator-managed feature (selfService: false) on for
 *  the throwaway user's personal workspace through provision-org's
 *  `setOrgFeature` — the operator seam — which also seeds the feature's demo
 *  sample (the split-fleets championship) exactly as a real provisioning
 *  would. Needs DATABASE_URL (feature-shots:local wraps the script in
 *  `local-env.sh --local-db`). */
async function dbEnableOperatorFeature(key: FeatureKey): Promise<void> {
  if (!LOCAL) throw new Error('dbEnableOperatorFeature is local-mode prep only');
  if (enabledGates.has(key)) return;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set — run via pnpm feature-shots:local');
  const sql = postgres(url, { max: 1 });
  try {
    const db = drizzle(sql, { schema });
    const [u] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, localUserEmail.toLowerCase()))
      .limit(1);
    if (!u) throw new Error(`user ${localUserEmail} not found`);
    const slug = `u-${u.id.slice(0, 16)}`;
    await setOrgFeature(db, { orgSlugOrId: slug, feature: key, enabled: true });
  } finally {
    await sql.end();
  }
  enabledGates.add(key);
}

/** Switch a self-service feature on via the Workspace-settings Features card.
 *  Idempotent; no-op when the toggle is already on (e.g. production mode with
 *  a pre-configured workspace). */
async function ensureFeature(page: Page, key: string): Promise<void> {
  if (enabledGates.has(key)) return;
  await page.goto(`${BASE}/workspace`);
  await settle(page);
  const toggle = page.getByTestId(`feature-toggle-${key}`);
  await toggle.waitFor({ timeout: 15_000 });
  if (!(await toggle.isChecked())) {
    await toggle.click();
    // Checked = the PATCH resolved (and any demo sample was seeded).
    for (let i = 0; i < 40 && !(await toggle.isChecked()); i++) {
      await page.waitForTimeout(250);
    }
  }
  enabledGates.add(key);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Settle: network quiet, then a beat for fonts/animations. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

/** Scroll the shot's subject to lead the frame — 'start' pins it to the top
 *  of the viewport, 'center' frames it with context around. */
async function scrollTo(
  locator: ReturnType<Page['locator']>,
  block: 'start' | 'center' = 'start',
) {
  await locator.evaluate(
    (el, b) => el.scrollIntoView({ block: b as ScrollLogicalPosition, behavior: 'instant' }),
    block,
  );
  await locator.page().waitForTimeout(300);
}

/** Draw a presentation ring around the shot's subject — for features whose
 *  UI is a small affordance that would otherwise be easy to miss. */
async function highlight(locator: ReturnType<Page['locator']>) {
  const box = await locator.boundingBox();
  if (!box) return;
  await locator.page().evaluate(({ x, y, width, height }) => {
    const ring = document.createElement('div');
    // Fixed positioning: boundingBox is viewport-relative, and the shot is
    // taken with no further scrolling, so no document-coordinate math.
    Object.assign(ring.style, {
      position: 'fixed',
      left: `${x - 10}px`,
      top: `${y - 10}px`,
      width: `${width + 20}px`,
      height: `${height + 20}px`,
      border: '3px solid #fb3a3b',
      borderRadius: '10px',
      boxShadow: '0 0 0 6px rgba(251, 58, 59, 0.15)',
      pointerEvents: 'none',
      zIndex: '99999',
    });
    document.body.append(ring);
  }, box);
}

/** Open a settings card's inline editor by its heading text — every card has
 *  an identical "Edit ▸", so walk up from the heading to its card. */
async function openCardEdit(page: Page, heading: string) {
  await page.evaluate((title) => {
    const heads = [...document.querySelectorAll<HTMLElement>('h1,h2,h3,h4,div,span')].filter(
      (e) => e.childElementCount === 0 && e.textContent?.trim() === title,
    );
    for (const h of heads) {
      for (let node = h.parentElement, i = 0; node && i < 8; node = node.parentElement, i++) {
        const btn = [...node.querySelectorAll('button')].find(
          (b) => b.textContent?.trim() === 'Edit ▸',
        );
        if (btn) {
          btn.click();
          return;
        }
      }
    }
    throw new Error(`${title} card Edit ▸ not found`);
  }, heading);
  await settle(page);
}

/** A race's finish-entry screen — shared by the result-entry shots. */
async function openRace(page: Page, seriesId: string, raceNumber: number) {
  await page.goto(`${BASE}/series/${seriesId}/races`);
  await settle(page);
  await page.getByText(new RegExp(`^Race ${raceNumber}\\b`)).first().click();
  await page.waitForURL(/\/races\/[^/]+/);
  const finishTab = page.getByRole('button', { name: 'Finish entry' });
  if (await finishTab.isVisible().catch(() => false)) await finishTab.click();
  await settle(page);
}

/** LOCAL-mode prep only: publish a series by name from its Standings tab.
 *  Mutates data, so it must never be called in production mode. */
async function publishSeries(page: Page, name: string) {
  if (!LOCAL) throw new Error('publishSeries is local-mode prep only');
  await page.goto(`${BASE}/`);
  await settle(page);
  await page.getByRole('link', { name }).first().click();
  await page.waitForURL(/\/series\/[^/]+/);
  const seriesId = new URL(page.url()).pathname.split('/')[2];
  await page.goto(`${BASE}/series/${seriesId}/standings`);
  await settle(page);
  await page.getByRole('button', { name: 'Publish', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await dialog.locator('a[href*="/p/"]').first().waitFor({ timeout: 30_000 });
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' }).catch(() => {});
}

/** Local sign-in: the same magic-link flow the e2e suite drives, via the
 *  dev/CI Resend stub's TSV log (see e2e/helpers.ts readLatestMagicLink). */
const MAGIC_LINKS_LOG = resolve(process.cwd(), 'tests', '.magic-links.log');

/** The throwaway local user's email, for DB-side prep (operator gates). */
let localUserEmail = '';

async function signInLocalUser(page: Page): Promise<void> {
  const email = `shots-${Date.now()}-${Math.floor(Math.random() * 1e9)}@sailscoring.test`;
  localUserEmail = email;
  await page.goto(`${BASE}/sign-in`);
  await page.getByLabel('Email').fill(email);
  await page.getByRole('button', { name: 'Send sign-in link' }).click();
  let link: string | undefined;
  for (let attempt = 0; attempt < 60 && !link; attempt++) {
    const content = await readFile(MAGIC_LINKS_LOG, 'utf8').catch(() => '');
    for (const line of content.trim().split('\n').reverse()) {
      const [, forEmail, url] = line.split('\t');
      if (forEmail === email && url) {
        link = url;
        break;
      }
    }
    if (!link) await page.waitForTimeout(250);
  }
  if (!link) throw new Error(`no magic link appeared for ${email} in ${MAGIC_LINKS_LOG}`);
  await page.goto(link);
  // First-time sign-ups land on the welcome (name) step. Give the throwaway
  // user a presentable display name — it's what activity and history lines
  // show in place of the shots-<timestamp> email.
  if (new URL(page.url()).pathname === '/welcome') {
    await page.getByTestId('welcome-name').fill('Sam Scorer');
    await page.getByTestId('welcome-save').click();
  }
  await page.waitForURL(/\/$/);
  await settle(page);
}

/** Same switcher walk as scripts/screenshots.ts. */
async function switchWorkspace(page: Page, name: string): Promise<void> {
  await page.goto(`${BASE}/`);
  await settle(page);
  const switcher = page.getByTestId('workspace-switcher');
  if (!(await switcher.isVisible().catch(() => false))) {
    throw new Error(
      `not signed in — refresh the session:\n` +
        `  npx playwright codegen --save-storage=${AUTH_STATE} ${BASE}/sign-in`,
    );
  }
  if ((await switcher.textContent())?.includes(name)) return;
  await switcher.click();
  await page.getByRole('menuitem').filter({ hasText: name }).first().click();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    if ((await switcher.textContent().catch(() => null))?.includes(name)) {
      await settle(page);
      return;
    }
  }
  throw new Error(`workspace switch to "${name}" did not take effect`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const requested = process.argv.slice(2).filter((a) => a !== '--local');
  const unknown = requested.filter((s) => !SHOTS.some((shot) => shot.slug === s));
  if (unknown.length) {
    console.error(`Unknown shot(s): ${unknown.join(', ')}`);
    console.error(`Registered: ${SHOTS.map((s) => s.slug).join(', ')}`);
    process.exit(1);
  }
  const toRun = requested.length ? SHOTS.filter((s) => requested.includes(s.slug)) : SHOTS;

  if (!LOCAL && !(await exists(AUTH_STATE))) {
    console.error(
      `No session at ${AUTH_STATE}.\n` +
        `Create one:  npx playwright codegen --save-storage=${AUTH_STATE} ${BASE}/sign-in`,
    );
    process.exit(1);
  }

  await mkdir(PNG_OUT, { recursive: true });
  await mkdir(WEBP_OUT, { recursive: true });
  await mkdir(HELP_OUT, { recursive: true });
  console.log(`Base:  ${BASE}`);
  console.log(`PNG:   ${PNG_OUT}`);
  console.log(`WebP:  ${WEBP_OUT}`);

  const browser = await chromium.launch();
  const failures: Array<[string, string]> = [];
  try {
    const ctx = await browser.newContext({
      ...(LOCAL ? {} : { storageState: AUTH_STATE }),
      viewport: VIEWPORT,
      deviceScaleFactor: SCALE,
    });
    const anon = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
    const page = await ctx.newPage();

    if (LOCAL) {
      console.log('\nSigning in a fresh local user (seeded sample series)');
      await signInLocalUser(page);
    } else {
      console.log(`\nSwitching workspace → "${WORKSPACE_NAME}"`);
      await switchWorkspace(page, WORKSPACE_NAME);
    }

    // Resolve the series id once, on first use.
    let cachedSeriesId: string | null = null;
    const seriesId = async () => {
      if (cachedSeriesId) return cachedSeriesId;
      await page.goto(`${BASE}/`);
      await settle(page);
      await page.getByRole('link', { name: SERIES_NAME }).first().click();
      await page.waitForURL(/\/series\/[^/]+/);
      cachedSeriesId = new URL(page.url()).pathname.split('/')[2];
      return cachedSeriesId;
    };

    const shotCtx: ShotContext = {
      page,
      anon,
      seriesId,
      shot: async (name, opts = {}) => {
        const target = opts.page ?? page;
        if (LOCAL) {
          // Presentation only, applied at the moment of capture: the
          // throwaway session shouldn't show in marketing shots. Hide the
          // stealth-beta banner and give the user menu a neutral address in
          // place of the shots-<timestamp> email.
          await target.evaluate(() => {
            for (const el of document.querySelectorAll<HTMLElement>(
              '[data-testid="stealth-beta-banner"]',
            )) {
              el.style.display = 'none';
            }
            for (const span of document.querySelectorAll('[data-testid="user-menu"] span')) {
              if (/@sailscoring\.test/.test(span.textContent ?? '')) {
                span.textContent = 'scorer@example.ie';
              }
            }
            // The throwaway user's personal-workspace slug (u-<userid>) reads
            // as noise in public URLs; a real club shows its own slug there.
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) {
              const text = n.textContent;
              if (!text) continue;
              if (/\/p\/u-[A-Za-z0-9]+/.test(text) || /@sailscoring\.test/.test(text)) {
                n.textContent = text
                  .replace(/\/p\/u-[A-Za-z0-9]+/g, '/p/my-club')
                  .replace(/[\w.-]+@sailscoring\.test/g, 'scorer@example.ie');
              }
            }
          });
        }
        const pngPath = join(PNG_OUT, name);
        await target.screenshot({ path: pngPath, fullPage: opts.fullPage ?? false });
        const webpName = name.replace(/\.png$/, '.webp');
        await sharp(pngPath)
          .resize({ width: WEBP_WIDTH })
          .webp({ quality: 82 })
          .toFile(join(WEBP_OUT, webpName));
        await sharp(pngPath)
          .resize({ width: 1400 })
          .webp({ quality: 78 })
          .toFile(join(HELP_OUT, webpName));
        console.log(`  ✓ ${name}`);
      },
    };

    for (const shot of toRun) {
      console.log(`\n[${shot.group}] ${shot.slug}`);
      try {
        await shot.capture(shotCtx);
      } catch (err) {
        const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
        failures.push([shot.slug, msg]);
        console.error(`  ✗ ${shot.slug}: ${msg}`);
        // Freeze the failure state for diagnosis, then recover for the next
        // shot by dismissing any open overlay.
        await page
          .screenshot({ path: join(PNG_OUT, `_fail-${shot.slug}.png`) })
          .catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
      }
    }

    await anon.close();
    await ctx.close();
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} shot(s) failed:`);
    for (const [slug, msg] of failures) console.error(`  ${slug}: ${msg}`);
    process.exit(1);
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
