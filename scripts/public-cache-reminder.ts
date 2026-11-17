/**
 * What an operator script prints after writing something `/p` shows. Run
 * from a terminal, the script can't purge the CDN itself (see
 * `scripts/purge-public-cache.ts`), and the pages it changed would otherwise
 * stay cached for up to the CDN lifetime.
 */
export function publicCacheReminder(workspaceIds: Iterable<string>): string | null {
  const ids = [...new Set(workspaceIds)];
  if (ids.length === 0) return null;
  return (
    'If this ran against production, the public pages are still cached. Drop them with:\n' +
    `  pnpm public-cache:purge:prod ${ids.join(' ')}`
  );
}

export function printPublicCacheReminder(workspaceIds: Iterable<string>): void {
  const message = publicCacheReminder(workspaceIds);
  if (message) console.error(message);
}
