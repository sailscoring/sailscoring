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
import sharp from 'sharp';

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
      const combo = rows.first().getByRole('combobox');
      await combo.scrollIntoViewIfNeeded();
      await combo.click();
      await page.getByRole('listbox').waitFor();
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
];

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

async function signInLocalUser(page: Page): Promise<void> {
  const email = `shots-${Date.now()}-${Math.floor(Math.random() * 1e9)}@sailscoring.test`;
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
  // First-time sign-ups land on the welcome (name) step.
  if (new URL(page.url()).pathname === '/welcome') {
    await page.getByTestId('welcome-skip').click();
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
              if (n.textContent && /\/p\/u-[A-Za-z0-9]+/.test(n.textContent)) {
                n.textContent = n.textContent.replace(/\/p\/u-[A-Za-z0-9]+/g, '/p/my-club');
              }
            }
          });
        }
        const pngPath = join(PNG_OUT, name);
        await target.screenshot({ path: pngPath, fullPage: opts.fullPage ?? false });
        const webpPath = join(WEBP_OUT, name.replace(/\.png$/, '.webp'));
        await sharp(pngPath).resize({ width: WEBP_WIDTH }).webp({ quality: 82 }).toFile(webpPath);
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
        // Recover for the next shot: dismiss any open overlay.
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
