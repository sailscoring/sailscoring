# Bilge Client App

A standalone web app for scorers to publish and update HTML results via
[bilge](https://github.com/sailscoring/bilge), the MVP results-publishing service.

**Status:** Design complete — ready to implement

**Related:** [ADR-004: Results Publishing](decisions/004-results-publishing.md),
[Issue #11](https://github.com/sailscoring/sailscoring/issues/11)

## Purpose

The bilge client has two purposes:

1. **Immediate utility** — a simple UI for scorers to upload HTML results files
   to bilge without writing code or using curl.

2. **Dry run for the MVP UI** — building this app is practice for the main Sail
   Scoring application. The technology choices, component patterns, repository
   abstraction, and build setup all carry forward directly. The publishing
   workflow prototyped here will mirror what the full application provides.

The app is deliberately throwaway. When Sail Scoring ships its full-stack
version, results publishing moves into the main application and the bilge
client is retired alongside bilge itself.

## Repository

A new repository: `github.com/sailscoring/bilge-client`. Separate from the
bilge backend repo — it is a full Next.js application and deserves its own
project context. Deployed as a separate Vercel project (static export, free
tier).

## Technology stack

Mirrors [ADR-003](decisions/003-application-architecture.md) exactly:

| Layer | Choice | Notes |
|-------|--------|-------|
| Framework | Next.js (App Router, `output: 'export'`) | Same as main app |
| Language | TypeScript | Shared types across UI and data layer |
| Storage | Dexie.js (IndexedDB) | Same as main app |
| UI components | shadcn/ui (Radix + Tailwind) | Same as main app |
| Styling | Tailwind CSS | Same as main app |
| Testing | Vitest | Same as main app |
| Hosting | Vercel (static) | Free tier |

No PWA or service worker. The bilge client is a publish-from-your-desk tool,
not a field app — offline capability is not needed.

## Data model

The core entity is a **publishing bundle**: a named collection of files to be
published under a common slug prefix, identified to bilge by a UUID.

```typescript
interface Bundle {
  id: string;              // local primary key (cuid2)
  name: string;            // human label, e.g. "HYC Autumn League 2026"
  prefix: string;          // slug namespace, e.g. "hyc/autumn-league-2026"
  uuid: string;            // UUID v4, generated once per bundle, identifies
                           //   this bundle to bilge across all its slugs
  email: string;           // scorer's email address
  files: FileEntry[];      // file entries (stored inline)
  createdAt: number;       // Unix timestamp ms
  updatedAt: number;       // Unix timestamp ms
}

interface FileEntry {
  slug: string;            // full bilge slug: "{prefix}/{slugified-filename}"
                           //   editable before first publish
  filename: string;        // original filename — display label and slug source
  lastPublishedAt: number | null;
  publishedUrl: string | null;
  status: 'unpublished' | 'pending' | 'published';
}
```

File *contents* are never stored in IndexedDB. Only metadata is persisted.
When re-publishing, the scorer re-selects the files from disk.

## Slug derivation

When a file is added to a bundle, its slug is derived automatically:

```
{prefix}/{slugify(basename-without-extension)}
```

`slugify`: lowercase, replace runs of non-alphanumeric characters with a
single hyphen, strip leading/trailing hyphens.

Example: prefix `hyc/autumn-2026`, file `Autumn League Standings.html` →
slug `hyc/autumn-2026/autumn-league-standings`.

The scorer can edit the derived slug before the first publish. After the first
successful publish the slug is locked — it is owned by the bundle's UUID in
bilge and cannot be changed without a conflict.

## Repository pattern

Even at this scale, data access is wrapped behind a `BundleRepository`
interface. This is the same pattern ADR-003 specifies for the main app, and
building it here is part of the prototype value:

```typescript
interface BundleRepository {
  list(): Promise<Bundle[]>
  get(id: string): Promise<Bundle | undefined>
  save(bundle: Bundle): Promise<Bundle>   // create or update
  delete(id: string): Promise<void>
}
```

The MVP implementation uses Dexie. When publishing moves into the main Sail
Scoring application, the repository swaps to an API client — no component
code changes.

## Build configuration

Two environment variables, mirroring how bilge is configured in ADR-004:

```
NEXT_PUBLIC_BILGE_URL=https://bilge.vercel.app
NEXT_PUBLIC_BILGE_API_KEY=<shared key>
```

## Screens

### Bundle list (`/`)

- Lists all saved bundles: name, prefix, file count, last-published date
- "New bundle" button
- Tapping a bundle opens its detail view

### Create bundle (`/bundles/new`)

- Fields: name, prefix, email
- UUID is generated automatically and stored — not shown to the scorer
- **Prefix lookup:** as the scorer types the prefix, the app fetches
  `/l/{prefix}` from bilge and shows any results already published there.
  This lets the scorer confirm they are using the right namespace before
  committing, and spot squatted or conflicting prefixes early.
- On save, navigates to the bundle detail view

### Bundle detail (`/bundles/[id]`)

- Lists file entries: filename, derived slug, status badge, published URL
  (linked) when available
- **Add files:** `<input type="file" multiple accept=".html">` — for each
  selected file, a `FileEntry` is derived and added to the bundle (or matched
  to an existing entry by filename)
- **Publish button:** iterates entries that have a file selected and POSTs
  each to bilge `/upload`; updates entry status from the response
- Status badges: `unpublished` / `pending verification` / `published`
- **Export / Import** buttons (see below)
- Edit bundle name, prefix (prefix locked after first publish), email

## Publish flow

For each file entry with a file selected:

1. Read file contents as text
2. POST to `{BILGE_URL}/upload`:
   ```
   Authorization: Bearer {BILGE_API_KEY}
   Content-Type: application/json
   ```
   ```json
   {
     "uuid":  "...",
     "slug":  "hyc/autumn-2026/autumn-league-standings",
     "email": "scorer@example.com",
     "html":  "<html>...</html>"
   }
   ```
3. Handle responses:
   - `200 published` → set entry `status: 'published'`, store `publishedUrl`
   - `202 pending` → set entry `status: 'pending'`; show message to check email
   - `409 slug_conflict` → show error: slug owned by a different publisher
   - `413 too_large` → show error: file exceeds 512 KB
   - `401 unauthorized` → show error: API key problem (config issue)

After the scorer verifies their email and the first upload goes live, all
subsequent publishes from the same bundle respond with `200` immediately.

## Export and import

Bundles can be exported as a JSON file and imported on another device.

The export contains the full bundle (all fields including UUID) but no file
contents. On import, all entries are restored with their persisted status —
the scorer can then re-select files and re-publish.

Format: a single JSON object with a `version` field for forward compatibility:

```json
{
  "version": 1,
  "bundle": { ... }
}
```

No encryption. The export contains an email address and a list of slug names —
low sensitivity; not worth the complexity.

## What is not in scope

- **File System Access API** for persistent file handles across sessions.
  Requires re-selection on each visit. Acceptable for MVP.
- **Deletion / unpublishing** results. bilge has no delete endpoint — this
  requires direct Vercel Blob access by the operator.
- **Slug recovery.** If the verified email is lost, the slug is permanently
  locked in bilge. No mitigation at the client level.
- **Authentication.** Email + UUID is the bilge auth model. No login needed.

## Relationship to bilge

The bilge client is a thin consumer of the bilge upload API. The only coupling
is the upload endpoint contract described in ADR-004. The client does not
depend on bilge's internal implementation and can be developed independently.

## Retirement

The bilge client is retired when Sail Scoring ships its full-stack version and
publishing moves into the main application. At that point:

- Bilge (the backend) is taken offline per ADR-004's retirement plan.
- The bilge client Vercel project is deleted.
- Scorers migrate by exporting their bundle JSON and re-importing their
  configuration into the main application.
