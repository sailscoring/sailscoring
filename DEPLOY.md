# Deploying Sail Scoring

## Overview

Sail Scoring Milestone 1 is a fully client-side web application. All data is stored in the browser's IndexedDB via Dexie.js. There is no server-side storage, no API functions, and no environment variables required.

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

None required for Milestone 1.

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

## Data persistence

All scoring data (series, competitors, races, finishes) is stored in IndexedDB in the scorer's browser. It persists across page reloads and browser restarts, but:

- Data is **not synced** across devices or browsers
- Clearing browser data will erase all scoring data
- There is no backup or export in Milestone 1 (planned for a future iteration)

For important events, the scorer should work from a single browser on a single device throughout the event.
