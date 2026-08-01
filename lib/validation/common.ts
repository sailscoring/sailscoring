import { z } from 'zod';

import { OFFICIAL_NAME_MAX_LENGTH, OFFICIAL_ROLES } from '@/lib/race-officials';
import type { OfficialRole } from '@/lib/types';

/**
 * Shared atoms for the resource schemas in `lib/validation/`. The schemas
 * mirror `lib/types.ts` 1:1; the TypeScript interfaces in `types.ts` remain
 * the source of truth, and a `satisfies` check at the bottom of each
 * resource file confirms `z.infer<typeof XxxSchema>` is structurally equal
 * to the corresponding interface.
 */

export const uuidSchema = z.uuid();

/** ISO date string ("YYYY-MM-DD"). Loose validation; the engine reads as text. */
export const isoDateSchema = z.string();

/** Wall-clock time ("HH:MM:SS"). Loose validation; the engine reads as text. */
export const wallClockSchema = z.string();

/** Epoch milliseconds, as produced by Date.now(). */
export const epochMsSchema = z.number().int();

/**
 * Server-side concurrency token (ADR-008 Phase 4). Optional on every
 * mutable resource: present on rows read from Postgres, absent in
 * local-mode (Dexie) and stripped from the .sailscoring file format
 * and public JSON export.
 */
export const versionSchema = z.number().int().positive().optional();

/**
 * One member of a race management team (#339). Shared by the race and series
 * schemas, which carry the same shape at their two independent levels.
 *
 * The role enum is built from the registry in `lib/race-officials.ts` so the
 * wire, the picker and the renderer can't disagree about what a role is. An
 * empty name is accepted: the authoring UI lets a row exist before it is
 * filled in, and every read path treats an unnamed row as absent.
 */
export const raceOfficialSchema = z.object({
  id: z.string(),
  role: z.enum(OFFICIAL_ROLES as readonly [OfficialRole, ...OfficialRole[]]),
  name: z.string().max(OFFICIAL_NAME_MAX_LENGTH),
});

/** How many people one team can name. Generous — a big regatta's race
 *  management team is a dozen or so; the cap only stops a runaway payload. */
export const OFFICIALS_MAX = 50;
