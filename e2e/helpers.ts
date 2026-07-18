import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { Download, Locator, Page, Response } from '@playwright/test';
import { expect } from '@playwright/test';
import { drizzle } from 'drizzle-orm/postgres-js';
import { and, desc, eq } from 'drizzle-orm';
import postgres from 'postgres';

import * as schema from '@/lib/db/schema';
import { competitorSlugCandidate } from '@/lib/competitor-slug';
import { fulfilRequest } from '@/scripts/provision-org';
import { serializeOrgMetadata, type FeatureKey } from '@/lib/features';

/**
 * The dev/CI Resend stub appends each magic-link issuance to this file as
 * a TSV: `<timestamp>\t<email>\t<url>`. Tests poll it after triggering a
 * sign-in to retrieve the link instead of going through real email.
 */
const MAGIC_LINKS_LOG = path.join(process.cwd(), 'tests', '.magic-links.log');

/**
 * Wait for the most recent magic-link issued to `forEmail` to appear in
 * the local TSV log and return its URL. Polls for ~15 seconds — the link
 * is written server-side during the sign-in POST, which can lag well past
 * 5s under full-suite load. Pass `excludeUrl` when re-requesting a link
 * for the same address so the poll waits for the *new* issuance instead
 * of returning the one that already failed.
 */
export async function readLatestMagicLink(
  forEmail: string,
  excludeUrl?: string,
): Promise<string> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const content = await fs.readFile(MAGIC_LINKS_LOG, 'utf8');
      const lines = content.trim().split('\n').reverse();
      for (const line of lines) {
        const [, email, url] = line.split('\t');
        if (email === forEmail && url && url !== excludeUrl) return url;
      }
    } catch {
      // file may not exist yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No magic link found for ${forEmail}`);
}

/**
 * Sign a fresh user into the app via the magic-link flow. Used by every
 * server-mode e2e test — server mode has no anonymous browsing, so each
 * test starts from /sign-in and lands on the home page before any series
 * work.
 *
 * Returns the email that was used so callers can assert against it.
 */
/**
 * Mint a unique @sailscoring.test address. Digits-only random suffix: the
 * UserMenu button's accessible name is this email, and getByRole's name
 * matcher is substring-by-default, so a base36 suffix could spell a button
 * label ("add", "done", …) and trip strict-mode violations in unrelated
 * locators. Digits can't spell anything.
 */
export function freshTestEmail(prefix: string): string {
  const suffix = Math.floor(Math.random() * 1e9).toString().padStart(9, '0');
  return `${prefix}-${Date.now()}-${suffix}@sailscoring.test`;
}

export async function signInFreshUser(page: Page, prefix: string): Promise<string> {
  const email = freshTestEmail(prefix);
  // The verify GET consumes its token server-side even when the response is
  // lost — under load the navigation can abort (a client-side router update
  // cancelling it, a dropped connection) and a browser-level retry of the
  // same link then lands on /sign-in?error=INVALID_TOKEN. The user identity
  // is the email, so requesting a fresh link and verifying again reaches the
  // exact same signed-in state.
  let previousLink: string | undefined;
  for (let attempt = 0; ; attempt++) {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill(email);
    await page.getByRole('button', { name: 'Send sign-in link' }).click();
    const link = await readLatestMagicLink(email, previousLink);
    previousLink = link;
    try {
      await page.goto(link);
      const url = new URL(page.url());
      if (url.pathname === '/sign-in' && url.searchParams.has('error')) {
        throw new Error(`magic-link verify failed: ${url.searchParams.get('error')}`);
      }
      // First-time sign-ups land on the welcome (name) step; skip through it
      // so callers see the same "signed in on the home page" baseline as before.
      if (url.pathname === '/welcome') {
        await page.getByTestId('welcome-skip').click();
      }
      await expect(page).toHaveURL(/\/$/);
      return email;
    } catch (err) {
      if (attempt >= 2) throw err;
      // The failed verify may still have signed us in (cookie set, response
      // lost). Probe before requesting another link: an authenticated '/'
      // stays put, an anonymous one bounces to /sign-in.
      await page.goto('/');
      if (new URL(page.url()).pathname === '/') return email;
    }
  }
}

/**
 * Reload, retrying once if the reload is aborted. Right after sign-in the App
 * Router can still be settling (the welcome step's push, callbackURL
 * redirects); a client-side navigation committing mid-reload cancels it with
 * net::ERR_ABORTED even though the page is healthy. One retry rides out the
 * settle; anything else rethrows.
 */
async function reloadRetryingAbort(page: Page): Promise<void> {
  try {
    await page.reload();
  } catch (err) {
    if (!String(err).includes('ERR_ABORTED')) throw err;
    await page.reload();
  }
}

/**
 * Create a new series using the quick-create form (bypasses the wizard).
 * Returns after the page navigates to the competitors tab.
 */
export async function createSeriesQuick(
  page: Page,
  data: { name: string; venue?: string; date?: string },
): Promise<void> {
  await page.goto('/series/new?quick=1');
  await page.getByLabel('Name').fill(data.name);
  if (data.venue) await page.getByLabel('Venue').fill(data.venue);
  if (data.date) await page.getByLabel('Date').fill(data.date);
  await page.getByRole('button', { name: 'Create series' }).click();
  await expect(page).toHaveURL(/\/series\/[0-9a-f-]{36}\/competitors$/);
}

/**
 * Create fleets in Settings > Fleets for the current series.
 * Assumes the page is already within a series context (any series tab).
 */
export async function createFleets(page: Page, names: string[]): Promise<void> {
  // Navigate to Settings tab
  const settingsLink = page.getByRole('navigation').getByRole('link', { name: 'Settings' });
  await settingsLink.click();
  // Wait for settings page to load — look for a specific card heading
  await expect(page.locator('h2', { hasText: 'Fleets' })).toBeVisible();
  // Click the Edit button in the Fleets card row
  // The Fleets card has: <div flex><h2>Fleets</h2><Button>Edit ▸</Button></div>
  // Use the test-visible locator for the button next to "Fleets" heading
  const fleetsRow = page.locator('h2', { hasText: 'Fleets' }).locator('..');
  await fleetsRow.locator('button').click();
  // Now the Fleets card is expanded — add fleets
  for (const name of names) {
    await page.getByRole('button', { name: '+ Add fleet' }).click();
    await page.getByPlaceholder('Fleet name').fill(name);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Done' }).first().click();
}

/**
 * Set the series scoring mode in Settings > Scoring Mode.
 * Assumes the page is already within a series context (any series tab).
 */
export async function setScoringMode(page: Page, mode: 'scratch' | 'handicap'): Promise<void> {
  const settingsLink = page.getByRole('navigation').getByRole('link', { name: 'Settings' });
  await settingsLink.click();
  await expect(page.locator('h2', { hasText: 'Scoring mode' })).toBeVisible();
  const scoringRow = page.locator('h2', { hasText: 'Scoring mode' }).locator('..');
  await scoringRow.getByRole('button', { name: /Edit/ }).click();
  const label = mode === 'handicap' ? 'Handicap (time-corrected)' : 'Scratch (position-based)';
  await page.getByText(label).click();
  await page.getByRole('button', { name: 'Done' }).click();
}

/**
 * Direct-write helpers for ADR-008 Phase 7 server-mode tests that need
 * to provision an org workspace and add members programmatically. The
 * Better Auth organization plugin's HTTP endpoints all require a session
 * — direct Drizzle writes mirror what `scripts/provision-org.ts` does
 * for production. The local Postgres URL is hard-wired because every
 * server-mode invocation goes through `pnpm test:e2e:server` which sets
 * the same DATABASE_URL.
 */
const E2E_DB_URL =
  process.env.DATABASE_URL ??
  'postgres://sailscoring:sailscoring@localhost:5432/sailscoring';

function adminDb() {
  const sql = postgres(E2E_DB_URL, { max: 1, prepare: false });
  return { db: drizzle(sql, { schema }), close: () => sql.end() };
}

function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

/**
 * Seed a reconciled cross-series competitor identity (#212): one series and one
 * linked competitor per entry, plus the `competitor_identities` row they point
 * at. Bypasses the reconcile clustering (unit/DB-tested separately) to give the
 * UI and the public career-arc page a ready arc to render. Returns the identity
 * id and its minted vanity slug; the most-recent entry's name/sail seed the
 * identity label/sailNumber.
 */
export async function seedCareerArc(
  workspaceId: string,
  opts: {
    label: string;
    club?: string;
    entries: Array<{
      year: number;
      eventName: string;
      sailNumber: string;
      club?: string;
      /** Also seed a 1-race scratch fleet with a filler boat so this entry
       *  ranks (the star wins → "1st of 2"); otherwise the series has no races
       *  and the entry is unplaced. */
      scored?: boolean;
      /** Seed a live publication for this series so it appears on the public
       *  timeline / index. Unpublished series stay private (#223). */
      published?: boolean;
    }>;
  },
): Promise<{ identityId: string; slug: string }> {
  const { db, close } = adminDb();
  try {
    const identityId = crypto.randomUUID();
    const slug = competitorSlugCandidate(opts.label);
    const sorted = [...opts.entries].sort((a, b) => a.year - b.year);
    const latest = sorted[sorted.length - 1];
    await db.insert(schema.competitorIdentities).values({
      id: identityId,
      workspaceId,
      label: opts.label,
      slug,
      sailNumber: latest?.sailNumber ?? '',
      club: opts.club ?? null,
    });
    let order = 0;
    for (const entry of sorted) {
      const seriesId = crypto.randomUUID();
      await db.insert(schema.series).values({
        id: seriesId,
        workspaceId,
        name: entry.eventName,
        startDate: `${entry.year}-05-01`,
        displayOrder: order++,
      });
      const fleetIds: string[] = [];
      let fleetId: string | undefined;
      if (entry.scored) {
        fleetId = crypto.randomUUID();
        fleetIds.push(fleetId);
        await db.insert(schema.fleets).values({
          id: fleetId,
          seriesId,
          workspaceId,
          name: 'Main Fleet',
          displayOrder: 0,
          scoringSystem: 'scratch',
        });
      }
      const starId = crypto.randomUUID();
      await db.insert(schema.competitors).values({
        id: starId,
        seriesId,
        workspaceId,
        fleetIds,
        sailNumber: entry.sailNumber,
        names: [opts.label],
        club: entry.club ?? opts.club ?? '',
        gender: '',
        age: null,
      });
      await db.insert(schema.competitorIdentityLinks).values({
        competitorId: starId,
        identityId,
        workspaceId,
      });
      if (entry.scored && fleetId) {
        const fillerId = crypto.randomUUID();
        const raceId = crypto.randomUUID();
        await db.insert(schema.competitors).values({
          id: fillerId,
          seriesId,
          workspaceId,
          fleetIds: [fleetId],
          sailNumber: '9999',
          names: ['Filler Boat'],
          club: '',
          gender: '',
          age: null,
        });
        await db.insert(schema.races).values({
          id: raceId,
          seriesId,
          workspaceId,
          raceNumber: 1,
          date: `${entry.year}-05-01`,
        });
        await db.insert(schema.finishes).values([
          { id: crypto.randomUUID(), raceId, competitorId: starId, sortOrder: 0 },
          { id: crypto.randomUUID(), raceId, competitorId: fillerId, sortOrder: 1 },
        ]);
      }
      if (entry.published) {
        const pubSlug = `${entry.eventName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')}-${seriesId.slice(0, 4)}`;
        await db.insert(schema.publishedSeries).values({
          id: crypto.randomUUID(),
          workspaceId,
          seriesId,
          slug: pubSlug,
          pages: [],
          contentHash: crypto.randomUUID(),
          publishedVersion: 1,
        });
      }
    }
    return { identityId, slug };
  } finally {
    await close();
  }
}

/**
 * Seed one scored series for the rankings tests (#209): a scratch fleet, one
 * race, and finishes in the given entrant order (index 0 wins). Each entrant
 * links to a workspace identity found by exact label — or freshly minted — so
 * the same name recurs as the same sailor across several seeded series.
 */
export async function seedRankedSeries(
  workspaceId: string,
  opts: {
    name: string;
    year: number;
    published?: boolean;
    entrants: Array<{
      name: string;
      sailNumber: string;
      club?: string;
      nationality?: string;
      /** Fleet the entrant races in; fleets are created on first mention.
       *  Defaults to a single 'Main Fleet'. */
      fleet?: string;
    }>;
  },
): Promise<{ seriesId: string }> {
  const { db, close } = adminDb();
  try {
    const seriesId = crypto.randomUUID();
    await db.insert(schema.series).values({
      id: seriesId,
      workspaceId,
      name: opts.name,
      startDate: `${opts.year}-06-01`,
      displayOrder: 0,
    });
    const fleetIdByName = new Map<string, string>();
    for (const entrant of opts.entrants) {
      const fleetName = entrant.fleet ?? 'Main Fleet';
      if (fleetIdByName.has(fleetName)) continue;
      const fleetId = crypto.randomUUID();
      await db.insert(schema.fleets).values({
        id: fleetId,
        seriesId,
        workspaceId,
        name: fleetName,
        displayOrder: fleetIdByName.size,
        scoringSystem: 'scratch',
      });
      fleetIdByName.set(fleetName, fleetId);
    }
    const raceId = crypto.randomUUID();
    await db.insert(schema.races).values({
      id: raceId,
      seriesId,
      workspaceId,
      raceNumber: 1,
      date: `${opts.year}-06-01`,
    });
    let sortOrder = 0;
    for (const entrant of opts.entrants) {
      const [existing] = await db
        .select({ id: schema.competitorIdentities.id })
        .from(schema.competitorIdentities)
        .where(
          and(
            eq(schema.competitorIdentities.workspaceId, workspaceId),
            eq(schema.competitorIdentities.label, entrant.name),
          ),
        )
        .limit(1);
      let identityId = existing?.id;
      if (!identityId) {
        identityId = crypto.randomUUID();
        await db.insert(schema.competitorIdentities).values({
          id: identityId,
          workspaceId,
          label: entrant.name,
          slug: competitorSlugCandidate(entrant.name),
          sailNumber: entrant.sailNumber,
          club: entrant.club ?? null,
          nationality: entrant.nationality ?? null,
        });
      }
      const competitorId = crypto.randomUUID();
      await db.insert(schema.competitors).values({
        id: competitorId,
        seriesId,
        workspaceId,
        fleetIds: [fleetIdByName.get(entrant.fleet ?? 'Main Fleet')!],
        sailNumber: entrant.sailNumber,
        names: [entrant.name],
        club: entrant.club ?? '',
        nationality: entrant.nationality ?? null,
        gender: '',
        age: null,
      });
      await db.insert(schema.competitorIdentityLinks).values({
        competitorId,
        identityId,
        workspaceId,
      });
      await db.insert(schema.finishes).values({
        id: crypto.randomUUID(),
        raceId,
        competitorId,
        sortOrder: sortOrder++,
      });
    }
    if (opts.published) {
      const pubSlug = `${opts.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')}-${seriesId.slice(0, 4)}`;
      await db.insert(schema.publishedSeries).values({
        id: crypto.randomUUID(),
        workspaceId,
        seriesId,
        slug: pubSlug,
        pages: [],
        contentHash: crypto.randomUUID(),
        publishedVersion: 1,
      });
    }
    return { seriesId };
  } finally {
    await close();
  }
}

// 1×1 transparent PNG, base64 — the byte payload `logo_blobs` stores locally.
const SEED_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/**
 * Insert a logo straight into a workspace's flag locker (Phase 4 cross-workspace
 * copy tests). Seeds the `logo_blobs` byte row + the `flag_locker_logos`
 * metadata row using the local `db:` locator, so the source workspace has a logo
 * without needing the feature enabled or the upload UI. Returns the logo id.
 */
export async function seedLogo(
  workspaceId: string,
  displayName: string,
): Promise<string> {
  const { db, close } = adminDb();
  try {
    const id = crypto.randomUUID();
    const key = `logos/${workspaceId}/${id}.png`;
    await db.insert(schema.logoBlobs).values({
      key,
      data: SEED_PNG_B64,
      contentType: 'image/png',
      updatedAt: new Date(),
    });
    await db.insert(schema.flagLockerLogos).values({
      id,
      workspaceId,
      displayName,
      logoClass: 'sponsor',
      locator: `db:${key}`,
      contentType: 'image/png',
      byteSize: 70,
      sha256: id,
      sourceUrl: null,
    });
    return id;
  } finally {
    await close();
  }
}

/**
 * Create an organization workspace with a unique slug. Returns the
 * organization id so the caller can pass it to `addMemberByEmail` and
 * use it as the active workspace.
 */
export async function createOrgWorkspace(name: string): Promise<{ id: string; slug: string }> {
  const { db, close } = adminDb();
  try {
    const id = randomId('org');
    const slug = `e2e-${id.slice(4, 16)}`;
    await db.insert(schema.organization).values({
      id,
      name,
      slug,
      createdAt: new Date(),
    });
    return { id, slug };
  } finally {
    await close();
  }
}

/**
 * Add an existing user (looked up by email — they must have signed in
 * once already) to an organization with the given role. Used by the
 * Phase 7 cross-cutting tests to put two users in the same workspace
 * for the actor-attribution conflict scenario.
 */
export async function addMemberByEmail(
  orgId: string,
  email: string,
  role: 'owner' | 'admin' | 'member' | 'scorer' = 'member',
): Promise<void> {
  const { db, close } = adminDb();
  try {
    const [user] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email.toLowerCase()))
      .limit(1);
    if (!user) {
      throw new Error(`addMemberByEmail: user "${email}" not found`);
    }
    const [existing] = await db
      .select({ id: schema.member.id })
      .from(schema.member)
      .where(
        and(
          eq(schema.member.organizationId, orgId),
          eq(schema.member.userId, user.id),
        ),
      )
      .limit(1);
    if (existing) return;
    await db.insert(schema.member).values({
      id: randomId('mem'),
      organizationId: orgId,
      userId: user.id,
      role,
      createdAt: new Date(),
    });
  } finally {
    await close();
  }
}

/**
 * Delete every session row for a user (looked up by email), leaving the
 * browser's session cookie in place. Simulates a server-side revocation /
 * DB wipe so the stale-cookie self-heal can be exercised.
 */
export async function deleteUserSessions(email: string): Promise<void> {
  const { db, close } = adminDb();
  try {
    const [user] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email.toLowerCase()))
      .limit(1);
    if (!user) {
      throw new Error(`deleteUserSessions: user "${email}" not found`);
    }
    await db
      .delete(schema.session)
      .where(eq(schema.session.userId, user.id));
  } finally {
    await close();
  }
}

/**
 * Read the most recent pending invitation id for an email (#153). Invitations
 * are emailed in production; in e2e we pull the id straight from the DB to
 * build the `/accept-invitation/{id}` URL, the same way the magic-link log
 * stub stands in for email. Polls briefly since the invite is created by a UI
 * action.
 */
export async function latestInvitationId(email: string): Promise<string> {
  const { db, close } = adminDb();
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      const [row] = await db
        .select({ id: schema.invitation.id })
        .from(schema.invitation)
        .where(
          and(
            eq(schema.invitation.email, email.toLowerCase()),
            eq(schema.invitation.status, 'pending'),
          ),
        )
        .orderBy(desc(schema.invitation.createdAt))
        .limit(1);
      if (row) return row.id;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`No pending invitation found for ${email}`);
  } finally {
    await close();
  }
}

/**
 * Fulfil a user's latest pending org-creation request the way the project
 * owner would — via the provision-org `fulfilRequest` path (#153). Returns the
 * new workspace so the test can switch into it.
 */
export async function fulfilOrgRequest(
  email: string,
): Promise<{ id: string; slug: string; name: string }> {
  const { db, close } = adminDb();
  try {
    const [req] = await db
      .select({ id: schema.orgRequest.id })
      .from(schema.orgRequest)
      .where(
        and(
          eq(schema.orgRequest.userEmail, email.toLowerCase()),
          eq(schema.orgRequest.status, 'pending'),
        ),
      )
      .orderBy(desc(schema.orgRequest.createdAt))
      .limit(1);
    if (!req) throw new Error(`no pending org request for ${email}`);
    const { org } = await fulfilRequest(db, { requestId: req.id });
    return org;
  } finally {
    await close();
  }
}

/**
 * Set the signed-in browser's active workspace and reload. The header
 * switcher is the production path; this mirrors the same call so tests
 * can position themselves into a particular workspace deterministically.
 */
export async function setActiveWorkspace(
  page: Page,
  organizationId: string,
): Promise<void> {
  await page.evaluate(async (orgId) => {
    const res = await fetch('/api/auth/organization/set-active', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ organizationId: orgId }),
    });
    if (!res.ok) throw new Error(`set-active failed: ${res.status}`);
  }, organizationId);
  await reloadRetryingAbort(page);
}

/**
 * Enable experimental features (#155) for the signed-in user's *personal*
 * workspace, then reload so the layout recomputes the effective set. Most
 * specs run a fresh user in their personal workspace, which has no features by
 * default; gated affordances (Sailwave/finish-CSV import, FTP, ECHO, custom
 * NHC) only appear once enabled. Model B reads the active workspace's own
 * features, so writing them onto the personal org is enough — no club needed.
 */
export async function enableFeatures(
  page: Page,
  email: string,
  features: FeatureKey[],
): Promise<void> {
  const { db, close } = adminDb();
  try {
    const [u] = await db
      .select({ id: schema.user.id })
      .from(schema.user)
      .where(eq(schema.user.email, email.toLowerCase()))
      .limit(1);
    if (!u) throw new Error(`enableFeatures: user "${email}" not found`);
    // Personal workspace slug convention: `u-${userId.slice(0, 16)}`
    // (personalWorkspaceSlug in lib/auth/require-workspace.ts).
    const slug = `u-${u.id.slice(0, 16)}`;
    await db
      .update(schema.organization)
      .set({ metadata: serializeOrgMetadata({ kind: 'personal', enabledFeatures: features, disabledFeatures: [], seededFeatureSamples: [] }) })
      .where(eq(schema.organization.slug, slug));
  } finally {
    await close();
  }
  await reloadRetryingAbort(page);
}

/**
 * Enable experimental features (#155) on an org (club) workspace by id.
 * The org-workspace counterpart of `enableFeatures` above; callers reload
 * affected pages themselves.
 */
export async function enableOrgFeatures(
  orgId: string,
  features: FeatureKey[],
): Promise<void> {
  const { db, close } = adminDb();
  try {
    await db
      .update(schema.organization)
      .set({ metadata: serializeOrgMetadata({ kind: 'club', enabledFeatures: features, disabledFeatures: [], seededFeatureSamples: [] }) })
      .where(eq(schema.organization.id, orgId));
  } finally {
    await close();
  }
}

/**
 * Add a competitor using the competitor form.
 * Assumes the page is on the Competitors tab with the Add form open or about to be opened.
 * If fleet is specified and multiple fleets exist, checks the fleet checkbox.
 */
export async function addCompetitor(
  page: Page,
  data: { sailNumber: string; name: string; club?: string; fleet?: string; ircTcc?: string; pyNumber?: string; nhcStartingTcf?: string; echoStartingTcf?: string },
): Promise<void> {
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Sail number').fill(data.sailNumber);
  await page.getByLabel('Competitor name').fill(data.name);
  if (data.club) await page.getByLabel('Club').fill(data.club);
  if (data.fleet) {
    // Multi-fleet series: the fleet checkboxes render once the fleets query
    // resolves. Auto-wait for the checkbox and check it — an earlier
    // `if (isVisible())` guard raced that query (the form opens before fleets
    // load), silently skipped the assignment, and the competitor fell back to
    // the first fleet. Only multi-fleet callers pass `fleet`.
    await page.getByRole('checkbox', { name: data.fleet }).check();
  }
  if (data.ircTcc) await page.getByLabel('IRC TCC', { exact: true }).fill(data.ircTcc);
  if (data.pyNumber) await page.getByLabel('PY number', { exact: true }).fill(data.pyNumber);
  if (data.nhcStartingTcf) await page.getByLabel('NHC starting TCF', { exact: true }).fill(data.nhcStartingTcf);
  if (data.echoStartingTcf) await page.getByLabel('ECHO starting handicap', { exact: true }).fill(data.echoStartingTcf);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('cell', { name: data.sailNumber })).toBeVisible();
}

/**
 * Open the Standings → Preview modal (#163), optionally switch to a named
 * fleet via the in-modal selector, and download that fleet's HTML. Returns the
 * triggered download. Replaces the old "Export HTML" button/dropdown flow.
 */
export async function downloadFleetHtml(page: Page, fleetName?: string): Promise<Download> {
  const dialog = page.getByRole('dialog');
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  // The iframe only mounts once buildFleetHtmlFiles resolves.
  await expect(dialog.locator('iframe')).toBeVisible();
  if (fleetName) {
    await dialog.getByRole('combobox').click();
    await page.getByRole('option', { name: fleetName }).click();
  }
  // Download is a menu (HTML / PDF); the HTML item triggers the file download.
  await dialog.getByRole('button', { name: 'Download' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'HTML' }).click(),
  ]);
  // Close so the helper can be called again (e.g. another fleet) from a clean
  // state. Wait for the Download menu to fully close first: an Escape pressed
  // while its dismissable layer is still tearing down is swallowed by the menu
  // and never reaches the dialog, leaving it open to block the next interaction.
  await expect(page.getByRole('menuitem', { name: 'HTML' })).toBeHidden();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
  return download;
}

/**
 * Run a finish-mutating action and wait for it to fully persist (#169). The
 * race result page autosaves each finisher add / reorder / time edit / code set
 * as one or more PUT/POST writes to `…/finishes`. Waiting only on the
 * `autosave-status` pill is racy: it can read "All changes saved" from a *prior*
 * save in the window before this action's writes start. So gate on a matching
 * response (the front edge — a write definitely fired) and then drain the pill
 * (the back edge — every queued write settled). A single reorder or timed add
 * fires several PUTs; `waitForResponse` resolves on the first, the pill drain
 * covers the rest. Reads that rebuild from the server (Preview/export) then see
 * a fully-flushed race rather than dropping a row, time, or rating value.
 */
export async function settleFinish(page: Page, action: () => Promise<void>): Promise<void> {
  const isFinishWrite = (r: Response) =>
    /\/api\/v1\/races\/[^/]+\/finishes(\/[^/]+)?$/.test(new URL(r.url()).pathname) &&
    ['POST', 'PUT'].includes(r.request().method());
  await Promise.all([page.waitForResponse(isFinishWrite), action()]);
  await expect(page.getByTestId('autosave-status')).toHaveText('All changes saved');
}

/**
 * Reorder a sortable row by keyboard via its drag handle (dnd-kit's
 * KeyboardSensor): focus the handle, Space to pick up, arrow `steps` times,
 * Space to drop. Reliable in headless Playwright where pointer drags are flaky.
 */
export async function keyboardReorder(
  page: Page,
  handle: Locator,
  key: 'ArrowUp' | 'ArrowDown',
  steps = 1,
): Promise<void> {
  await handle.focus();
  // dnd-kit's KeyboardSensor needs a tick between events to start the drag and
  // measure the list before the arrow moves it — pressing back-to-back drops
  // the move. Short pauses keep this reliable in headless runs.
  await page.keyboard.press('Space'); // pick up
  await page.waitForTimeout(100);
  for (let i = 0; i < steps; i++) {
    await page.keyboard.press(key);
    await page.waitForTimeout(100);
  }
  await page.keyboard.press('Space'); // drop
  await page.waitForTimeout(100);
}

/**
 * Seed one as-published season ranking (#309) plus a ranking-only identity
 * for its first row — the archive-ingest shape, written directly so e2e can
 * exercise the display and career-arc surfaces without the CI pipeline.
 */
export async function seedAsPublishedRanking(
  workspaceId: string,
  opts: {
    name: string;
    slug: string;
    season: number;
    fleetLabel?: string;
    sailorName: string;
    sailorSlug: string;
  },
): Promise<void> {
  const { db, close } = adminDb();
  try {
    await db.insert(schema.competitorIdentities).values({
      id: crypto.randomUUID(),
      workspaceId,
      label: opts.sailorName,
      slug: opts.sailorSlug,
      managedBy: 'archive',
    });
    await db.insert(schema.asPublishedRankings).values({
      id: crypto.randomUUID(),
      workspaceId,
      name: opts.name,
      slug: opts.slug,
      season: opts.season,
      fleetLabel: opts.fleetLabel ?? null,
      ruleNote: 'Nationals (non-discardable) + best 2 of 4 regionals',
      source: {
        url: 'https://example.test/ranking',
        capturedAt: '2013-01-30',
        note: 'seeded for e2e',
      },
      table: {
        caption: 'Sailed: 5, Discards: 2, To count: 3',
        leadColumns: [{ key: 'club', label: 'Club' }],
        eventHeaders: [{ label: 'Leinsters' }, { label: 'Nationals' }],
        summaryColumns: [{ key: 'nett', label: 'Nett' }],
        rows: [
          {
            identity: opts.sailorSlug,
            rank: 1,
            rankLabel: '1st',
            name: opts.sailorName,
            leadCells: ['NYC'],
            eventCells: [{ text: '1.0' }, { text: '(2.0)', discard: true }],
            summaryCells: ['3.0'],
          },
          {
            identity: null,
            rank: 2,
            rankLabel: '2nd',
            name: 'Unlinked Sailor',
            leadCells: ['HYC'],
            eventCells: [{ text: '2.0' }, { text: '1.0' }],
            summaryCells: ['3.0'],
          },
        ],
      },
      rankedCount: 2,
      hash: crypto.randomUUID(),
      updatedBy: null,
    });
  } finally {
    await close();
  }
}
