'use client';

/**
 * ADR-008 Phase 3: runtime selection of the data backend.
 *
 * `USE_SERVER_DATA` is read in a Server Component (app/layout.tsx) and
 * passed into the client RepoProvider. Components consume `useRepos()`
 * instead of importing dexie-repository or api-repository directly.
 * That keeps both backends compilable in the same build and lets e2e
 * runs flip the flag to exercise either path.
 *
 * Lint enforcement (added by the lockdown commit) bans direct `db.`
 * imports outside `lib/dexie-repository.ts`.
 */
import { createContext, createElement, useContext, type ReactNode } from 'react';

import * as api from './api-repository';
import * as dexie from './dexie-repository';

export type Repos = typeof dexie;

interface RepoContextValue {
  repos: Repos;
  serverMode: boolean;
}

const RepoContext = createContext<RepoContextValue | null>(null);

export function RepoProvider({
  useServerData,
  children,
}: {
  useServerData: boolean;
  children: ReactNode;
}) {
  const value: RepoContextValue = {
    repos: useServerData ? api : dexie,
    serverMode: useServerData,
  };
  return createElement(RepoContext.Provider, { value }, children);
}

export function useRepos(): Repos {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useRepos must be used inside <RepoProvider>');
  }
  return ctx.repos;
}

/** Phase 5 migration UX needs to know whether the runtime backend is the
 *  API (server mode) or Dexie. Other callers stay on `useRepos()`. */
export function useServerMode(): boolean {
  const ctx = useContext(RepoContext);
  if (!ctx) {
    throw new Error('useServerMode must be used inside <RepoProvider>');
  }
  return ctx.serverMode;
}
