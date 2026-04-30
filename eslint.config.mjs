import next from 'eslint-config-next/core-web-vitals';

const config = [
  ...next,
  {
    rules: {
      // ADR-008 Phase 3 lockdown: direct Dexie access lives in the
      // repository layer. UI files go through lib/repos.ts (useRepos)
      // and the resource hooks in hooks/use-*.ts. The allowlist below
      // exempts the repository layer itself and the file-format /
      // import-export modules whose conversion is queued behind the UI
      // swap.
      'no-restricted-imports': ['error', {
        paths: [{
          name: '@/lib/db',
          message:
            "Don't import lib/db directly. UI files use useRepos() / hooks/use-*.ts; pure logic that needs the dexie handle goes inside lib/dexie-repository.ts.",
        }],
      }],
    },
  },
  {
    files: [
      'lib/db.ts',
      'lib/dexie-repository.ts',
      'lib/nhc-persistence.ts',
      'lib/series-file.ts',
      'lib/public-export.ts',
      'lib/db/**',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
  {
    ignores: [
      'e2e/**',
      'tests/**',
      'public/**',
      'coverage/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
];

export default config;
