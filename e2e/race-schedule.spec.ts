import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

/**
 * The published race schedule (ADR-014, Decision 4; #692). Its point is the
 * window before the season: the races are generated, nobody has entered yet,
 * and the schedule can still go up — as a page, and as the published results
 * API's schedule resource.
 */

test('the race schedule publishes before any entry, as a page and through the API', async ({ page, signedInEmail }) => {
  await enableFeatures(page, signedInEmail, ['schedule-page']);
  await createSeriesQuick(page, { name: 'Winter League 2026', date: '2026-11-01' });

  // Two races, and deliberately no competitors.
  await page.getByRole('link', { name: 'Races' }).click();
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Add race' }).click();
    await expect(page.getByText(`Race ${i + 1}`)).toBeVisible();
  }

  await page.getByRole('button', { name: 'Publish' }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish results' });
  await expect(dialog.getByLabel('URL for Schedule')).toHaveValue('schedule');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.locator('a[href$="/schedule"]').first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;

  const pub = await page.request.get(new URL(href).pathname);
  expect(pub.status()).toBe(200);
  const html = await pub.text();
  expect(html).toContain('Schedule');
  expect(html).toContain('>R1<');
  expect(html).toContain('>R2<');

  // The index lists the page by its kind, and the API serves its races.
  const workspaceSlug = new URL(href).pathname.split('/')[2];
  const index = await (await page.request.get(`/p/${workspaceSlug}/index.json`)).json();
  const entry = index.publications.find((p: { name: string }) => p.name === 'Winter League 2026');
  expect(entry.pages).toEqual([expect.objectContaining({ kind: 'schedule', label: 'Schedule' })]);
  const schedule = await (await page.request.get(`${new URL(entry.api).pathname}/schedule`)).json();
  expect(schedule.races.map((r: { race: number; status: string }) => [r.race, r.status])).toEqual([
    [1, 'scheduled'],
    [2, 'scheduled'],
  ]);
});
