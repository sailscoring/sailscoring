# Notes: Next.js App Router Static Export with Dynamic Routes

Distilled from a painful debug session in bilge-client (commits 81b1a55 → 67513d1)
that burned through a lot of tokens to arrive at a small, clear fix. Preserved
here for reuse if Sail Scoring ever adopts the same pattern.

---

## Background

bilge-client is a Next.js App Router app deployed as a static export (`output:
'export'`) to Vercel, with Vercel serverless functions alongside it. Vercel's
catch-all rewrite (`/(.*) → /index.html`) serves the SPA shell for all routes
the static export doesn't know about. The app has a dynamic route `/bundles/[id]`
backed by IndexedDB (Dexie), with no server-side data fetching.

The symptom: clicking a bundle in the list changed the URL but the home page
stayed rendered. "Bundle not found" appeared in production even when the bundle
was clearly in the list.

---

## Lesson 1: Static export + dynamic routes require TWO Vercel rewrites

**What happens during client-side navigation in Next.js App Router:**

When a user navigates (soft-nav) to `/bundles/uuid`, the Next.js client-side
router does NOT load a new HTML page. Instead it fetches a partial RSC (React
Server Components) payload file from a path like:

```
/bundles/uuid/__next.bundles.$d$id.__PAGE__.txt
```

In a static export, that file only exists for paths listed in
`generateStaticParams`. If your placeholder is `_`, only this exists:

```
/bundles/_/__next.bundles.$d$id.__PAGE__.txt
```

So `/bundles/uuid/__next.bundles.$d$id.__PAGE__.txt` → 404 → catch-all rewrite
returns `index.html` → Next.js router receives HTML where it expected RSC binary
data → router silently stays on the previous page, URL updates but content
doesn't. This is the "URL changed, page didn't" symptom.

**The fix requires TWO rewrites:**

```json
{ "source": "/bundles/:id/:file", "destination": "/bundles/_/:file" },
{ "source": "/bundles/:id",       "destination": "/bundles/_" }
```

The first covers the RSC fetch; the second covers the HTML for direct/hard
navigation. Both are needed. The RSC fetch goes to
`/bundles/uuid/__next.bundles.$d$id.__PAGE__.txt`; `:file` matches that literal
filename, so the rewrite serves the pre-generated file from `/bundles/_/`.

**Important:** place the `:id/:file` rewrite BEFORE the `:id` rewrite, and both
BEFORE the catch-all `/(.*) → /index.html`.

**Generalised pattern for any dynamic route `/foo/[id]`:**

```json
{ "source": "/foo/:id/:file", "destination": "/foo/_/:file" },
{ "source": "/foo/:id",       "destination": "/foo/_" }
```

---

## Lesson 2: The RSC partial file carries no path — the rewrite is safe

You might worry: if we serve `/bundles/_/__PAGE__.txt` for every UUID, won't the
client think it's on the `_` page? No, because:

- The `__PAGE__` partial files have **no path (`"c"`) field** in the RSC payload.
  The client doesn't validate the path when processing partial navigation.
- Only the `_full.txt` file (used for hard/direct navigation) carries
  `"c":["","bundles","_"]`, and it's never fetched during soft-nav.
- The `_tree.txt` file marks the `[id]` segment as `"paramType":"d"` (dynamic),
  so the client router accepts it for any UUID.

This is what makes the rewrite approach safe and correct.

---

## Lesson 3: Use `usePathname()` not `useParams()` to read the ID

**Why `useParams()` is broken in static export:**

The RSC tree file (`_tree.txt`) contains `"paramKey":"_"` — the pre-rendered
placeholder value from `generateStaticParams`. During client-side navigation,
`useParams()` reads from the RSC-derived params context, which is populated from
this tree. So even though the browser URL is `/bundles/some-uuid`,
`useParams()` returns `{ id: "_" }`. Every `bundleRepo.get("_")` returns null →
"Bundle not found".

In `next dev` (SSR), the dev server renders the route with the real params, so
`useParams()` works correctly there. This caused the "passes in dev, fails in
production" split and wasted considerable debugging time.

**The correct approach:**

```tsx
import { usePathname } from 'next/navigation';

export default function ThingDetailPage() {
  // useParams() returns the RSC-tree paramKey ("_") in static export.
  // usePathname() always reflects the real browser URL.
  const id = usePathname().split('/').at(-1)!;
  const item = useLiveQuery(() => repo.get(id) ?? null, [id]);
  ...
}
```

`usePathname()` reads from the browser's location bar, not from pre-rendered
RSC metadata. It always returns the real URL segment.

**Do not pass `id` as a server-component prop either.** The server component is
pre-rendered with `id="_"`, so the prop value is `"_"` in production, giving
the same bug.

---

## Lesson 4: Rewrite destination must be a clean URL, not a `.html` path

Wrong (first attempt):
```json
{ "source": "/bundles/:id", "destination": "/bundles/_/index.html" }
```

- In `next dev`: the dev server 404s on paths ending in `.html` — that's not a
  valid Next.js route suffix.
- In production: the static export emits `bundles/_.html` (flat file), not
  `bundles/_/index.html` (directory).

Correct:
```json
{ "source": "/bundles/:id", "destination": "/bundles/_" }
```

Use the clean-URL form. In dev it matches the route; in production Vercel maps
it to the `.html` file automatically.

---

## Lesson 5: `vercel dev` breaks RSC navigation — use `next dev` for tests

`vercel dev` applies ALL rewrites from `vercel.json`, including the catch-all:

```json
{ "source": "/(.*)", "destination": "/index.html" }
```

This intercepts every RSC fetch (`/__next.*.txt` request) and returns `index.html`
instead, breaking client-side navigation entirely. The Playwright test must use
`next dev`:

```ts
// playwright.config.ts
webServer: {
  // Use next dev, not vercel dev. vercel.json's catch-all rewrite
  // (/(.*) → /index.html) intercepts RSC fetch requests in vercel dev,
  // breaking client-side navigation entirely.
  command: 'pnpm dev',
  url: 'http://localhost:3000',
  reuseExistingServer: !process.env.CI,
  timeout: 60_000,
}
```

---

## Lesson 6: `reuseExistingServer` can silently serve stale routes

`reuseExistingServer: !process.env.CI` means Playwright reuses whatever server
is already on port 3000 locally. If that server was compiled with a previous
route structure (e.g., an `app/bundles/page.tsx` before it was deleted and
replaced with `app/bundles/[id]/page.tsx`), stale route compilation persists
even though the files are gone — Turbopack doesn't always detect deletions
reliably.

**Symptoms:** Test failures that appear to be code bugs but vanish when the
server is restarted.

**When debugging a mysteriously failing test:**

```sh
pkill -f "next dev"
rm -rf client/.next
pnpm run test:e2e
```

Always do this before concluding the code is broken.

---

## Lesson 7: Tests pass in `next dev` ≠ works in production

`next dev` renders every page dynamically via SSR — it ignores `output: 'export'`
and does not apply Vercel rewrites. `useParams()` works correctly, RSC files are
served for every UUID on demand, and the catch-all rewrite is absent.

The production static export is a fundamentally different execution environment.
Code that works in `next dev` can silently fail in production for reasons
invisible in tests:

- `useParams()` returning the placeholder `"_"` instead of the real UUID
- RSC partial files not existing for real UUIDs
- Catch-all rewrites intercepting RSC fetches

**Mitigation:** always do a final test against `pnpm run deploy` (Vercel preview)
before declaring a navigation fix done.

---

## Decision: Should Sail Scoring use `output: 'export'`?

bilge used static export because it has no server component that needs data — all
data is in client-side IndexedDB. Even so, it required significant complexity to
make dynamic routes work.

**If Sail Scoring uses SSR (no `output: 'export'`):**

- `useParams()` works correctly in all environments.
- Dynamic routes render on demand; no `generateStaticParams` needed.
- No Vercel rewrites needed for the app routes.
- RSC files are generated per-request, not pre-built.
- All of the above complexity disappears.

Vercel runs Next.js SSR natively at zero extra cost. Static export is only
necessary if you need to host the files on a plain CDN or file server with no
serverless runtime. For a Vercel deployment, **prefer SSR over `output: 'export'`
whenever you have dynamic routes.**

If Sail Scoring ever does use static export with dynamic routes, apply all the
lessons above from day one rather than discovering them through debugging.

---

## Quick-reference checklist for Next.js static export + dynamic routes on Vercel

- [ ] `generateStaticParams` returns at least one placeholder (e.g. `[{ id: '_' }]`)
- [ ] Two Vercel rewrites per dynamic segment: `/:seg/:file → /placeholder/:file`
      and `/:seg → /placeholder` (in that order, before the catch-all)
- [ ] Rewrite destinations use clean URLs, not `.html` paths
- [ ] Client components read the current URL with `usePathname()`, not `useParams()`
- [ ] Playwright uses `next dev` as its `webServer`, not `vercel dev`
- [ ] When debugging test failures, kill the dev server and clear `.next/` first
- [ ] Final validation is done against a Vercel preview deployment
