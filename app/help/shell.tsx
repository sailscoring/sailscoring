import Link from 'next/link';

import type { FeatureKey } from '@/lib/features';

import { HELP_GROUPS } from './sections';

export function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-4 space-y-3 bg-card border rounded-lg p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="space-y-2 text-muted-foreground leading-relaxed">{children}</div>
    </section>
  );
}

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
  const sections = group.sections.filter((s) => !s.feature || features.includes(s.feature));
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
