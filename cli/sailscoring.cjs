#!/usr/bin/env node
/**
 * ADR-009 — `bin` entry that makes `sailscoring` a real command.
 *
 * Register tsx's require hook so the TypeScript CLI runs without a build step,
 * then hand off to `runCli`. `pnpm link --global` (or a global install from
 * this repo) puts `sailscoring` on PATH; in-repo, `pnpm cli` runs the same code
 * via `tsx cli/index.ts`.
 *
 * This dev bin runs TypeScript through tsx at runtime, so it depends on tsx
 * being installed (it is, in this repo's node_modules). A standalone,
 * dependency-free executable — compiled JS / Node SEA / Bun — is the M7
 * packaging step.
 */
require('tsx/cjs');
const { runCli } = require('./index.ts');

runCli(process.argv.slice(2)).then(
  (code) => process.exit(code ?? 0),
  (err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  },
);
