# Notes: Next.js Static Export vs SSR on Vercel

## Background

bilge-client started as a Next.js app with `output: 'export'` — a static SPA
exported to an `out/` directory and served from Vercel as plain files. It had
one dynamic route: `/bundles/[id]`. The intent was simplicity. The result was
a series of escalating workarounds that were all eliminated the moment we
switched to SSR.

---

## Problems encountered with static export + dynamic routes

### 1. `generateStaticParams` is required but pointless

Static export requires every dynamic route to be pre-rendered, so you must
provide `generateStaticParams()`. With client-side IndexedDB data (unknown at
build time), there is nothing real to generate. The workaround was to
pre-render a single placeholder route (`/bundles/_`) and rewrite all real UUIDs
to it at the CDN layer.

### 2. `useParams()` returns the placeholder, not the real URL

When a visitor hits `/bundles/abc-123`, Vercel rewrites the request to the
pre-rendered `/bundles/_` shell. The RSC tree baked into that shell carries
`paramKey: "_"`, so `useParams()` returns `{ id: "_" }` — not the real UUID.
The workaround was to read the URL with `usePathname().split('/').at(-1)` and
ignore the params machinery entirely.

### 3. Client-side navigation requires two rewrites per dynamic segment

Next.js App Router fetches RSC payloads as `__next.*.txt` files during
client-side navigation. With static export, those files only exist for
pre-rendered routes. Navigating from the bundle list to `/bundles/abc-123`
triggers a fetch for `/bundles/abc-123/__next.full.txt`, which 404s unless
there is a rewrite that redirects `/bundles/:id/:file` → `/bundles/_/:file`.
That rewrite must come *before* the segment rewrite and *before* the SPA
catch-all.

### 4. The catch-all rewrite breaks `vercel dev`

The SPA catch-all (`/(.*) → /index.html`) intercepts every request including
Next.js's own RSC fetches when running under `vercel dev`. Client-side
navigation stops working entirely in the local dev server. The fix was to use
`next dev` (not `vercel dev`) for local development and Playwright tests. This
meant the local dev experience diverged from the Vercel production environment.

### 5. Stale Turbopack cache causes false test failures

`reuseExistingServer: true` in the Playwright config can serve a stale
Turbopack compilation. A routing bug that was already fixed can appear to still
be present. Always `rm -rf .next` before trusting a Playwright failure as a
real regression.

---

## The fix: switch to SSR

Replacing `output: 'export'` with standard Next.js SSR (the default) eliminated
every item above in a single change:

- `generateStaticParams` removed — no placeholder needed.
- `useParams()` works correctly — returns the real UUID from the URL.
- No CDN rewrites needed for RSC files or dynamic segments.
- `vercel dev` works correctly — no catch-all rewrite to interfere.

The bundle data still lives in browser IndexedDB. SSR only fixes the
routing/params machinery; it does not change where data lives.

---

## When static export is actually appropriate

Static export is the right choice when:

- You are deploying to a plain CDN or object-storage host with no server-side
  runtime (S3, GitHub Pages, Cloudflare Pages without Workers).
- Your app has **no dynamic routes**, or all dynamic routes have a known,
  finite, build-time parameter set (e.g. a documentation site with a fixed set
  of pages).

It is the wrong choice when:

- You have dynamic routes whose parameters are unknown at build time.
- You are deploying to Vercel, Netlify, Railway, or any platform that supports
  a Node.js runtime. On these platforms SSR costs nothing extra and removes all
  the workarounds above.

---

## Recommendation for Sail Scoring

Use SSR (the Next.js default). Sail Scoring will be on Vercel, which runs
Next.js SSR natively. There is no reason to pay the static-export tax.
