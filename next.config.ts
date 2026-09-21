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
  //
  // In-app publishing renders its pages on the server, and a constructed
  // course is drawn on its data set's captured chart (see
  // lib/course-cards/backgrounds-server.ts). Those images are vendored into
  // public/ at build time by scripts/sync-course-cards.ts, and this glob is
  // what puts them in the publish route's serverless bundle. Without it the
  // pages still publish — the drawing falls back to plain ground.
  outputFileTracingIncludes: {
    '/api/auth/[...all]': ['./lib/sample-series/*.sailscoring'],
    '/api/v1/series/[id]/publish': ['./public/course-cards/**/map/*.png'],
  },
  async rewrites() {
    return {
      beforeFiles: [],
      afterFiles: [
        // iOS asks for the touch icon at these two fixed root paths whatever
        // the page's head declares, and Next publishes the app icon as
        // `/apple-icon.png`. Alias them rather than let two guaranteed
        // requests per iOS visitor render the 404 page.
        { source: '/apple-touch-icon.png', destination: '/apple-icon.png' },
        {
          source: '/apple-touch-icon-precomposed.png',
          destination: '/apple-icon.png',
        },
      ],
      fallback: [
        // Anything else file-shaped that reached the end of the routing table
        // is a miss, and a miss on an asset should not cost what a page
        // costs. Fallback rewrites run after the filesystem, the public
        // directory and every dynamic route, so this cannot shadow something
        // that exists. Scanner traffic for paths that were never assets
        // (`/wp-login.php` and the rest) belongs at the firewall instead.
        {
          source:
            '/:path*\\.:ext(ico|png|jpg|jpeg|gif|bmp|svg|webp|avif|css|js|mjs|map|txt|xml|json|webmanifest|woff|woff2|ttf|otf|eot)',
          destination: '/asset-not-found',
        },
      ],
    };
  },
};

export default nextConfig;
