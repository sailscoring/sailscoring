import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// Tests of server code run in Node, as that code does in production. Under
// jsdom the globals come from jsdom's own realm, so a Node `Buffer` is not an
// `instanceof Uint8Array` — which is how the Postgres driver decides to send a
// value as bytea — and server code can behave differently from production.
const serverTests = [
  'tests/db/**/*.test.ts',
  'tests/api/**/*.test.ts',
  'tests/auth/**/*.test.ts',
  'tests/cli/**/*.test.ts',
  'tests/postgres-repository.test.ts',
];

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    setupFiles: ['./tests/setup-env.ts'],
    projects: [
      {
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: serverTests,
        },
      },
      {
        extends: true,
        test: {
          name: 'client',
          environment: 'jsdom',
          include: ['tests/**/*.test.ts'],
          exclude: serverTests,
        },
      },
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, '.'),
      'server-only': resolve(__dirname, 'tests/server-only.shim.ts'),
    },
  },
});
