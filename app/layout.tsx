import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';

import './globals.css';
import { Providers } from './providers';
import { getOptionalSession } from '@/lib/auth/require-session';
import { personalWorkspaceSlug } from '@/lib/auth/require-workspace';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import {
  WorkspaceSwitcher,
  type WorkspaceMembership,
} from '@/components/workspace-switcher';
import { WorkspaceMembershipsProvider } from '@/components/workspace-memberships-provider';
import { FeaturesProvider } from '@/components/features-provider';
import { computeEffectiveFeatures, type FeatureKey } from '@/lib/features';
import { UserMenu } from '@/components/user-menu';
import { StealthBetaBanner } from '@/components/stealth-beta-banner';
import { Footer } from '@/components/footer';

export const metadata: Metadata = {
  title: 'Sail Scoring',
  description: 'Sail race scoring',
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
      metadata: organization.metadata,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(member.createdAt);
  const memberships = rows.map((r) => ({
    organizationId: r.organizationId,
    name: r.name,
    slug: r.slug,
    role: r.role as WorkspaceMembership['role'],
  }));
  const sessionActiveId = session.session.activeOrganizationId ?? null;
  // Mirror requireWorkspace's bootstrap-pick: a fresh login has
  // activeOrganizationId=null on the session row, but the user's
  // personal workspace exists and every server request will resolve
  // to it. Reflect that in the switcher so the dropdown doesn't read
  // "Select workspace…" for a workspace the user is in fact already in.
  const personalSlug = personalWorkspaceSlug(session.user.id);
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
      <body>
        <Providers>
          <WorkspaceMembershipsProvider
            memberships={header?.memberships ?? []}
            activeOrganizationId={header?.activeOrganizationId ?? null}
          >
            <FeaturesProvider features={header?.features ?? []}>
            <header className="border-b px-6 py-3 flex items-baseline gap-3">
              <Link href="/" className="font-semibold hover:underline">
                Sail Scoring
              </Link>
              {header && (
                <WorkspaceSwitcher
                  memberships={header.memberships}
                  activeOrganizationId={header.activeOrganizationId}
                />
              )}
              <div className="ml-auto flex items-baseline gap-3">
                <Link
                  href="/help"
                  className="text-sm text-muted-foreground hover:underline"
                >
                  Help
                </Link>
                {header && (
                  <UserMenu
                    email={header.email}
                    feedbackEnabled={Boolean(process.env.FEEDBACK_TO)}
                  />
                )}
              </div>
            </header>
            {header && header.memberships.length === 1 && (
              <StealthBetaBanner />
            )}
            <main className="px-6 py-8">{children}</main>
            <Footer />
            </FeaturesProvider>
          </WorkspaceMembershipsProvider>
        </Providers>
      </body>
    </html>
  );
}
