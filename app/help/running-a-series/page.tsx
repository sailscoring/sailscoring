import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import { parseVocabularyKey } from '@/lib/split-fleets';
import { FeaturesProvider } from '@/components/features-provider';

import ChapterContent from '../content/running-a-series';
import { HelpShell } from '../shell';
import { HelpVocabularyProvider } from '../vocabulary';

export const metadata: Metadata = {
  title: 'Running a series — Help — Sail Scoring',
};

// Per-user dynamic (#155): gated sections only render for viewers whose
// workspace has the feature enabled.
export const dynamic = 'force-dynamic';

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ vocab?: string | string[] }>;
}) {
  const [features, { vocab }] = await Promise.all([getEffectiveFeatures(), searchParams]);
  return (
    <HelpShell slug="running-a-series" features={features}>
      {/* Re-provided so the client-rendered sections gate on exactly the
          feature set the server built the TOC from. */}
      <FeaturesProvider features={features}>
        {/* A link from a championship carries its vocabulary, so the
            split-fleet section opens in the reader's own words. */}
        <HelpVocabularyProvider initial={parseVocabularyKey(vocab)}>
          <ChapterContent />
        </HelpVocabularyProvider>
      </FeaturesProvider>
    </HelpShell>
  );
}
