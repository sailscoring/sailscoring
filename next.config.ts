import type { NextConfig } from "next";

if (!process.env.NEXT_PUBLIC_APP_URL) {
  throw new Error(
    'NEXT_PUBLIC_APP_URL is required. ' +
    'Add it to .env.local for development (e.g. NEXT_PUBLIC_APP_URL=http://localhost:3000).'
  );
}

const nextConfig: NextConfig = {
  experimental: {
    // Next 16.3 type-checks by spawning `typescript/bin/tsc` by default. The
    // `typescript` package here is aliased to the TS 6.0 API compat package,
    // whose only bin is `tsc6`, so CLI mode reports typescript as missing and
    // the build fails. Keep the compiler-API path until the alias goes away.
    useTypeScriptCli: false,
  },
  // The sign-up hook (auth route) seeds new workspaces from the committed
  // sample `.sailscoring` files, read at runtime via fs from `process.cwd()`
  // (see lib/sample-series/seed.ts). This glob is the *sole* mechanism shipping
  // them into the route's serverless bundle — the seed deliberately avoids a
  // statically-traced module URL so Turbopack's NFT doesn't over-trace — so it
  // must stay in sync with the files seed.ts reads.
  outputFileTracingIncludes: {
    '/api/auth/[...all]': ['./lib/sample-series/*.sailscoring'],
  },
};

export default nextConfig;
