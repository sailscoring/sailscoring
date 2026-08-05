/**
 * Shared query options for the workspace overview lists — the series list, its
 * categories, the recency strips, and the Trash.
 *
 * The app-wide defaults (`app/providers.tsx`) hold a 30s `staleTime` and no
 * focus refetching, which suits the editing surfaces: they mirror server rows
 * into local state, so an unasked-for refetch can visibly revert what the
 * scorer is typing. The overview lists have no such state — they only read —
 * and without a revalidation trigger a list fetched at an unlucky moment stays
 * wrong for as long as the page stays mounted. The staleTime expires and
 * nothing acts on it: the home list loaded while a duplicate is still being
 * written keeps showing the pre-copy list indefinitely (#366), as does a list
 * that a collaborator has since added a series to.
 *
 * So these lists refetch on every mount and whenever the tab regains focus.
 */
export const workspaceListOptions = {
  refetchOnMount: 'always',
  refetchOnWindowFocus: true,
} as const;
