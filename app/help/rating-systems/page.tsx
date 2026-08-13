import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import { FeaturesProvider } from '@/components/features-provider';

import ChapterContent from '../content/rating-systems';
import { HelpShell } from '../shell';

export const metadata: Metadata = {
  title: 'Rating and handicap systems — Help — Sail Scoring',
};

// Per-user dynamic (#155): gated sections only render for viewers whose
// workspace has the feature enabled.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const features = await getEffectiveFeatures();
  return (
    <HelpShell slug="rating-systems" features={features}>
      {/* Re-provided so the client-rendered sections gate on exactly the
          feature set the server built the TOC from. */}
      <FeaturesProvider features={features}>
        <ChapterContent />
      </FeaturesProvider>
    </HelpShell>
  );
}
