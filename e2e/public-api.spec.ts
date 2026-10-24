import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';

/**
 * E2E for the published results API (ADR-015, #685): publish a series in the
 * app, find it from the workspace index, and read it the way an app does.
 */

test('a published series is readable through the results API, found from index.json', async ({ page }) => {
  await createSeriesQuick(page, { name: 'API League', date: '2026-09-20' });
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill('31');
  await page.getByLabel('Competitor name').fill('Alice');
  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('link', { name: 'Races' }).click();
  await page.getByRole('button', { name: 'Add race' }).click();
  await page.getByText('Race 1').click();
  await page.getByLabel('Sail number').fill('31');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('link', { name: /\/p\// });
  await expect(link).toBeVisible();
  const workspaceSlug = new URL((await link.getAttribute('href')) ?? '').pathname.split('/')[2];

  const index = await (await page.request.get(`/p/${workspaceSlug}/index.json`)).json();
  const entry = index.publications.find((p: { name: string }) => p.name === 'API League');
  expect(entry.api).toMatch(/\/api\/public\/v1\/publications\/[0-9a-f-]{36}$/);
  const api = new URL(entry.api).pathname;

  // The publication says what it publishes.
  const res = await page.request.get(api);
  expect(res.status()).toBe(200);
  expect(res.headers()['access-control-allow-origin']).toBe('*');
  const publication = await res.json();
  expect(publication).toMatchObject({ name: 'API League', kind: 'series', timeZone: 'Europe/Dublin' });
  expect(Object.keys(publication.resources).sort()).toEqual(['races', 'standings']);

  // Standings as the page prints them, and the race.
  const standings = await (await page.request.get(`${api}/standings`)).json();
  const row = standings.tables[0].rows[0];
  expect(row).toMatchObject({ rank: 1, rankDisplay: '1st', competitor: { sailNumber: '31', names: ['Alice'] } });
  expect(row.scores[0].display).toBe('1.0');
  const race = await (await page.request.get(`${api}/races/1`)).json();
  expect(race.fleets[0].results[0].competitor.id).toBe(row.competitor.id);

  // An unchanged resource revalidates; what is not published is a 404.
  const standingsRes = await page.request.get(`${api}/standings`);
  const again = await page.request.get(`${api}/standings`, {
    headers: { 'if-none-match': standingsRes.headers()['etag'] },
  });
  expect(again.status()).toBe(304);
  expect((await page.request.get(`${api}/competitors`)).status()).toBe(404);
  expect((await page.request.get(`${api}/standings?x=1`)).status()).toBe(400);

  // The description of it all.
  const spec = await (await page.request.get('/api/public/v1/openapi.json')).json();
  expect(spec.openapi).toBe('3.1.0');
  expect(Object.keys(spec.paths)).toContain('/publications/{id}/standings');
});
