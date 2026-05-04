import type { Metadata } from 'next';
import Link from 'next/link';
import { eq } from 'drizzle-orm';

import './globals.css';
import { Providers } from './providers';
import { USE_SERVER_DATA } from '@/lib/flags';
import { getOptionalSession } from '@/lib/auth/require-session';
import { getDb } from '@/lib/db/client';
import { member, organization } from '@/lib/db/schema/auth';
import {
  WorkspaceSwitcher,
  type WorkspaceMembership,
} from '@/components/workspace-switcher';

export const metadata: Metadata = {
  title: 'Sail Scoring',
  description: 'Sail race scoring',
};

interface HeaderState {
  memberships: WorkspaceMembership[];
  activeOrganizationId: string | null;
}

async function loadHeaderState(): Promise<HeaderState | null> {
  if (!USE_SERVER_DATA) return null;
  const session = await getOptionalSession();
  if (!session) return null;
  const rows = await getDb()
    .select({
      organizationId: member.organizationId,
      name: organization.name,
      slug: organization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(member.organizationId, organization.id))
    .where(eq(member.userId, session.user.id))
    .orderBy(member.createdAt);
  return {
    memberships: rows.map((r) => ({
      organizationId: r.organizationId,
      name: r.name,
      slug: r.slug,
      role: r.role as WorkspaceMembership['role'],
    })),
    activeOrganizationId: session.session.activeOrganizationId ?? null,
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
        <Providers useServerData={USE_SERVER_DATA}>
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
            <Link
              href="/settings"
              className="text-sm text-muted-foreground hover:underline"
            >
              Settings
            </Link>
            <Link
              href="/help"
              className="text-sm text-muted-foreground hover:underline"
            >
              Help
            </Link>
          </header>
          <main className="px-6 py-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
