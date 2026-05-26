'use client';

import { createContext, useContext } from 'react';

/**
 * Read-only state for the current series (#154). An archived series is
 * read-only: the layout provides `true`, and edit affordances across the
 * series tabs disable themselves off this context. The server is the real
 * guard (writes to an archived series 423) — this is the UX layer that keeps
 * scorers from attempting edits that would only bounce.
 */
const SeriesReadOnlyContext = createContext(false);

export function SeriesReadOnlyProvider({
  readOnly,
  children,
}: {
  readOnly: boolean;
  children: React.ReactNode;
}) {
  return (
    <SeriesReadOnlyContext.Provider value={readOnly}>
      {children}
    </SeriesReadOnlyContext.Provider>
  );
}

export function useSeriesReadOnly(): boolean {
  return useContext(SeriesReadOnlyContext);
}
