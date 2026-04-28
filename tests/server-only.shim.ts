// Shim for the `server-only` package under Vitest. Next/Webpack aliases
// `server-only` to a no-op for server builds and to a thrower for client
// builds; Vitest has no such build-time split, so we alias it to this
// empty module unconditionally. Tests that exercise server-only modules
// (lib/postgres-repository.ts) rely on this.
export {};
