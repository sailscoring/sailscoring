import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { FeatureKey } from '@/lib/features';

import { HELP_GROUPS, visibleSections } from './sections';

/** The frame every help chapter shares: heading, blurb, and a TOC of the
 *  chapter's sections filtered to the viewer's effective features. */
export function HelpShell({
  slug,
  features,
  children,
}: {
  slug: string;
  features: FeatureKey[];
  children: React.ReactNode;
}) {
  const group = HELP_GROUPS.find((g) => g.slug === slug);
  if (!group) throw new Error(`unknown help group: ${slug}`);
  const sections = visibleSections(group, features);
  // A chapter whose every section is gated off for this viewer doesn't exist
  // for them — the landing index skips it too (see app/help/page.tsx).
  if (sections.length === 0) notFound();
  return (
    <div className="max-w-2xl mx-auto space-y-10">
      <div>
        <p className="text-sm">
          <Link href="/help" className="text-muted-foreground hover:text-foreground hover:underline">
            ← Help
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-semibold">{group.label}</h1>
        <p className="mt-2 text-muted-foreground">{group.blurb}</p>
      </div>

      <nav className="text-sm space-y-1">
        <p className="font-medium text-foreground">On this page</p>
        {sections.map((s) => (
          <div key={s.id}>
            <Link href={`#${s.id}`} className="text-muted-foreground hover:text-foreground hover:underline">
              {s.title}
            </Link>
          </div>
        ))}
      </nav>

      {children}
    </div>
  );
}
