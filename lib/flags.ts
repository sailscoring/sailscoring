/**
 * ADR-008 Phase 1 feature flag.
 *
 * When `USE_SERVER_DATA=true`, the UI reads/writes via the server
 * backend (Postgres + Better Auth) instead of IndexedDB. Off by default
 * throughout Phases 1–5; flipped on in Phase 6.
 *
 * Server-only — do NOT prefix with NEXT_PUBLIC_. Phase 1 has no UI
 * consumers; the flag exists so later phases can branch on it without
 * needing to introduce the value separately.
 */
export const USE_SERVER_DATA = process.env.USE_SERVER_DATA === 'true';
