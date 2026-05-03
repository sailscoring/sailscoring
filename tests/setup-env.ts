// tests/setup-env.ts
//
// Vitest setup file (wired in via vitest.config.ts → test.setupFiles).
// Loads .env.test into process.env before any test module runs.
//
// .env.test is the single source of truth for test config; this file
// just bridges it into vitest. The matching loader for the Playwright
// path is scripts/start-test.sh (bash sourcing).
//
// DATABASE_URL is intentionally *not* defaulted here. Tests that
// require Postgres self-skip when DATABASE_URL is unset, which is the
// behaviour `pnpm test:unit` relies on (no DB needed). The
// `pnpm test:unit:db` script sets DATABASE_URL inline, and that value
// reaches process.env before this file runs — so dotenv's default
// "don't override existing" behaviour preserves it.
//
// See docs/local-dev-scripts.md for the full picture.

import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '.env.test' });
