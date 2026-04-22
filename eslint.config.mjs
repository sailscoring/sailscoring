import next from 'eslint-config-next/core-web-vitals';

// Downgrade new react-hooks@7 rules that flag working patterns used
// throughout this codebase (sync-props-to-state, latest-ref, hoisted handlers,
// Date.now() inside async handlers). Triage tracked in #94.
const config = [
  ...next,
  {
    rules: {
      'react-hooks/purity': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/immutability': 'warn',
    },
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
