/**
 * Fine-grained workspace roles: `scorer` (race-day operations only) and the
 * read-only `member` tier, on a shared org workspace with the
 * `fine-grained-roles` feature enabled.
 *
 * One fat test, three sessions: the owner invites a scorer through the
 * flag-gated role select; the scorer can add a race but not touch
 * competitors or settings; a plain member sees read-only everywhere; and
 * direct API writes from both bounce with 403 — the server, not the hidden
 * buttons, is the guard.
 *
 * Base Playwright (three contexts = three sessions); console errors are
 * guarded manually, as in server-mode-invitations.spec.ts.
 */
import { test, expect, type Page } from '@playwright/test';

import {
  addMemberByEmail,
  createOrgWorkspace,
  createSeriesQuick,
  enableOrgFeatures,
  latestInvitationId,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('fine-grained workspace roles', () => {
  test('scorer runs race-day ops; member is read-only; the API enforces both', async ({
    browser,
  }) => {
    const ctxAlice = await browser.newContext();
    const ctxCarol = await browser.newContext();
    const ctxBob = await browser.newContext();
    const alice: Page = await ctxAlice.newPage();
    const carol: Page = await ctxCarol.newPage();
    const bob: Page = await ctxBob.newPage();

    const errors: string[] = [];
    for (const [who, pg] of [
      ['alice', alice],
      ['carol', carol],
      ['bob', bob],
    ] as const) {
      pg.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
      pg.on('console', (m) => {
        if (m.type() === 'error') errors.push(`${who}: ${m.text()}`);
      });
    }

    try {
      const stamp = Date.now();
      const emailAlice = await signInFreshUser(alice, `roles-alice-${stamp}`);
      const emailCarol = await signInFreshUser(carol, `roles-carol-${stamp}`);
      const emailBob = await signInFreshUser(bob, `roles-bob-${stamp}`);

      // A shared org workspace with the scorer role on offer; Alice owns it,
      // Bob is a plain (read-only) member.
      const org = await createOrgWorkspace(`Roles Panel ${stamp}`);
      await enableOrgFeatures(org.id, ['fine-grained-roles']);
      await addMemberByEmail(org.id, emailAlice, 'owner');
      await addMemberByEmail(org.id, emailBob, 'member');
      await setActiveWorkspace(alice, org.id);
      await setActiveWorkspace(bob, org.id);

      // Alice creates the series everyone will look at.
      const seriesName = `Roles Series ${stamp}`;
      await createSeriesQuick(alice, { name: seriesName });

      // Alice invites Carol as a scorer — the role option is flag-gated.
      await alice.goto('/workspace');
      await alice.getByLabel('Invite a co-scorer by email').fill(emailCarol);
      await alice.getByTestId('invite-role').click();
      await alice.getByRole('option', { name: 'scorer' }).click();
      await alice.getByRole('button', { name: 'Invite', exact: true }).click();
      await expect(alice.getByTestId('pending-invitations')).toContainText(emailCarol);

      const invitationId = await latestInvitationId(emailCarol);
      await carol.goto(`/accept-invitation/${invitationId}`);
      await carol.getByTestId('accept-invitation-accept').click();
      await carol.waitForURL(/\/$/);
      await setActiveWorkspace(carol, org.id);

      // Carol (scorer): no series-creation affordances on the list…
      await expect(carol.getByText(seriesName)).toBeVisible();
      await expect(carol.getByRole('button', { name: 'Import Series' })).toHaveCount(0);
      await expect(carol.getByRole('link', { name: 'New series' })).toHaveCount(0);

      // …competitors are read-only…
      await carol.getByText(seriesName).click();
      await carol.waitForURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
      await expect(carol.getByText('0 competitors')).toBeVisible();
      await expect(carol.getByRole('button', { name: 'Add competitor' })).toHaveCount(0);

      // …but race-day operations work: she adds the first race.
      await carol.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
      await carol.getByRole('button', { name: 'Add race' }).click();
      await expect(carol.getByText('Race 1')).toBeVisible();

      // Settings is a permission notice, not the auto-saving cards.
      await carol.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
      await expect(
        carol.getByText(/doesn.t allow changing series settings/),
      ).toBeVisible();

      // Bob (member): read-only everywhere.
      await bob.goto('/');
      await expect(bob.getByText(seriesName)).toBeVisible();
      await expect(bob.getByRole('link', { name: 'New series' })).toHaveCount(0);
      await bob.getByText(seriesName).click();
      await bob.waitForURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
      const seriesId = bob.url().match(/\/series\/([0-9a-f-]{36})\//)![1];
      await expect(bob.getByRole('button', { name: 'Add competitor' })).toHaveCount(0);
      await bob.getByRole('navigation').getByRole('link', { name: 'Races' }).click();
      await expect(bob.getByText('Race 1')).toBeVisible();
      await expect(bob.getByRole('button', { name: 'Add race' })).toHaveCount(0);

      // The hidden buttons aren't the guard — direct API writes 403.
      // Bob may not publish (score)…
      const bobPublish = await bob.request.post(`/api/v1/series/${seriesId}/publish`, {
        data: {},
      });
      expect(bobPublish.status()).toBe(403);
      // …or edit competitors (manage-series, the fail-closed write default).
      const bobCompetitors = await bob.request.post(
        `/api/v1/series/${seriesId}/competitors`,
        { data: {} },
      );
      expect(bobCompetitors.status()).toBe(403);
      // Carol may not touch workspace configuration (manage-workspace).
      const carolWorkspace = await carol.request.patch('/api/v1/workspace', {
        data: { logoUrl: '' },
      });
      expect(carolWorkspace.status()).toBe(403);

      // Alice's roster shows Carol holding the scorer role.
      await alice.goto('/workspace');
      await expect(alice.getByTestId(`member-role-${emailCarol}`)).toContainText('scorer');
    } finally {
      await ctxAlice.close();
      await ctxCarol.close();
      await ctxBob.close();
      if (errors.length > 0) {
        throw new Error(`unexpected console/page errors:\n${errors.join('\n')}`);
      }
    }
  });
});
