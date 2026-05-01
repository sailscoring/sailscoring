import { z } from 'zod';

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
