import type { Metadata } from 'next';
import Link from 'next/link';
import { Poppins } from 'next/font/google';
import { and, eq, inArray } from 'drizzle-orm';

import './globals.css';

// Brand body font, matching sailscoring.ie. Audiowide (brand display face) is
// reserved for the logo, not running text.
const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});
import { Providers } from './providers';
import { getOptionalSession } from '@/lib/auth/require-session';
import {
  isPersonalWorkspaceSlug,
  personalWorkspaceSlug,
} from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import { member, organization, user } from '@/lib/db/schema/auth';
import {
  WorkspaceSwitcher,
  type WorkspaceMembership,
} from '@/components/workspace-switcher';
import { WorkspaceMembershipsProvider } from '@/components/workspace-memberships-provider';
import { FeaturesProvider } from '@/components/features-provider';
import { HelpPanelFrame } from '@/components/help-panel/frame';
import { HelpPanelProvider } from '@/components/help-panel/provider';
import { HelpToggle } from '@/components/help-panel/toggle';
import { computeEffectiveFeatures, type FeatureKey } from '@/lib/features';
import { UserMenu } from '@/components/user-menu';
import { ThemeToggle } from '@/components/theme-toggle';
import { PersonalWorkspaceBanner } from '@/components/personal-workspace-banner';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Sail Scoring',
  description: 'Sail race scoring',
  metadataBase: new URL('https://app.sailscoring.ie'),
};

interface HeaderState {
  memberships: WorkspaceMembership[];
  activeOrganizationId: string | null;
  email: string;
  features: FeatureKey[];
}

async function loadHeaderState(): Promise<HeaderState | null> {
  const session = await getOptionalSession();
  if (!session) return null;
  const rows = await getDb()
    .select({
      organizationId: member.organizationId,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
      logo: organization.logo,
      metadata: organization.metadata,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(member.createdAt);
  const personalSlug = personalWorkspaceSlug(session.user.id);
  // Every personal workspace is stored as "My Workspace", which is right for
  // its owner and useless for anyone else: an operator who joins someone's
  // personal workspace to help with a support question ends up with two rows
  // reading the same thing, and the role line under them doesn't tell them
  // apart either. Someone else's personal workspace carries its owner
  // instead, resolved here rather than stored, so the owner still sees theirs
  // as "My Workspace" — which is what the help docs describe.
  const foreignPersonal = rows
    .filter((r) => isPersonalWorkspaceSlug(r.slug) && r.slug !== personalSlug)
    .map((r) => r.organizationId);
  const ownerByOrg = new Map<string, string>();
  if (foreignPersonal.length > 0) {
    const owners = await getDb()
      .select({
        organizationId: member.organizationId,
        userId: user.id,
        name: user.name,
        email: user.email,
      })
      .from(member)
      .innerJoin(user, eq(member.userId, user.id))
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(
        and(
          inArray(member.organizationId, foreignPersonal),
          eq(member.role, 'owner'),
        ),
      );
    for (const o of owners) {
      // The slug shape is only a prefilter. Confirm against the owner's own
      // id, so a club workspace that happens to be slugged like one is never
      // renamed out from under its members.
      const [row] = rows.filter((r) => r.organizationId === o.organizationId);
      if (row?.slug !== personalWorkspaceSlug(o.userId)) continue;
      ownerByOrg.set(o.organizationId, o.name.trim() || o.email);
    }
  }
  const memberships = rows.map((r) => ({
    organizationId: r.organizationId,
    name: ownerByOrg.has(r.organizationId)
      ? `${ownerByOrg.get(r.organizationId)} — personal`
      : r.name,
    slug: r.slug,
    role: r.role as WorkspaceMembership['role'],
    logo: r.logo ?? '',
  }));
  const sessionActiveId = session.session.activeOrganizationId ?? null;
  // Mirror requireWorkspace's bootstrap-pick: a fresh login has
  // activeOrganizationId=null on the session row, but the user's
  // personal workspace exists and every server request will resolve
  // to it. Reflect that in the switcher so the dropdown doesn't read
  // "Select workspace…" for a workspace the user is in fact already in.
  const resolvedActive =
    (sessionActiveId &&
      memberships.find((m) => m.organizationId === sessionActiveId)
        ?.organizationId) ||
    (memberships.length === 1
      ? memberships[0].organizationId
      : (memberships.find((m) => m.slug === personalSlug)?.organizationId ??
        null));
  // Effective feature set for the active workspace (Model B, #155), computed
  // from the same memberships query the switcher already needs.
  const activeSlug = rows.find((r) => r.organizationId === resolvedActive)?.slug;
  const features = activeSlug
    ? computeEffectiveFeatures(
        activeSlug,
        rows.map((r) => ({ slug: r.slug, metadata: r.metadata })),
      )
    : [];
  return {
    memberships,
    activeOrganizationId: resolvedActive,
    email: session.user.email,
    features,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const header = await loadHeaderState();
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={poppins.className}>
        <Providers>
          <WorkspaceMembershipsProvider
            memberships={header?.memberships ?? []}
            activeOrganizationId={header?.activeOrganizationId ?? null}
          >
            <FeaturesProvider features={header?.features ?? []}>
            <HelpPanelProvider>
            <HelpPanelFrame>
            <div className="h-[3px] bg-brand-red" />
            <header className="border-b px-6 py-3 flex items-center gap-3">
              <Link
                href="/"
                aria-label="Sail Scoring — home"
                className="flex items-center"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/sail-scoring-wordmark.svg"
                  alt="Sail Scoring"
                  className="h-[22px] w-auto"
                />
              </Link>
              {header && (
                <WorkspaceSwitcher
                  memberships={header.memberships}
                  activeOrganizationId={header.activeOrganizationId}
                />
              )}
              <div className="ml-auto flex items-center gap-3">
                <HelpToggle />
                <ThemeToggle />
                {header && (
                  <UserMenu
                    email={header.email}
                    feedbackEnabled={Boolean(process.env.FEEDBACK_TO)}
                  />
                )}
              </div>
            </header>
            {header && header.memberships.length === 1 && (
              <PersonalWorkspaceBanner />
            )}
            <main className="px-6 py-8 bg-muted min-h-[70vh]">{children}</main>
            <Footer />
            </HelpPanelFrame>
            </HelpPanelProvider>
            </FeaturesProvider>
          </WorkspaceMembershipsProvider>
        </Providers>
      </body>
    </html>
  );
}
