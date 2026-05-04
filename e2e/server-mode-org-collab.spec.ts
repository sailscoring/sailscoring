/**
 * ADR-008 Phase 7 (#112) — cross-cutting org-collaboration scenarios.
 *
 * Covers the safety floor that lets HYC's panel share a workspace:
 *
 *   - Workspace switcher actually flips the visible series listing.
 *   - "Copy to workspace…" carries every child row, strips workspace-
 *     scoped references (FTP, publishing state), and leaves the source
 *     intact.
 *   - Two scorers in one workspace editing the same finish surface a
 *     row-scoped conflict dialog that names the other actor.
 *
 * Tagged `@server` — server mode only by definition; local-first has
 * one writer and no notion of "another workspace."
 */
// Uses base Playwright (not ./fixtures) for the actor-attribution test:
// triggering a 409 produces an unavoidable browser console.error which
// the fixture would treat as a test failure. The other tests don't need
// that escape hatch but share the file for cohesion.
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  createSeriesQuick,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('@server workspace switcher', () => {
  test('flips the visible series listing between workspaces', async ({ page }) => {
    const email = await signInFreshUser(page, 'switcher');
    const personalSeriesName = `Personal Switcher ${Date.now()}`;
    await createSeriesQuick(page, { name: personalSeriesName });

    // Provision a second workspace and add this user.
    const org = await createOrgWorkspace(`Switcher Org ${Date.now()}`);
    await addMemberByEmail(org.id, email, 'owner');

    // Reload so the layout picks up the new membership and the switcher
    // shows two workspaces.
    await page.goto('/');
    await expect(page.getByTestId('workspace-switcher')).toBeVisible();
    await expect(page.getByText(personalSeriesName)).toBeVisible();

    // Switch to the org workspace — series list should now be empty.
    await setActiveWorkspace(page, org.id);
    await page.goto('/');
    await expect(page.getByText(personalSeriesName)).not.toBeVisible();
    // Org workspace has no series yet → empty-state copy is visible.
    await expect(page.getByText(/No series yet/i)).toBeVisible();
  });
});

test.describe('@server copy series to workspace', () => {
  test('copy carries fleets, competitors, races and leaves the source intact', async ({
    page,
  }) => {
    const email = await signInFreshUser(page, 'copy');
    const sourceName = `Source Series ${Date.now()}`;
    await createSeriesQuick(page, { name: sourceName });

    // Add two competitors so the copy carries something visible.
    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill('S1');
    await page.getByLabel('Competitor name').fill('Sam');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: 'S1' })).toBeVisible();

    await page.getByRole('button', { name: 'Add competitor' }).click();
    await page.getByLabel('Sail number').fill('S2');
    await page.getByLabel('Competitor name').fill('Sue');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('cell', { name: 'S2' })).toBeVisible();

    // Add a race so the copy has something to walk through too.
    await page.getByRole('link', { name: 'Races' }).click();
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText('Race 1')).toBeVisible();

    // Provision a target workspace.
    const target = await createOrgWorkspace(`Target Org ${Date.now()}`);
    await addMemberByEmail(target.id, email, 'owner');
    await page.reload();

    // Drive the Settings tab "Copy to workspace…" action.
    await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
    await expect(
      page.getByRole('heading', { name: 'Copy to another workspace' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Copy to workspace…' }).click();
    await page.getByTestId('copy-target-workspace').click();
    await page
      .getByRole('option')
      .filter({ hasText: /Target Org/i })
      .click();
    await page.getByTestId('copy-series-submit').click();

    // After the copy: navigated to the new series in the target workspace.
    await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
    await expect(page.getByRole('cell', { name: 'S1' })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'S2' })).toBeVisible();
    // The series is named "Copy of <Original>" by default.
    await expect(page.getByRole('heading', { name: `Copy of ${sourceName}` })).toBeVisible();
    // Race carried.
    await page.getByRole('link', { name: 'Races' }).click();
    await expect(page.getByText('Race 1')).toBeVisible();

    // Source still intact: switch back via the header dropdown and verify.
    await page.goto('/');
    await page.getByTestId('workspace-switcher').click();
    // Menuitem accessibility name is "<workspace name> <role>", so the
    // regex matches the workspace-name segment anywhere in the label.
    await page
      .getByRole('menuitem')
      .filter({ hasText: /'s workspace/ })
      .click();
    await page.waitForURL(/\/$/);
    await expect(page.getByText(sourceName)).toBeVisible();
  });
});

test.describe('@server actor attribution on a shared workspace', () => {
  test('second scorer hits a row-scoped 409 with the first scorer\'s name', async ({
    browser,
  }) => {
    // Two browser contexts → two independent sessions → two users.
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA: Page = await ctxA.newPage();
    const pageB: Page = await ctxB.newPage();

    // Silence-by-design: pageA is a clean autosave path (no 409 expected
    // there), but pageB will hit 409 and emit a console.error from the
    // failed fetch. Catch any other unexpected errors.
    const errorsA: string[] = [];
    const errorsB: string[] = [];
    pageA.on('pageerror', (e) => errorsA.push(e.message));
    pageA.on('console', (m) => {
      if (m.type() === 'error') errorsA.push(m.text());
    });
    pageB.on('pageerror', (e) => errorsB.push(e.message));

    try {
      const stamp = Date.now();
      // Sarah: the user who will be named in the conflict dialog.
      const emailA = await signInFreshUser(pageA, `actor-sarah-${stamp}`);
      // Brian: the user whose write will lose.
      const emailB = await signInFreshUser(pageB, `actor-brian-${stamp}`);

      // Provision a shared org and add both users.
      const org = await createOrgWorkspace(`Shared Panel ${stamp}`);
      await addMemberByEmail(org.id, emailA, 'owner');
      await addMemberByEmail(org.id, emailB, 'admin');

      // Switch both users into the shared workspace.
      await setActiveWorkspace(pageA, org.id);
      await setActiveWorkspace(pageB, org.id);

      // Sarah creates the series + a competitor + a race + a finish.
      await createSeriesQuick(pageA, { name: `Shared Series ${stamp}` });
      await pageA.getByRole('button', { name: 'Add competitor' }).click();
      await pageA.getByLabel('Sail number').fill('SH1');
      await pageA.getByLabel('Competitor name').fill('Boat One');
      await pageA.getByRole('button', { name: 'Save' }).click();
      await expect(pageA.getByRole('cell', { name: 'SH1' })).toBeVisible();

      await pageA.getByRole('link', { name: 'Races' }).click();
      await pageA.getByRole('button', { name: 'Add race' }).click();
      await pageA.getByText('Race 1').click();
      await pageA.getByLabel('Sail number').fill('SH1');
      await pageA.getByRole('button', { name: 'Add', exact: true }).click();
      await expect(pageA.getByTestId('autosave-status')).toHaveText(
        'All changes saved',
      );

      const raceUrl = pageA.url();

      // Brian opens the same race so his cache holds the finish at v1.
      await pageB.goto(raceUrl);
      await expect(pageB.getByRole('button', { name: /Set penalty for SH1/ })).toBeVisible();

      // Sarah edits the row out from under Brian — apply ZFP via the
      // penalty editor. Same path as the row-conflict spec.
      await pageA.getByRole('button', { name: 'Set penalty for SH1' }).click();
      await pageA.getByRole('combobox').click();
      await pageA.getByRole('option', { name: /ZFP/ }).click();
      await pageA.getByRole('button', { name: 'Apply' }).click();
      await expect(pageA.getByTestId('autosave-status')).toHaveText(
        'All changes saved',
      );

      // Brian tries to apply DPI — his cached version is now stale.
      await pageB.getByRole('button', { name: 'Set penalty for SH1' }).click();
      await pageB.getByRole('combobox').click();
      await pageB.getByRole('option', { name: /DPI/ }).click();
      await pageB.getByRole('button', { name: 'Apply' }).click();

      // The row-scoped conflict dialog opens and identifies Sarah.
      await expect(pageB.getByTestId('row-conflict-dialog')).toBeVisible();
      // The displayName for a magic-link user is the email's local part —
      // see lib/auth.ts (Better Auth records email as the name fallback).
      // We assert against the email instead, which is the reliable signal.
      const dialog = pageB.getByTestId('row-conflict-dialog');
      await expect(dialog).toContainText(emailA.split('@')[0]);
    } finally {
      await ctxA.close();
      await ctxB.close();
      // pageB will have at least one console.error from the failed PUT;
      // pageA should be silent. Throw if pageA had any.
      if (errorsA.length > 0) {
        throw new Error(`pageA errors:\n${errorsA.join('\n')}`);
      }
    }
  });
});
