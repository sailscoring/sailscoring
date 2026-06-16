/**
 * Cross-series competitor-identity reconcile surface (#212), gated behind the
 * `competitor-identity` feature. Seeds two ready-made arcs (the clustering
 * itself is unit/DB-tested) and exercises the reconcile UI: the list renders
 * one card per recurring competitor, the over-long arc is flagged, a rename
 * sticks, and splitting an entry drops it from the arc.
 */
import { test, expect } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  enableOrgFeatures,
  seedCareerArc,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('competitor identity reconcile', () => {
  test('lists arcs, flags long arcs, renames and splits', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'identity');
    const { id: orgId } = await createOrgWorkspace('Identity Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['competitor-identity']);
    await setActiveWorkspace(page, orgId);

    // A normal junior arc and an implausibly long one (over-merge to flag).
    await seedCareerArc(orgId, {
      label: 'Aoife Murphy',
      club: 'RCYC',
      entries: [
        { year: 2018, eventName: 'IODAI Leinsters 2018', sailNumber: 'IRL1200' },
        { year: 2020, eventName: 'IODAI Nationals 2020', sailNumber: 'IRL1200' },
        { year: 2022, eventName: 'IODAI Munsters 2022', sailNumber: 'IRL1599' },
      ],
    });
    await seedCareerArc(orgId, {
      label: 'Jonathan Dempsey',
      club: 'NYC',
      entries: [
        { year: 2013, eventName: 'IODAI Ulsters 2013', sailNumber: '1605' },
        { year: 2025, eventName: 'IODAI Nationals 2025', sailNumber: '1605' },
      ],
    });

    // Reach the reconcile surface through its nav home — the workspace
    // switcher, not Workspace settings. The "Competitors" item only renders
    // when the competitor-identity feature is on, so this exercises the gate
    // and the new location together.
    await page.goto('/');
    await page.getByTestId('workspace-switcher').click();
    await page.getByRole('menuitem', { name: 'Competitors' }).click();
    await expect(page).toHaveURL(/\/workspace\/competitors$/);

    // Anchor on a stable entry: the displayed name turns into an input value
    // during rename, so filtering the card by the name itself would stop
    // matching mid-edit.
    const aoife = page
      .getByTestId('identity-card')
      .filter({ hasText: 'IODAI Leinsters 2018' });
    await expect(aoife).toBeVisible();
    await expect(aoife).toContainText('Aoife Murphy');
    await expect(aoife).toContainText('3 series');

    // The 12-year arc is flagged for review.
    const dempsey = page
      .getByTestId('identity-card')
      .filter({ hasText: 'Jonathan Dempsey' });
    await expect(dempsey).toContainText('long arc');

    // Rename Aoife's identity.
    await aoife.getByRole('button', { name: 'Aoife Murphy' }).click();
    await aoife.getByLabel('Competitor name').fill('Aoife M Murphy');
    await aoife.getByRole('button', { name: 'Save' }).click();
    await expect(aoife).toContainText('Aoife M Murphy');
    await expect(aoife).toContainText('3 series');

    // Split off the 2022 entry — it drops to 2 series.
    await aoife
      .getByRole('listitem')
      .filter({ hasText: 'IODAI Munsters 2022' })
      .getByRole('button')
      .click();
    await expect(aoife).toContainText('2 series');
    await expect(aoife).not.toContainText('IODAI Munsters 2022');

    expect(errors).toEqual([]);
  });

  test('renders a public career-arc page, gated and age-free', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'arc');
    const { id: orgId, slug } = await createOrgWorkspace('Arc Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['competitor-identity']);

    const { identityId, slug: competitorSlug } = await seedCareerArc(orgId, {
      label: 'Holly Cantwell',
      club: 'RSGYC',
      entries: [
        // A scored series shows a finishing position; race-less ones don't.
        { year: 2021, eventName: 'IODAI Connachts 2021', sailNumber: 'IRL1641', scored: true },
        { year: 2023, eventName: 'IODAI Nationals 2023', sailNumber: 'IRL1641' },
        { year: 2026, eventName: 'IODAI Leinsters 2026', sailNumber: 'IRL1641' },
      ],
    });

    // The vanity slug is the canonical public URL.
    expect(competitorSlug).toMatch(/^holly-cantwell-[a-z2-9]{4}$/);
    const res = await page.goto(`/p/${slug}/competitor/${competitorSlug}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Holly Cantwell' })).toBeVisible();
    await expect(page.getByText('3 series')).toBeVisible();
    await expect(page.getByText('IODAI Connachts 2021')).toBeVisible();
    await expect(page.getByText('IODAI Leinsters 2026')).toBeVisible();
    // The scored series shows the finishing position.
    await expect(page.getByText('1st of 2')).toBeVisible();
    // Participation only — no age / birth year leaks into the public record.
    await expect(page.locator('body')).not.toContainText('age');

    // The raw UUID still resolves (back-compat for pre-slug links).
    const byId = await page.goto(`/p/${slug}/competitor/${identityId}`);
    expect(byId?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Holly Cantwell' })).toBeVisible();
    expect(errors).toEqual([]);

    // A non-existent ref 404s (so does any ref when the feature is off).
    // Navigating to it logs an expected resource-load error, so assert after
    // the clean-console check above.
    const missing = await page.goto(`/p/${slug}/competitor/nobody-here-9xyz`);
    expect(missing?.status()).toBe(404);
  });
});
