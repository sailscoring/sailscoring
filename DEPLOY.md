# Deploying Sail Scoring

## Overview

Sail Scoring is currently a fully client-side web application. All scoring data is stored in the browser's IndexedDB via Dexie.js. The server backend (Postgres + Better Auth) is being introduced incrementally per [ADR-008](docs/design/decisions/008-full-stack-transition.md); Phase 1 wires up the database and authentication without changing the existing local-first flows.

Results publishing uses two separate services: [bilge](https://github.com/sailscoring/bilge) for direct HTTP publishing, and [scupper](https://github.com/sailscoring/scupper) for FTP relay. Environment variables for both must be set in Vercel.

Deployment is a single step: push to Vercel.

---

## Prerequisites

- [Vercel account](https://vercel.com)
- [Vercel CLI](https://vercel.com/docs/cli): `pnpm install -g vercel`
- Node 24.x
- pnpm 10

---

## First deployment

### 1. Install dependencies

```sh
pnpm install
```

### 2. Log in to Vercel

```sh
vercel login
```

### 3. Link the project

```sh
vercel link
```

Follow the prompts to create a new Vercel project or link to an existing one.

### 4. Deploy to production

```sh
pnpm run deploy:prod
```

This runs `vercel deploy --prod` and prints the production URL when complete.

---

## Subsequent deployments

```sh
pnpm run deploy:prod
```

---

## Preview deployments

```sh
pnpm run deploy
```

Deploys to a preview URL without affecting the production deployment.

---

## Local development

```sh
pnpm dev
```

Starts the Next.js dev server on `http://localhost:3000`. Hot reload is enabled. All data is stored in the local browser's IndexedDB and is not shared between tabs or browsers.

---

## Environment variables

### Bilge (results publishing)

HTML standings are published to the bilge service. Two `NEXT_PUBLIC_` variables must be set so the browser-side client can reach it.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_BILGE_URL` | Base URL of the deployed bilge service, no trailing slash (e.g. `https://bilge.sailscoring.ie`) |
| `NEXT_PUBLIC_BILGE_API_KEY` | Shared API key. Copy the value of `NEXT_PUBLIC_BILGE_API_KEY` from the bilge Vercel project's environment variables. |

Set them in the Vercel dashboard under **Settings → Environment Variables**, or via the CLI:

```sh
vercel env add NEXT_PUBLIC_BILGE_URL
vercel env add NEXT_PUBLIC_BILGE_API_KEY
```

Select **Production** (and **Preview** if you want publishing in preview deployments). Redeploy after adding them.

If either variable is absent, the Publish button will still appear but publishes will fail with a network error.

To debug bilge calls in the browser console:

```js
localStorage.setItem('bilge:debug', '1')
```

### Scupper (FTP publishing)

FTP results are relayed through the scupper service. Two `NEXT_PUBLIC_` variables must be set so the browser-side client can reach it.

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SCUPPER_URL` | Base URL of the deployed scupper service, no trailing slash (e.g. `https://scupper.sailscoring.ie`) |
| `NEXT_PUBLIC_SCUPPER_API_KEY` | Shared API key. Copy the value of `SCUPPER_API_KEY` from the scupper Vercel project's environment variables. |

Set them in the Vercel dashboard under **Settings → Environment Variables**, or via the CLI:

```sh
vercel env add NEXT_PUBLIC_SCUPPER_URL
vercel env add NEXT_PUBLIC_SCUPPER_API_KEY
```

Select **Production** (and **Preview** if you want FTP publishing in preview deployments). Redeploy after adding them.

If either variable is absent, the Upload via FTP button will still appear but uploads will fail with an HTTP error.

### Neon Postgres + Better Auth + Resend (ADR-008 Phase 1)

The server backend is provisioned through the Vercel Marketplace and Resend.
None of these variables are user-visible until later phases flip
`USE_SERVER_DATA=true`; provisioning them now establishes the dev/test/prod
loop.

#### 1. Provision Neon Postgres

In the Vercel dashboard, **Storage → Create Database → Neon (Marketplace)**.
Create separate branches for **Production**, **Preview**, and **Development**;
Vercel auto-injects `DATABASE_URL` per environment.

#### 2. Provision Resend

Create a Resend account, add `mail.sailscoring.ie` as a sending domain, and
copy the SPF/DKIM records to your DNS provider. Issue an API key scoped to
that domain.

#### 3. Set Vercel env vars

```sh
vercel env add DATABASE_URL          # already present from Neon integration
vercel env add BETTER_AUTH_SECRET    # value: openssl rand -base64 32
vercel env add BETTER_AUTH_URL       # https://app.sailscoring.ie (Production)
vercel env add RESEND_API_KEY
vercel env add EMAIL_FROM            # "Sail Scoring <noreply@mail.sailscoring.ie>"
```

For Preview deployments set `BETTER_AUTH_URL` to `https://$VERCEL_URL` — the
auth wiring also appends `process.env.VERCEL_URL` to `trustedOrigins`.

#### 4. Pull into `.env.local`

```sh
vercel env pull
```

#### 5. Migrate the database

```sh
pnpm db:migrate
```

`pnpm db:generate` regenerates `drizzle/*.sql` from the Drizzle schema.
`pnpm db:auth:generate` regenerates the Better Auth schema from
`lib/auth.ts`.

### Local development

Create a `.env.local` file at the project root (it is gitignored):

```
NEXT_PUBLIC_BILGE_URL=https://bilge.sailscoring.ie
NEXT_PUBLIC_BILGE_API_KEY=<key>
NEXT_PUBLIC_SCUPPER_URL=https://scupper.sailscoring.ie
NEXT_PUBLIC_SCUPPER_API_KEY=<key>
DATABASE_URL=postgres://...
BETTER_AUTH_SECRET=<openssl rand -base64 32>
BETTER_AUTH_URL=http://localhost:3000
RESEND_API_KEY=<optional in dev — leave blank to log magic links to console>
EMAIL_FROM="Sail Scoring <noreply@mail.sailscoring.ie>"
```

To debug scupper calls in the browser console:

```js
localStorage.setItem('scupper:debug', '1')
```

---

## Debug logging

To enable verbose client-side debug logging, open the browser DevTools console and run:

```js
localStorage.setItem('sailscoring:debug', '1')
```

Logs appear under the **Verbose** level in DevTools. Disable with:

```js
localStorage.removeItem('sailscoring:debug')
```

This setting is per-browser and requires no redeploy.

---

## Custom domain

To serve the app from `app.sailscoring.ie` instead of the auto-assigned Vercel URL:

1. In the Vercel dashboard open your project → **Settings** → **Domains**
2. Click **Add** and enter `app.sailscoring.ie`
3. Vercel will show a CNAME record to add. Add it at your DNS registrar:

   | Type  | Name  | Value                  |
   |-------|-------|------------------------|
   | CNAME | `app` | `cname.vercel-dns.com` |

4. Wait for DNS propagation (usually a few minutes). Vercel shows a green
   checkmark once it detects the record.

No environment variables need updating — the app is fully client-side and has
no server-side URLs to reconfigure.

---

## Data persistence

All scoring data (series, competitors, races, finishes) is stored in IndexedDB in the scorer's browser. It persists across page reloads and browser restarts, but:

- Data is **not synced** across devices or browsers
- Clearing browser data will erase all scoring data
- There is no backup or export in Milestone 1 (planned for a future iteration)

For important events, the scorer should work from a single browser on a single device throughout the event.
