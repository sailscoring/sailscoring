/**
 * rrs.org competitor push (gated `rrs-import`). The outbound POST is stubbed
 * server-side: RRS_ORG_API_URL in .env.test points at an RFC 6761 `.test`
 * host, which the push handler writes to `tests/.rrs-org.log` instead of the
 * network — so the spec can assert on the payload actually "sent".
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { signedInTest as test, expect } from './fixtures';
import { createSeriesQuick, enableFeatures } from './helpers';

const EVENT_UUID = 'd17854ef-f55f-4ab6-8429-3f55527b6e9f';
const PUSH_LOG = path.join(process.cwd(), 'tests', '.rrs-org.log');

interface LoggedPush {
  payload: {
    uuid: string;
    source: string;
    competitors: Array<Record<string, string>>;
  };
}

async function readPushLog(): Promise<LoggedPush[]> {
  const text = await fs.readFile(PUSH_LOG, 'utf8');
  return text
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}

test('flag off: the button stays "Import spreadsheet" and opens the file picker directly', async ({ page }) => {
  await createSeriesQuick(page, { name: 'RRS Flag Off' });
  const button = page.getByRole('button', { name: 'Import spreadsheet' });
  await expect(button).toBeVisible();
  const chooserPromise = page.waitForEvent('filechooser');
  await button.click();
  await chooserPromise;
  await expect(page.getByRole('dialog')).not.toBeVisible();
});

test('CSV import + push in one step, then a push-only re-push', async ({ page, signedInEmail }) => {
  await fs.rm(PUSH_LOG, { force: true });
  await enableFeatures(page, signedInEmail, ['rrs-import']);
  await createSeriesQuick(page, { name: 'GP14 Leinsters' });

  // ── Combined flow: the choice dialog, both options ticked ────────────────
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Import competitors' })).toBeVisible();

  await page.getByRole('checkbox', { name: 'rrs.org' }).check();
  // The replace warning is on the choice itself, before any work happens.
  await expect(page.getByText(/replaces .*competitors previously imported/i)).toBeVisible();
  await page.getByLabel('Event UUID').fill(EVENT_UUID);

  const csv = [
    'Sail,Helm,Club,Nat,Division,Email,Mobile',
    'IRL14302,Kevin Donnelly,Sutton DC,IRL,Gold,kd@example.com,086 123 4567',
    'GBR14271,Brian Morrison,Lough Erne YC,GBR,Silver,bm@example.com,',
  ].join('\n');
  await page.getByTestId('competitor-import-input').setInputFiles({
    name: 'entries.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(page.getByText('entries.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // ── Mapping dialog: relay columns detected, push section present ─────────
  await expect(page.getByRole('heading', { name: /map columns/i })).toBeVisible();
  await expect(page.getByText('Email (rrs.org only)')).toBeVisible();
  await expect(page.getByText('Phone (rrs.org only)')).toBeVisible();
  await expect(page.getByText('Push to rrs.org')).toBeVisible();
  // The Division column is bound for a new subdivision axis, and rrs.org's
  // division defaults to it even though the axis doesn't exist yet.
  await expect(
    page.getByText('Division on rrs.org:').getByRole('combobox'),
  ).toContainText("New axis: 'Division'");
  await page.getByRole('button', { name: 'Import 2 rows & push' }).click();

  // ── Completion: local counts plus the push result ────────────────────────
  await expect(page.getByRole('heading', { name: /import complete/i })).toBeVisible();
  await expect(page.getByText(/2 competitors added/i)).toBeVisible();
  await expect(page.getByText(/Pushed 2 competitors to rrs.org/i)).toBeVisible();
  await expect(page.getByText(/Event Panel/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  // ── The payload rrs.org would have received ──────────────────────────────
  const pushes = await readPushLog();
  expect(pushes).toHaveLength(1);
  const { payload } = pushes[0];
  expect(payload.uuid).toBe(EVENT_UUID);
  expect(payload.source).toBe('rrs-ai-import');
  expect(payload.competitors).toHaveLength(2);
  const kevin = payload.competitors.find((c) => c.sail_number === 'IRL14302')!;
  expect(kevin).toMatchObject({
    first_name: 'Kevin',
    last_name: 'Donnelly',
    club_name: 'Sutton DC',
    country_code: 'IRL',
    mna_code: 'IRL',                 // derived from nationality
    email: 'kd@example.com',         // relayed from the CSV, never stored
    phone: '+353861234567',          // normalised via the IRL dialing code
    division: 'Gold',                // the new Division axis, resolved at import
  });

  // Relay fields must not have landed in the competitor model.
  await expect(page.getByRole('row', { name: /IRL14302/ })).toBeVisible();
  await expect(page.getByText('kd@example.com')).not.toBeVisible();

  // ── Push-only re-push: UUID remembered, no CSV needed ────────────────────
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await page.getByRole('checkbox', { name: 'rrs.org' }).check();
  await expect(page.getByLabel('Event UUID')).toHaveValue(EVENT_UUID);
  await page.getByRole('checkbox', { name: 'CSV file' }).uncheck();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: 'Push competitors to rrs.org' })).toBeVisible();
  // The preview shows stored data as it will be sent; contact fields go blank.
  await expect(page.getByText(/Preview \(first 2 of 2\)/)).toBeVisible();
  await expect(page.getByText(/Email, phone and MNA membership numbers will be blank/)).toBeVisible();
  await page.getByRole('button', { name: 'Push 2 competitors' }).click();

  await expect(page.getByRole('heading', { name: 'Push complete' })).toBeVisible();
  await expect(page.getByText(/Pushed 2 competitors to rrs.org/i)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();

  const afterRepush = await readPushLog();
  expect(afterRepush).toHaveLength(2);
  const repushed = afterRepush[1].payload.competitors.find((c) => c.sail_number === 'IRL14302')!;
  expect(repushed.email).toBe('');   // not stored, so a push-only send is blank
  expect(repushed.mna_code).toBe('IRL');
  // The remembered division source is the axis the import minted.
  expect(repushed.division).toBe('Gold');
});
