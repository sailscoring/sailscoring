'use client';

import { useEffect } from 'react';

/**
 * Keeps the Record finishes page working with no signal, for workspaces
 * with finishes by voice: registers the service worker that serves the page,
 * its data and the listening engine from the phone when the network doesn't
 * answer (`public/voice/sw.js`). Its scope is this page and nothing else.
 * Renders nothing.
 */
export function VoiceOffline() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/voice/sw.js', { scope: '/workspace/record' }).catch(() => {
      // Without it the page still works; it just needs a signal to open.
    });
  }, []);
  return null;
}
