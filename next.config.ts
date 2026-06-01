import type { NextConfig } from "next";

if (!process.env.NEXT_PUBLIC_APP_URL) {
  throw new Error(
    'NEXT_PUBLIC_APP_URL is required. ' +
    'Add it to .env.local for development (e.g. NEXT_PUBLIC_APP_URL=http://localhost:3000).'
  );
}

const nextConfig: NextConfig = {
  // The sign-up hook (auth route) seeds new workspaces from the committed
  // sample `.sailscoring` files, read at runtime via fs. Force them into the
  // route's serverless bundle so the read works on Vercel.
  outputFileTracingIncludes: {
    '/api/auth/[...all]': ['./lib/sample-series/*.sailscoring'],
  },
};

export default nextConfig;
