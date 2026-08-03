'use client';

import { useEffect } from 'react';

import { helpPathForSection } from './sections';

/** Old deep links into the single-page help (/help#redress) forward to the
 *  section's chapter. Landing-page anchors resolve to null and stay put.
 *  A hard replace, not a router navigation: this only ever runs for stale
 *  external links, and it must land on the anchor reliably. */
export function HashRedirect() {
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const path = helpPathForSection(id);
    if (path) window.location.replace(`${path}#${id}`);
  }, []);
  return null;
}
