/**
 * Cross-series competitor surfaces (#212/#217). The in-app reconcile UI is
 * gated behind `competitor-reconcile`; the public index + timeline behind
 * `competitor-identity`. Seeds ready-made arcs (the clustering itself is
 * unit/DB-tested) and exercises: the reconcile UI (list, long-arc flag,
 * rename, split), the public timeline, and the public index (search + filter).
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
    // The in-app reconcile surface is gated on `competitor-reconcile` (distinct
    // from the public `competitor-identity` feature).
    await enableOrgFeatures(orgId, ['competitor-reconcile']);
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

  test('public competitor index: search, year filter, deep-link to timeline', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'index');
    const { id: orgId, slug } = await createOrgWorkspace('Index Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['competitor-identity']);

    await seedCareerArc(orgId, {
      label: 'Holly Cantwell',
      entries: [
        { year: 2021, eventName: 'IODAI Connachts 2021', sailNumber: 'IRL1641' },
        { year: 2023, eventName: 'IODAI Nationals 2023', sailNumber: 'IRL1641' },
      ],
    });
    const { slug: seanSlug } = await seedCareerArc(orgId, {
      label: 'Seán Murphy',
      entries: [
        { year: 2014, eventName: 'IODAI Ulsters 2014', sailNumber: 'IRL1200' },
        { year: 2018, eventName: 'IODAI Munsters 2018', sailNumber: '1605' },
      ],
    });
    // A blank-name competitor (data debris): hidden in the default browse, but
    // still findable by its sail number.
    await seedCareerArc(orgId, {
      label: '',
      entries: [
        { year: 2016, eventName: 'IODAI Connachts 2016', sailNumber: 'IRL777' },
      ],
    });

    const res = await page.goto(`/p/${slug}/competitors`);
    expect(res?.status()).toBe(200);

    const holly = page.getByRole('link', { name: /Holly Cantwell/ });
    const sean = page.getByRole('link', { name: /Seán Murphy/ });
    const blank = page.getByText('(no name)');
    await expect(holly).toBeVisible();
    await expect(sean).toBeVisible();
    // The blank row is hidden by default and not counted in the headline.
    await expect(blank).toBeHidden();
    await expect(page.getByText('2 competitors')).toBeVisible();

    // But a sail search still surfaces it.
    await page.getByLabel('Search by name or sail number').fill('IRL777');
    await expect(blank).toBeVisible();
    await expect(holly).toBeHidden();
    await page.getByLabel('Search by name or sail number').fill('');
    await expect(blank).toBeHidden();

    // Sail-number search — "who sailed 1605?" narrows to Seán (folded over the
    // inline script, no navigation).
    await page.getByLabel('Search by name or sail number').fill('1605');
    await expect(sean).toBeVisible();
    await expect(holly).toBeHidden();

    // Name search folds accents: "sean" finds "Seán".
    await page.getByLabel('Search by name or sail number').fill('sean');
    await expect(sean).toBeVisible();
    await expect(holly).toBeHidden();

    // Year filter narrows to whoever raced that season.
    await page.getByLabel('Search by name or sail number').fill('');
    await page.getByLabel('Filter by year').selectOption('2021');
    await expect(holly).toBeVisible();
    await expect(sean).toBeHidden();

    // Each row deep-links to that competitor's timeline.
    await page.getByLabel('Filter by year').selectOption('');
    await sean.click();
    await expect(page).toHaveURL(`/p/${slug}/competitor/${seanSlug}`);
    await expect(
      page.getByRole('heading', { name: 'Seán Murphy' }),
    ).toBeVisible();

    expect(errors).toEqual([]);
  });
});
