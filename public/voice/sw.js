// The service worker for recording finishes by voice (ADR-017): it lets the
// Record finishes page open, and the listening engine load, with no signal.
//
// Registered only for workspaces with the feature, with the scope
// /workspace/record, so it sees that page's requests and no other page's.
// Nothing here changes what the page gets while there is a signal: every
// request for the page or its data goes to the network first, and the copy
// kept from last time is used only when the network doesn't answer.
//
//   the engine and its model   kept once, served from the phone ever after
//   the app's own scripts      the same: their names change when they do
//   the page, and what it reads   network first; last time's copy without one
//
// Writes are never touched: a sheet submitted with no signal fails, and the
// page keeps it and sends it later.

// The engine's cache is shared with the page, which fills it, and the
// recogniser's worker, which reads the model from it.
const ENGINE = 'voice-engine-v1';
const STATIC = 'voice-static-v1';
const PAGES = 'voice-pages-v1';
const PAGE = '/workspace/record';
/** How long to wait on a network that is there in name only, before
 *  showing last time's copy instead. */
const NETWORK_WAIT_MS = 5000;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

async function kept(cacheName, request, options) {
  const cache = await caches.open(cacheName);
  return cache.match(request, options);
}

async function keep(cacheName, key, response) {
  // Only what the page itself was given: never a redirect to the sign-in
  // page, an error, or part of a file.
  if (!response.ok || response.status !== 200 || response.redirected || response.type !== 'basic') return;
  const cache = await caches.open(cacheName);
  await cache.put(key, response.clone());
}

/** Files that never change under one name: the phone's copy, else the network. */
async function fromPhoneFirst(cacheName, request) {
  const hit = await kept(cacheName, request.url);
  if (hit) return hit;
  const response = await fetch(request);
  await keep(cacheName, request.url, response).catch(() => undefined);
  return response;
}

/**
 * The network's answer, kept for next time. Without one, last time's: when
 * the network fails, or when it is taking so long that it may as well have.
 * A slow answer is never cut off, only overtaken; where there is no copy
 * from last time, the network is waited for however long it takes.
 */
async function fromNetworkFirst(event, request, key) {
  const network = fetch(request).then(async (response) => {
    await keep(PAGES, key, response).catch(() => undefined);
    return response;
  });
  const hit = await kept(PAGES, key);
  if (!hit) return network;
  // Let a slow answer finish and be kept, whoever is served meanwhile.
  event.waitUntil(network.catch(() => undefined));
  const tooSlow = new Promise((resolve) => setTimeout(() => resolve(null), NETWORK_WAIT_MS));
  try {
    return (await Promise.race([network, tooSlow])) ?? hit;
  } catch {
    return hit;
  }
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  const path = url.pathname;

  if (path.startsWith('/voice/engine/') && !path.endsWith('/manifest.json')) {
    event.respondWith(fromPhoneFirst(ENGINE, request));
    return;
  }
  if (path.startsWith('/_next/static/')) {
    event.respondWith(fromPhoneFirst(STATIC, request));
    return;
  }
  // The page. Which race it shows is read from the address by the page's
  // own script, so one kept copy opens any race.
  if (request.mode === 'navigate') {
    if (path === PAGE) event.respondWith(fromNetworkFirst(event, request, PAGE));
    return;
  }
  // The router's own requests for a page are left to fail with no signal:
  // it then loads the page the ordinary way, which the line above answers.
  if (request.headers.has('rsc') || request.headers.has('next-router-prefetch')) return;
  // Sound is never kept by this worker: the recording has its own storage.
  if (path.startsWith('/api/v1/voice/')) return;
  if (path.startsWith('/api/') || path.startsWith('/voice/')) {
    // The list of races is asked for by date, and the dates move on each
    // day: without a signal, yesterday's list is better than none.
    const key = path === '/api/v1/races' ? path : path + url.search;
    event.respondWith(fromNetworkFirst(event, request, key));
    return;
  }
  // Fonts, icons and the like.
  if (request.destination === 'font' || request.destination === 'image' || request.destination === 'style' || request.destination === 'worklet') {
    event.respondWith(fromNetworkFirst(event, request, path + url.search));
  }
});
