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

    // Reach the reconcile surface through its nav home — the workspace tab
    // bar. The "Competitors" tab only renders when the competitor-reconcile
    // feature is on, so this exercises the gate and the location together.
    await page.goto('/');
    await page
      .getByRole('navigation')
      .getByRole('link', { name: 'Competitors' })
      .click();
    await expect(page).toHaveURL(/\/workspace\/competitors$/);

    // Anchor on a stable entry: the displayed name turns into an input value
    // during rename, so filtering the card by the name itself would stop
    // matching mid-edit.
    const aoife = page
      .getByTestId('identity-card')
      .filter({ hasText: 'IODAI Leinsters 2018' });
    // First paint after navigation: under full-suite load the page load plus
    // the arc-list roundtrip can exceed the default 5s expect timeout.
    await expect(aoife).toBeVisible({ timeout: 15_000 });
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

    // Split off the 2022 entry — it drops to 2 series, and the peeled entry
    // lands on a fresh identity of its own (not in limbo), so the automatic
    // pass can never re-fuse the split.
    await aoife
      .getByRole('listitem')
      .filter({ hasText: 'IODAI Munsters 2022' })
      .getByTitle("Split this entry off — it isn't this competitor")
      .click();
    await expect(aoife).toContainText('2 series');
    await expect(aoife).not.toContainText('IODAI Munsters 2022');
    const peeled = page
      .getByTestId('identity-card')
      .filter({ hasText: 'IODAI Munsters 2022' });
    await expect(peeled).toContainText('1 series');

    expect(errors).toEqual([]);
  });

  test('review queue: combine a suggestion, undo it, dismiss it, confirm a long arc', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'review');
    const { id: orgId } = await createOrgWorkspace('Review Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['competitor-reconcile']);
    await setActiveWorkspace(page, orgId);

    // Two "Tom Redmond" records that only a name links: different sails,
    // different clubs, no ages — the matcher's weak edge, so they queue as a
    // merge suggestion rather than auto-linking.
    await seedCareerArc(orgId, {
      label: 'Tom Redmond',
      club: 'RCYC',
      entries: [
        { year: 2019, eventName: 'IODAI Connachts 2019', sailNumber: 'IRL1111' },
        { year: 2020, eventName: 'IODAI Nationals 2020', sailNumber: 'IRL1111' },
      ],
    });
    await seedCareerArc(orgId, {
      label: 'Tom Redmond',
      club: 'HYC',
      entries: [
        { year: 2023, eventName: 'IODAI Leinsters 2023', sailNumber: 'IRL2222' },
      ],
    });
    // An implausible 12-year arc for the "Looks right" path.
    await seedCareerArc(orgId, {
      label: 'Ella Dempsey',
      club: 'NYC',
      entries: [
        { year: 2013, eventName: 'IODAI Ulsters 2013', sailNumber: '1605' },
        { year: 2025, eventName: 'IODAI Nationals 2025', sailNumber: '1605' },
      ],
    });

    await page.goto('/workspace/competitors');
    const queue = page.getByTestId('review-queue');
    await expect(queue).toBeVisible({ timeout: 15_000 });
    await expect(queue).toContainText('To review (2)');

    // Combine the Tom Redmonds — the richer record survives.
    const suggestion = page.getByTestId('merge-suggestion');
    await expect(suggestion).toContainText('Tom Redmond');
    await suggestion.getByRole('button', { name: 'Combine' }).click();

    const combined = page
      .getByTestId('identity-card')
      .filter({ hasText: 'IODAI Leinsters 2023' });
    await expect(combined).toContainText('3 series');
    await expect(page.getByTestId('merge-suggestion')).toHaveCount(0);

    // Undo brings the merged-away record straight back…
    await page
      .getByTestId('undo-merge')
      .getByRole('button', { name: 'Undo' })
      .click();
    await expect(
      page.getByTestId('identity-card').filter({ hasText: 'IODAI Leinsters 2023' }),
    ).toContainText('1 series');
    // …and the suggestion resurfaces, since nothing was decided.
    await expect(page.getByTestId('merge-suggestion')).toHaveCount(1);

    // "Different sailors" dismisses it for good.
    await page
      .getByTestId('merge-suggestion')
      .getByRole('button', { name: 'Different sailors' })
      .click();
    await expect(page.getByTestId('merge-suggestion')).toHaveCount(0);

    // Confirm the long arc: the flag and the queue entry clear.
    const longArcRow = page.getByTestId('long-arc-row');
    await expect(longArcRow).toContainText('Ella Dempsey');
    await longArcRow.getByRole('button', { name: 'Looks right' }).click();
    await expect(page.getByTestId('long-arc-row')).toHaveCount(0);
    await expect(
      page.getByTestId('identity-card').filter({ hasText: 'Ella Dempsey' }),
    ).not.toContainText('long arc');

    expect(errors).toEqual([]);
  });

  test('cluster split: peel several entries onto a new competitor in one move', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));

    const email = await signInFreshUser(page, 'clustersplit');
    const { id: orgId } = await createOrgWorkspace('Cluster Split Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['competitor-reconcile']);
    await setActiveWorkspace(page, orgId);

    await seedCareerArc(orgId, {
      label: 'Cara Long',
      club: 'WHSC',
      entries: [
        { year: 2018, eventName: 'IODAI Munsters 2018', sailNumber: 'IRL800' },
        { year: 2024, eventName: 'IODAI Ulsters 2024', sailNumber: 'IRL801' },
        { year: 2025, eventName: 'IODAI Nationals 2025', sailNumber: 'IRL801' },
      ],
    });

    await page.goto('/workspace/competitors');
    const card = page
      .getByTestId('identity-card')
      .filter({ hasText: 'IODAI Munsters 2018' });
    await expect(card).toBeVisible({ timeout: 15_000 });

    // The 2024 + 2025 entries are a different Cara — peel both in one action.
    await card.getByLabel('Select IODAI Ulsters 2024').check();
    await card.getByLabel('Select IODAI Nationals 2025').check();
    await card.getByRole('button', { name: 'Split selected' }).click();

    await expect(card).toContainText('1 series');
    const peeled = page
      .getByTestId('identity-card')
      .filter({ hasText: 'IODAI Nationals 2025' });
    await expect(peeled).toContainText('2 series');
    await expect(peeled).toContainText('IODAI Ulsters 2024');

    expect(errors).toEqual([]);
  });

  test('a failed arc-list load shows an error state, and retry recovers', async ({ page }) => {
    // No console-error assertions here: the aborted requests below log
    // resource-load errors by design.
    const email = await signInFreshUser(page, 'identity-err');
    const { id: orgId } = await createOrgWorkspace('Identity Err Club');
    await addMemberByEmail(orgId, email, 'owner');
    await enableOrgFeatures(orgId, ['competitor-reconcile']);
    await setActiveWorkspace(page, orgId);
    await seedCareerArc(orgId, {
      label: 'Aoife Murphy',
      entries: [
        { year: 2020, eventName: 'IODAI Nationals 2020', sailNumber: 'IRL1200' },
      ],
    });

    let failListRequests = true;
    await page.route('**/api/v1/competitor-identities', async (route) => {
      if (failListRequests) return route.abort();
      return route.fallback();
    });

    await page.goto('/workspace/competitors');
    // React Query retries three times with backoff before surfacing the error.
    await expect(page.getByText(/couldn.t load competitors/i)).toBeVisible({
      timeout: 15_000,
    });

    failListRequests = false;
    await page.getByRole('button', { name: 'Try again' }).click();
    // Recovery refetch: like the first paint above, the roundtrip plus render
    // can exceed the default 5s expect timeout under full-suite load.
    await expect(
      page.getByTestId('identity-card').filter({ hasText: 'IODAI Nationals 2020' }),
    ).toBeVisible({ timeout: 15_000 });
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
        { year: 2021, eventName: 'IODAI Connachts 2021', sailNumber: 'IRL1641', scored: true, published: true },
        { year: 2023, eventName: 'IODAI Nationals 2023', sailNumber: 'IRL1641', published: true },
        // Unpublished: the club's "not public", so it must not appear (#223).
        { year: 2026, eventName: 'IODAI Leinsters 2026', sailNumber: 'IRL1641' },
      ],
    });

    // The vanity slug is the canonical public URL.
    expect(competitorSlug).toMatch(/^holly-cantwell-[a-z2-9]{4}$/);
    const res = await page.goto(`/p/${slug}/competitor/${competitorSlug}`);
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Holly Cantwell' })).toBeVisible();
    // Only the two published series count; the unpublished one is absent.
    await expect(page.getByText('2 series')).toBeVisible();
    await expect(page.getByText('IODAI Connachts 2021')).toBeVisible();
    await expect(page.getByText('IODAI Nationals 2023')).toBeVisible();
    await expect(page.getByText('IODAI Leinsters 2026')).toBeHidden();
    // The scored series shows the finishing position.
    await expect(page.getByText('1st of 2')).toBeVisible();
    // Participation only — no age / birth year leaks into the public record.
    await expect(page.locator('body')).not.toContainText('age');

    // The raw UUID still resolves (back-compat for pre-slug links).
    const byId = await page.goto(`/p/${slug}/competitor/${identityId}`);
    expect(byId?.status()).toBe(200);
    await expect(page.getByRole('heading', { name: 'Holly Cantwell' })).toBeVisible();
    expect(errors).toEqual([]);

    // A competitor with nothing published isn't public — the timeline 404s
    // rather than revealing them by name (#223). Seeded here so the assertions
    // above run against the published competitor first.
    const { slug: privateSlug } = await seedCareerArc(orgId, {
      label: 'Private Sailor',
      entries: [{ year: 2022, eventName: 'IODAI Westerns 2022', sailNumber: 'IRL2222' }],
    });
    const privateRes = await page.goto(`/p/${slug}/competitor/${privateSlug}`);
    expect(privateRes?.status()).toBe(404);

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
        { year: 2021, eventName: 'IODAI Connachts 2021', sailNumber: 'IRL1641', published: true },
        // Unpublished: this year / series must not contribute to her row (#223).
        { year: 2023, eventName: 'IODAI Nationals 2023', sailNumber: 'IRL1641' },
      ],
    });
    const { slug: seanSlug } = await seedCareerArc(orgId, {
      label: 'Seán Murphy',
      entries: [
        { year: 2014, eventName: 'IODAI Ulsters 2014', sailNumber: 'IRL1200', published: true },
        { year: 2018, eventName: 'IODAI Munsters 2018', sailNumber: '1605', published: true },
      ],
    });
    // A blank-name competitor (data debris): hidden in the default browse, but
    // still findable by its sail number.
    await seedCareerArc(orgId, {
      label: '',
      entries: [
        { year: 2016, eventName: 'IODAI Connachts 2016', sailNumber: 'IRL777', published: true },
      ],
    });
    // A competitor with nothing published: absent from the public index (#223).
    await seedCareerArc(orgId, {
      label: 'Private Sailor',
      entries: [
        { year: 2019, eventName: 'IODAI Westerns 2019', sailNumber: 'IRL3333' },
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

    // The competitor with nothing published never appears (#223).
    await expect(
      page.getByRole('link', { name: /Private Sailor/ }),
    ).toHaveCount(0);
    // The year filter offers only published years — Holly's unpublished 2023
    // and Private Sailor's 2019 aren't selectable.
    const years = await page
      .getByLabel('Filter by year')
      .locator('option')
      .evaluateAll((opts) => opts.map((o) => (o as HTMLOptionElement).value));
    expect(years).not.toContain('2023');
    expect(years).not.toContain('2019');

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
