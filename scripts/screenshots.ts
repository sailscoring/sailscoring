/**
 * Capture marketing screenshots from the LIVE app for the sponsorship
 * prospectus (governance repo). Six shots tell the scoring → publishing story:
 *
 *   In-app (authenticated):
 *     app-standings.png      the scorer's standings view
 *     app-preview.png        the in-app Preview modal (publish handoff)
 *     app-finish-entry.png   live finish entry for a race
 *   Public (no auth — what spectators see, where the sponsor burgee lives):
 *     public-index.png       /p/{ws}            the workspace listing
 *     public-series.png      /p/{ws}/{series}   a series' fleet listing
 *     public-standings.png   /p/{ws}/{series}/{fleet}  one fleet's results
 *
 * ── READ-ONLY ──────────────────────────────────────────────────────────────
 * This script ONLY navigates and screenshots. It never fills a field, clicks
 * Save / Add / Publish / Delete, or otherwise mutates data. It runs against
 * PRODUCTION with your own session — the finish-entry page edits a real club's
 * race results. Do not add any interaction that writes. The only clicks are
 * navigation (series/tab links) and opening the read-only Preview modal.
 *
 * ── AUTH ───────────────────────────────────────────────────────────────────
 * Reuses a saved Better Auth session (cookie). One-off, sign in by hand once:
 *
 *   npx playwright codegen --save-storage=scripts/.auth/app.json \
 *     https://app.sailscoring.ie/sign-in
 *
 * Sign in via the magic link in the opened browser, then close it — the
 * session cookie is written to scripts/.auth/app.json (gitignored). Re-run
 * this when the session lapses. The public shots need no auth.
 *
 * ── RUN ────────────────────────────────────────────────────────────────────
 *   pnpm screenshots                      # generic: sample series, your
 *                                         # personal "My Workspace", → generic/
 *
 * Org run (e.g. HYC) — switch workspace, pick one of its series, write to a
 * gitignored per-org folder, and point the public shots at its listing:
 *   WORKSPACE_NAME='Howth Yacht Club' \
 *   SERIES_NAME='HYC Autumn League 2025' \
 *   SCREENSHOT_OUT="$PWD/../governance/sponsorship/screenshots/hyc" \
 *   PUBLIC_INDEX_URL='https://app.sailscoring.ie/p/hyc' \
 *   PUBLIC_SERIES_URL='https://app.sailscoring.ie/p/hyc/autumn-league' \
 *   PUBLIC_STANDINGS_URL='https://app.sailscoring.ie/p/hyc/autumn-league/class-1-irc' \
 *   pnpm screenshots
 */

import { mkdir, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { chromium, type Page } from '@playwright/test';

// ── Config ───────────────────────────────────────────────────────────────────

const BASE = process.env.SCREENSHOT_BASE_URL ?? 'https://app.sailscoring.ie';
const AUTH_STATE = resolve(__dirname, '.auth', 'app.json');

/** Generic shots ship in the public introduction leaflet, so they go in the
 *  committed governance folder (sibling checkout, like introduction/build.js
 *  → branding). */
const OUT_DIR =
  process.env.SCREENSHOT_OUT ??
  resolve(__dirname, '..', '..', 'governance', 'sponsorship', 'screenshots', 'generic');

/** Switch into this workspace before capturing, matched by the name shown in
 *  the header switcher (e.g. "Howth Yacht Club"). Leave unset to stay in the
 *  account's currently-active workspace — right for the generic sample shots,
 *  which live in your personal "My Workspace". Set it for an org run so the
 *  home page lists that org's series rather than your personal ones. */
const WORKSPACE_NAME = process.env.WORKSPACE_NAME ?? '';

/** The in-app series to showcase, matched by its name on the home page. The
 *  club-racing sample (IRC/ECHO, real boats) reads better than the dinghy
 *  regatta for a club/class prospectus. For an org run, set this to one of that
 *  org's own series. */
const SERIES_NAME = process.env.SERIES_NAME ?? 'Sample Tuesday Evening League 2026';

/** Public published listing URLs (no auth). The sample series must be published
 *  for these to exist. Leave blank to skip the public shots and capture only
 *  the in-app ones. Find them from your published workspace listing, or the
 *  series' Publish dialog.
 *    workspaceIndex: /p/{ws}
 *    seriesIndex:    /p/{ws}/{series}
 *    fleetStandings: /p/{ws}/{series}/{fleet|standings} */
const PUBLIC = {
  workspaceIndex: process.env.PUBLIC_INDEX_URL ?? '',
  seriesIndex: process.env.PUBLIC_SERIES_URL ?? '',
  fleetStandings: process.env.PUBLIC_STANDINGS_URL ?? '',
};

/** Retina-crisp, generous desktop frame. */
const VIEWPORT = { width: 1440, height: 900 };
const SCALE = 2;

// ── Helpers ──────────────────────────────────────────────────────────────────

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function shot(page: Page, name: string, opts: { fullPage?: boolean } = {}) {
  const path = join(OUT_DIR, name);
  await page.screenshot({ path, fullPage: opts.fullPage ?? false });
  console.log(`  ✓ ${name}`);
}

/** Settle: network quiet, then a beat for fonts/animations. */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(400);
}

/** Flip the active workspace via the header switcher — the same path the app
 *  uses (Better Auth setActiveOrganization, then a hard reload to '/'). No-op
 *  if already in the target workspace. The switcher trigger and items are the
 *  app's own test ids; items are matched by the workspace's display name. */
async function switchWorkspace(page: Page, name: string): Promise<void> {
  await page.goto(`${BASE}/`);
  await settle(page);
  const switcher = page.getByTestId('workspace-switcher');
  if ((await switcher.textContent())?.includes(name)) return; // already active
  await switcher.click();
  await page.getByRole('menuitem').filter({ hasText: name }).first().click();
  // The switch hard-reloads to '/'; wait until the trigger shows the new name.
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    if ((await switcher.textContent().catch(() => null))?.includes(name)) {
      await settle(page);
      return;
    }
  }
  throw new Error(`workspace switch to "${name}" did not take effect`);
}

// ── Capture ──────────────────────────────────────────────────────────────────

async function captureInApp(page: Page): Promise<void> {
  if (WORKSPACE_NAME) {
    console.log(`\nSwitching workspace → "${WORKSPACE_NAME}"`);
    await switchWorkspace(page, WORKSPACE_NAME);
  }

  console.log(`\nIn-app shots — "${SERIES_NAME}"`);

  // Home → open the series. Capture the series id from the URL so we can
  // address tabs directly and keep navigation unambiguous.
  await page.goto(`${BASE}/`);
  await settle(page);
  await page.getByRole('link', { name: SERIES_NAME }).first().click();
  await page.waitForURL(/\/series\/[^/]+/);
  const seriesId = new URL(page.url()).pathname.split('/')[2];

  // 1. Standings.
  await page.goto(`${BASE}/series/${seriesId}/standings`);
  await settle(page);
  await shot(page, 'app-standings.png');

  // 2. Preview modal (read-only iframe of the rendered results). Opening it
  //    mutates nothing; we close it with Escape afterwards.
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Preview results' }).waitFor();
  await page.frameLocator('iframe[title="Results preview"]').locator('body').waitFor();
  await settle(page);
  await shot(page, 'app-preview.png');
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' }).catch(() => {});

  // 3. Finish entry for the first race. READ-ONLY: open and screenshot only.
  await page.goto(`${BASE}/series/${seriesId}/races`);
  await settle(page);
  await page.getByText(/^Race 1\b/).first().click();
  await page.waitForURL(/\/races\/[^/]+/);
  // Some scoring modes land on check-in with a "Finish entry" tab/button.
  const finishTab = page.getByRole('button', { name: 'Finish entry' });
  if (await finishTab.isVisible().catch(() => false)) await finishTab.click();
  await settle(page);
  await shot(page, 'app-finish-entry.png');
}

async function capturePublic(page: Page): Promise<void> {
  const jobs: Array<[string, string]> = [
    [PUBLIC.workspaceIndex, 'public-index.png'],
    [PUBLIC.seriesIndex, 'public-series.png'],
    [PUBLIC.fleetStandings, 'public-standings.png'],
  ];
  if (jobs.every(([url]) => !url)) {
    console.log('\nPublic shots — skipped (no PUBLIC_*_URL set).');
    return;
  }
  console.log('\nPublic shots');
  for (const [url, name] of jobs) {
    if (!url) continue;
    await page.goto(url);
    await settle(page);
    // The whole results table, not just above the fold.
    await shot(page, name, { fullPage: true });
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Base:   ${BASE}`);
  console.log(`Output: ${OUT_DIR}`);

  const browser = await chromium.launch();
  try {
    // In-app context uses the saved session; public context is anonymous.
    const haveAuth = await exists(AUTH_STATE);
    if (haveAuth) {
      const ctx = await browser.newContext({
        storageState: AUTH_STATE,
        viewport: VIEWPORT,
        deviceScaleFactor: SCALE,
      });
      const page = await ctx.newPage();
      await captureInApp(page);
      await ctx.close();
    } else {
      console.log(
        `\nIn-app shots — skipped (no session at ${AUTH_STATE}).\n` +
          `  Create one:  npx playwright codegen --save-storage=${AUTH_STATE} ${BASE}/sign-in`,
      );
    }

    const pub = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE });
    await capturePublic(await pub.newPage());
    await pub.close();
  } finally {
    await browser.close();
  }
  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
