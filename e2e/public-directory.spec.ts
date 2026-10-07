import { signedInTest as test, expect } from './fixtures';
import {
  addMemberByEmail,
  createOrgWorkspace,
  createSeriesQuick,
  setActiveWorkspace,
} from './helpers';

/**
 * The public directory of club workspaces at `/p` (#670): a club that has
 * published appears with its card — description, latest event, a link into
 * its results — the page needs no sign-in, its JSON twin lists the club, and
 * unlisting from Workspace settings takes it out while its own results stay
 * up.
 *
 * The directory spans every workspace in the test database, so the spec
 * finds its own club's card by slug rather than reading the whole page.
 */
test('a club that publishes appears in the directory until it opts out', async ({
  page,
  browser,
  signedInEmail,
}) => {
  const org = await createOrgWorkspace(`Directory Club ${Date.now()}`);
  await addMemberByEmail(org.id, signedInEmail, 'owner');
  await setActiveWorkspace(page, org.id);

  // Something to publish: one boat, one race.
  await createSeriesQuick(page, { name: 'Bay Series', date: '2026-09-06' });
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('7');
  await page.getByLabel('Competitor name').fill('Aurelia');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('7');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
  await page.getByRole('link', { name: 'Standings' }).click();
  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(dialog.getByRole('link', { name: /\/p\// })).toBeVisible();

  // Listed by default; give it a line under its name.
  await page.goto('/workspace');
  const card = page.getByTestId('directory-card');
  await expect(card.getByRole('switch', { name: 'List this workspace in the directory' })).toBeChecked();
  await card.getByLabel('Description').fill('Racing on the bay');
  await card.getByRole('button', { name: 'Save' }).click();
  await expect(card.getByRole('button', { name: 'Save' })).toBeDisabled();

  // The directory needs no account.
  const anon = await browser.newContext();
  const reader = await anon.newPage();
  await reader.goto('/p');
  await expect(reader).toHaveURL(/\/p$/);
  await expect(reader.getByRole('heading', { name: 'Results scored with Sail Scoring' })).toBeVisible();
  const entry = reader.locator(`li.card[data-workspace="${org.slug}"]`);
  await expect(entry).toContainText('Racing on the bay');
  await expect(entry).toContainText('Season 2026');
  await entry.getByRole('link', { name: 'Bay Series' }).click();
  await expect(reader).toHaveURL(new RegExp(`/p/${org.slug}/bay-series$`));

  const json = await (await reader.request.get('/p/index.json')).json();
  const listed = json.workspaces.find((w: { slug: string }) => w.slug === org.slug);
  expect(listed).toMatchObject({ description: 'Racing on the bay', counts: { series: 1, races: 1, entries: 1 } });
  expect(listed.index).toMatch(new RegExp(`/p/${org.slug}/index\\.json$`));

  // Unlisting takes it out of the directory; its results stay public.
  await card.getByRole('switch', { name: 'List this workspace in the directory' }).click();
  await expect(card.getByRole('switch', { name: 'List this workspace in the directory' })).not.toBeChecked();
  await reader.goto('/p');
  await expect(reader.getByRole('heading', { name: 'Results scored with Sail Scoring' })).toBeVisible();
  await expect(reader.locator(`li.card[data-workspace="${org.slug}"]`)).toHaveCount(0);
  expect((await reader.request.get(`/p/${org.slug}`)).status()).toBe(200);
  await anon.close();
});
