import type { Metadata } from 'next';
import Link from 'next/link';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';

import Introduction from './content/introduction';
import { HashRedirect } from './hash-redirect';
import { visibleGroups } from './sections';

export const metadata: Metadata = {
  title: 'Help — Sail Scoring',
};

// Per-user dynamic (#155): the index only lists an experimental feature's
// sections for viewers whose workspace has it enabled. Signed-out /
// no-feature viewers (getEffectiveFeatures returns []) see only the
// ungated entries.
export const dynamic = 'force-dynamic';

export default async function HelpPage() {
  const features = await getEffectiveFeatures();
  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <HashRedirect />
      <div>
        <h1 className="text-2xl font-semibold">Help</h1>
        <p className="mt-2 text-muted-foreground">
          A guide to scoring a series with Sail Scoring, in short chapters —
          start at the top, or jump straight to a section.
        </p>
      </div>

      <nav className="text-sm space-y-6">
        {visibleGroups(features).map((group) => (
          <div key={group.slug} className="space-y-1">
            <p className="font-medium text-foreground">
              <Link href={`/help/${group.slug}`} className="hover:underline">
                {group.label}
              </Link>
            </p>
            {group.sections.map((s) => (
              <div key={s.id}>
                <Link
                  href={`/help/${group.slug}#${s.id}`}
                  className="text-muted-foreground hover:text-foreground hover:underline"
                >
                  {s.title}
                </Link>
              </div>
            ))}
          </div>
        ))}
      </nav>

      <Introduction />
    </div>
  );
}
