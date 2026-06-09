import { redirect } from 'next/navigation';

/**
 * The per-series Activity tab was merged into the History tab (#166): History
 * is the single per-series surface, with the activity entries shown as the
 * drill-down under each revision. This redirect keeps old links/bookmarks
 * working.
 */
export default async function ActivityRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/series/${id}/history`);
}
