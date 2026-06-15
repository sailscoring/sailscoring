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

    await page.goto('/workspace/identities');

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
});
