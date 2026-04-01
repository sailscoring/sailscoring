# Deploying Sail Scoring

## Overview

Sail Scoring is a fully client-side web application. All scoring data is stored in the browser's IndexedDB via Dexie.js. There is no server-side storage or API.

FTP results publishing is relayed via [scupper](https://github.com/sailscoring/scupper), a separate service. Two environment variables must be set in Vercel for FTP publishing to work.

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

### Local development

Create a `.env.local` file at the project root (it is gitignored):

```
NEXT_PUBLIC_SCUPPER_URL=https://scupper.sailscoring.ie
NEXT_PUBLIC_SCUPPER_API_KEY=<key>
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
