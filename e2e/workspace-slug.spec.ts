/**
 * The workspace slug on Workspace settings.
 *
 * The slug is the first segment of every `/p/...` published URL and the
 * argument the operator commands take, but until now it appeared in the app
 * only inside hrefs the rankings and reconcile pages happened to build — so a
 * workspace that had published nothing gave no way to read it at all.
 *
 * The public path is a link only once something is published, because
 * `/p/{slug}` 404s on a workspace with nothing on it.
 */
import { test, expect } from './fixtures';
import {
  addMemberByEmail,
  createOrgWorkspace,
  seedPublication,
  setActiveWorkspace,
  signInFreshUser,
} from './helpers';

test.describe('workspace slug', () => {
  test('personal workspace shows its generated slug, unlinked until published', async ({
    page,
  }) => {
    await signInFreshUser(page, 'slug-personal');
    await page.goto('/workspace');

    const line = page.getByTestId('workspace-slug');
    await expect(line).toBeVisible();
    await expect(line).toContainText(/^Slug u-/);
    await expect(line).toContainText('published results will appear at');
    await expect(line.getByRole('link')).toHaveCount(0);

    const slug = (await line.locator('code').innerText()).trim();
    expect(slug).toMatch(/^u-/);
    await expect(line).toContainText(`/p/${slug}`);
  });

  test('club workspace links its public index once it has published', async ({ page }) => {
    const email = await signInFreshUser(page, 'slug-club');
    const org = await createOrgWorkspace(`Slug Club ${Date.now()}`);
    await addMemberByEmail(org.id, email, 'owner');
    await setActiveWorkspace(page, org.id);

    await page.goto('/workspace');
    const line = page.getByTestId('workspace-slug');
    await expect(line.locator('code')).toHaveText(org.slug);
    await expect(line.getByRole('link')).toHaveCount(0);

    await seedPublication(org.id, `slug-spec-${Date.now()}`);
    await page.reload();

    const link = page.getByTestId('workspace-slug').getByRole('link');
    await expect(link).toHaveAttribute('href', `/p/${org.slug}`);
    await expect(link).toContainText(`/p/${org.slug}`);
  });

  test('the slug copies to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const email = await signInFreshUser(page, 'slug-copy');
    const org = await createOrgWorkspace(`Slug Copy ${Date.now()}`);
    await addMemberByEmail(org.id, email, 'owner');
    await setActiveWorkspace(page, org.id);

    await page.goto('/workspace');
    await page.getByRole('button', { name: 'Copy workspace slug' }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toBe(org.slug);
  });
});
