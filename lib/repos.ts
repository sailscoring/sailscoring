'use client';

/**
 * Repo context — kept temporarily as a thin pass-through during the
 * USE_SERVER_DATA removal. Phase B inlines `lib/api-repository`
 * directly at every call site and deletes this file.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';

import * as api from './api-repository';

export type Repos = typeof api;

const RepoContext = createContext<Repos | null>(null);

export function RepoProvider({ children }: { children: ReactNode }) {
  return createElement(RepoContext.Provider, { value: api }, children);
}

export function useRepos(): Repos {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useRepos must be used inside <RepoProvider>');
  }
  return ctx;
}

/** @deprecated — always true now; will be removed in Phase B. */
export function useServerMode(): boolean {
  return true;
}
