'use client';

import dynamic from 'next/dynamic';
import type { ComponentType } from 'react';

/**
 * Every chapter's content, loaded on demand.
 *
 * The chapter bodies come to about 2,700 lines of JSX between them. The
 * `/help/*` routes import their own directly, but the help panel is mounted
 * app-wide — so it reaches content through this map, and a chapter's chunk
 * is fetched the first time a reader opens it rather than riding along in
 * the shared bundle on every page.
 *
 * Keys are the slugs of `HELP_GROUPS` in ../sections, plus `introduction`
 * for the chapterless opening sections of /help.
 */
export const HELP_CONTENT: Record<string, ComponentType> = {
  introduction: dynamic(() => import('./introduction')),
  'running-a-series': dynamic(() => import('./running-a-series')),
  'entering-results': dynamic(() => import('./entering-results')),
  'scoring-correctness': dynamic(() => import('./scoring-correctness')),
  'rating-systems': dynamic(() => import('./rating-systems')),
  'reading-and-checking': dynamic(() => import('./reading-and-checking')),
  publishing: dynamic(() => import('./publishing')),
  'data-in-and-out': dynamic(() => import('./data-in-and-out')),
  'across-series': dynamic(() => import('./across-series')),
  collaboration: dynamic(() => import('./collaboration')),
  'for-the-technical': dynamic(() => import('./for-the-technical')),
};
