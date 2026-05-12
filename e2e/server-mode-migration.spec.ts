/**
 * ADR-008 Phase 5 — verifies the home-page migration banner moves a
 * series from IndexedDB to the server-side workspace.
 *
 * Tagged `@server`. The flow:
 *   1. Sign in (fresh user, empty workspace).
 *   2. Visit `/` so the banner mounts and Dexie opens (the app never
 *      writes to IndexedDB in server mode, so the database has to be
 *      poked into existence first).
 *   3. Seed one Series row via raw IndexedDB and reload.
 *   4. Click "Move to my account" and assert the row appears in the
 *      server-backed series list, both before and after a hard reload.
 */
import { test, expect } from './fixtures';
import { signInFreshUser } from './helpers';

const DB_NAME = 'sailscoring-v1';
// Dexie compiles its `this.version(N)` schemas to IndexedDB version `10 * N`.
// `lib/db.ts` declares version 6 → IDB 60.
const DB_VERSION = 60;

test.describe('@server migration banner', () => {
  test('moves a Dexie series into the signed-in workspace', async ({ page }) => {
    await signInFreshUser(page, 'server-migrate');

    // Step 2: home page mount triggers the banner's `dexie.seriesRepo.list()`,
    // which opens / creates the IndexedDB database to its current schema.
    await page.goto('/');
    // Banner reports "empty" silently; confirm by absence of the migrate button.
    await expect(page.getByRole('button', { name: 'Move to my account' })).toHaveCount(0);

    // Step 3: seed a single Series row directly. The schema is fixed so a
    // raw IDB write is simpler than threading a test-only seam through the app.
    const seedName = `Migrated Series ${Date.now()}`;
    const seedId = await page.evaluate(
      async ({ dbName, dbVersion, name }) => {
        const id = crypto.randomUUID();
        const series = {
          id,
          name,
          venue: 'Howth Yacht Club',
          startDate: '2026-05-02',
          endDate: '',
          venueLogoUrl: '',
          eventLogoUrl: '',
          createdAt: Date.now(),
          lastSnapshotId: null,
          lastSavedAt: null,
          lastModifiedAt: Date.now(),
          snapshotHistory: [],
          scoringMode: 'scratch',
          discardThresholds: [],
          dnfScoring: 'seriesEntries',
          ftpHost: '',
          ftpPath: '',
          ftpPaths: {},
          bilgeBundle: null,
          includeJsonExport: true,
          enabledCompetitorFields: ['boatName', 'helm', 'crewName', 'club'],
          primaryPersonLabel: 'helm',
        };
        await new Promise<void>((resolve, reject) => {
          const req = indexedDB.open(dbName, dbVersion);
          req.onsuccess = () => {
            const db = req.result;
            const tx = db.transaction('series', 'readwrite');
            tx.objectStore('series').put(series);
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        });
        return id;
      },
      { dbName: DB_NAME, dbVersion: DB_VERSION, name: seedName },
    );
    expect(seedId).toMatch(/^[0-9a-f-]{36}$/);

    // Step 4: reload so the banner picks up the seeded row.
    await page.reload();
    await expect(page.getByText(/1 series saved in this browser/)).toBeVisible();

    await page.getByRole('button', { name: 'Move to my account' }).click();

    // Series list refreshes after migration completes.
    await expect(page.getByRole('link', { name: new RegExp(seedName) })).toBeVisible();

    // Hard reload: the row must come back from `/api/v1/series`, not the
    // in-memory cache. Confirms the round trip is real.
    await page.reload();
    await expect(page.getByRole('link', { name: new RegExp(seedName) })).toBeVisible();

    // Banner is gone now that every local id is in localStorage.
    await expect(page.getByRole('button', { name: 'Move to my account' })).toHaveCount(0);
  });
});
