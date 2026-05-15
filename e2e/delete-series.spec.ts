import { test, expect } from './fixtures';
import { createSeriesQuick } from './helpers';
import type { Page } from '@playwright/test';

const DB_NAME = 'sailscoring-v1';

/**
 * Seed one row in every child table for the given series, using deterministic
 * ids derived from `tag` so the test can later count rows by fixed raceId after
 * the series (and its races) are gone.
 */
async function seedChildren(page: Page, seriesId: string, tag: string): Promise<void> {
  await page.evaluate(async ({ seriesId, tag, dbName }) => {
    const raceId = `race-${tag}`;
    const fleetId = `fleet-${tag}`;
    const competitorId = `comp-${tag}`;

    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const stores = ['fleets', 'competitors', 'races', 'finishes', 'raceStarts', 'tcfHistory'];
        const tx = db.transaction(stores, 'readwrite');
        tx.objectStore('fleets').put({
          id: fleetId,
          seriesId,
          name: `Fleet ${tag}`,
          displayOrder: 0,
          scoringSystem: 'scratch',
        });
        tx.objectStore('competitors').put({
          id: competitorId,
          seriesId,
          fleetIds: [fleetId],
          sailNumber: `S-${tag}`,
          name: `Helm ${tag}`,
          club: '',
          createdAt: Date.now(),
        });
        tx.objectStore('races').put({
          id: raceId,
          seriesId,
          raceNumber: 1,
          date: '2026-04-22',
          createdAt: Date.now(),
        });
        tx.objectStore('finishes').put({
          id: `finish-${tag}`,
          raceId,
          competitorId,
          position: 1,
        });
        tx.objectStore('raceStarts').put({
          id: `start-${tag}`,
          raceId,
          fleetIds: [fleetId],
          startTime: '14:00:00',
        });
        tx.objectStore('tcfHistory').put({
          id: `tcf-${tag}`,
          raceId,
          competitorId,
          fleetId,
          startingTcf: 1.0,
          correctedTcf: 1.0,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { seriesId, tag, dbName: DB_NAME });
}

type ChildCounts = {
  fleets: number;
  competitors: number;
  races: number;
  finishes: number;
  raceStarts: number;
  tcfHistory: number;
};

/**
 * Count rows that belong to the given series (directly or via the seeded raceId).
 * Uses the fixed raceId from `seedChildren` because races are deleted by the
 * cascade and we can't look them up by seriesId anymore.
 */
async function countChildren(page: Page, seriesId: string, tag: string): Promise<ChildCounts> {
  return page.evaluate(async ({ seriesId, tag, dbName }) => {
    const raceId = `race-${tag}`;

    return new Promise<ChildCounts>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        const stores = ['fleets', 'competitors', 'races', 'finishes', 'raceStarts', 'tcfHistory'];
        const tx = db.transaction(stores, 'readonly');
        const counts: ChildCounts = {
          fleets: 0,
          competitors: 0,
          races: 0,
          finishes: 0,
          raceStarts: 0,
          tcfHistory: 0,
        };

        const byField = (store: string, index: string, key: string, out: keyof ChildCounts) => {
          const idx = tx.objectStore(store).index(index);
          const cur = idx.openCursor(IDBKeyRange.only(key));
          cur.onsuccess = () => {
            const c = cur.result;
            if (c) {
              counts[out]++;
              c.continue();
            }
          };
        };

        byField('fleets', 'seriesId', seriesId, 'fleets');
        byField('competitors', 'seriesId', seriesId, 'competitors');
        byField('races', 'seriesId', seriesId, 'races');
        byField('finishes', 'raceId', raceId, 'finishes');
        byField('raceStarts', 'raceId', raceId, 'raceStarts');
        byField('tcfHistory', 'raceId', raceId, 'tcfHistory');

        tx.oncomplete = () => resolve(counts);
        tx.onerror = () => reject(tx.error);
      };
    });
  }, { seriesId, tag, dbName: DB_NAME });
}

function extractSeriesId(url: string): string {
  const m = url.match(/\/series\/([0-9a-f-]{36})/);
  if (!m) throw new Error(`Could not extract seriesId from ${url}`);
  return m[1];
}

test('delete series with warning dialog', async ({ page }) => {
  // ── 1. Create two series ───────────────────────────────────────────────────
  await createSeriesQuick(page, { name: 'Series to Keep' });
  const keepSeriesId = extractSeriesId(page.url());
  await createSeriesQuick(page, { name: 'Series to Delete' });
  const deleteSeriesId = extractSeriesId(page.url());

  // ── 2. Seed a row in every child table for both series ────────────────────
  // Covers every table the cascade is responsible for (fleets, competitors,
  // races, finishes, raceStarts, tcfHistory). Seeding the "kept" series too
  // catches accidental over-deletion.
  await seedChildren(page, keepSeriesId, 'keep');
  await seedChildren(page, deleteSeriesId, 'delete');

  // ── 3. Verify both series appear on home ───────────────────────────────────
  await page.goto('/');
  await expect(page.getByText('Series to Keep')).toBeVisible();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // ── 4. Click delete on the series to delete ────────────────────────────────
  await page.getByRole('button', { name: 'Delete Series to Delete' }).click();

  // ── 5. Warning dialog must appear with series name and warning text ─────────
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Series to Delete/ })).toBeVisible();
  await expect(page.getByText(/permanently delete/i)).toBeVisible();
  await expect(page.getByText(/cannot be undone/i)).toBeVisible();

  // ── 6. Cancel leaves series intact ────────────────────────────────────────
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.getByText('Series to Delete')).toBeVisible();

  // ── 7. Delete for real ─────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Delete Series to Delete' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Delete series' }).click();

  // ── 8. Series is gone; the other one remains ───────────────────────────────
  await expect(page.getByText('Series to Delete')).not.toBeVisible();
  await expect(page.getByText('Series to Keep')).toBeVisible();

  // ── 9. No orphaned child rows remain for the deleted series ───────────────
  const deletedCounts = await countChildren(page, deleteSeriesId, 'delete');
  expect(deletedCounts).toEqual({
    fleets: 0,
    competitors: 0,
    races: 0,
    finishes: 0,
    raceStarts: 0,
    tcfHistory: 0,
  });

  // ── 10. Kept series still has all of its child rows ───────────────────────
  const keptCounts = await countChildren(page, keepSeriesId, 'keep');
  expect(keptCounts).toEqual({
    fleets: 1,
    competitors: 1,
    races: 1,
    finishes: 1,
    raceStarts: 1,
    tcfHistory: 1,
  });
});
