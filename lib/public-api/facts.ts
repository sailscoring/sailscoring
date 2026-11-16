import 'server-only';

import {
  getPublishedGroupByWorkspaceSlug,
  getPublishedSeasonTree,
  getWorkspaceBySlug,
} from '../published-repository';
import { publicationPath, seasonLikeSlug } from '../published-tree';
import { tidySponsors } from '../series-sponsors';
import type { PublicationSummary, PublishedSeriesPage, SeriesSponsor } from '../types';
import { fleetKey, type PublicationFacts } from './published-view';

/**
 * A publication's own facts, as its API resource restates them on every
 * publish: its name, where it sits in the publication tree, and which of its
 * pages to land on. Placed by the same rules as the workspace `index.json`,
 * so the two agree about where a publication is.
 */
export async function publicationFacts(args: {
  workspaceSlug: string;
  slug: string;
  seriesId: string | null;
  name: string;
  kind: PublicationFacts['kind'];
  status: PublicationFacts['status'];
  pages: Pick<PublishedSeriesPage, 'fleetName' | 'subPath' | 'isAuxiliary' | 'isPrizes' | 'isEntryList' | 'isNamedPage'>[];
  dataSubPath: string | null;
  summary: PublicationSummary | null;
  publishedAt: number;
  /** The season the publish files the publication under, when it says. */
  season?: string | null;
  /** The series' sponsors and trophy donors. */
  sponsors?: readonly SeriesSponsor[];
}): Promise<PublicationFacts> {
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? '').replace(/\/$/, '');
  const workspace = await getWorkspaceBySlug(args.workspaceSlug);
  const base = `${origin}/p/${args.workspaceSlug}`;
  const [tree, group] = workspace
    ? await Promise.all([
        getPublishedSeasonTree(workspace.id),
        getPublishedGroupByWorkspaceSlug(workspace.id, args.slug),
      ])
    : [{ seasons: [], undated: [] }, []];
  const treeSeason = tree.seasons.find((s) => s.folders.some((f) => f.slug === args.slug))?.label;
  const others = group.filter((p) => p.seriesId !== args.seriesId);
  const slugShared = others.length > 0 || tree.seasons.some((s) => s.segment === args.slug);
  return {
    name: args.name,
    kind: args.kind,
    status: args.status,
    workspace: { slug: args.workspaceSlug, name: workspace?.name ?? args.workspaceSlug, url: base },
    season: treeSeason ?? args.season ?? (seasonLikeSlug(args.slug) ? args.slug : null),
    page: `${base}/${publicationPath(args.slug, args.pages, slugShared)}`,
    data: args.dataSubPath ? `${base}/${args.slug}/${args.dataSubPath}` : null,
    publishedAt: new Date(args.publishedAt).toISOString(),
    fleets: (args.summary?.fleets ?? []).map((f) => ({
      key: fleetKey(f.name),
      name: f.name,
      scoringSystem: f.scoringSystem ?? null,
    })),
    ...(() => {
      const sponsors = tidySponsors(args.sponsors ? [...args.sponsors] : []).map((s) => ({
        ...s,
        // A library logo is stored site-relative (`/logos/{id}`); an app
        // reading the API is not on this site.
        ...(s.logoUrl ? { logoUrl: absoluteUrl(origin, s.logoUrl) } : {}),
      }));
      return sponsors.length > 0 ? { sponsors } : {};
    })(),
  };
}

function absoluteUrl(origin: string, url: string): string {
  return /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
}
