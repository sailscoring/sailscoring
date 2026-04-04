import type { NextConfig } from "next";

if (!process.env.NEXT_PUBLIC_APP_URL) {
  throw new Error(
    'NEXT_PUBLIC_APP_URL is required. ' +
    'Add it to .env.local for development (e.g. NEXT_PUBLIC_APP_URL=http://localhost:3000).'
  );
}

const nextConfig: NextConfig = {};

export default nextConfig;
