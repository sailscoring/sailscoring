'use client';

// The series landing page: a split-fleet series lands on its Split Fleets tab
// (the workflow and the standings view); everything else lands on
// Competitors. Client-side so the decision reads the same split-fleet state
// the layout has already fetched — no extra round trip.

import { use, useEffect } from 'react';
import { useRouter } from 'next/navigation';

import { SeriesTabFallback } from '@/components/series-tab-fallback';
import { useFeatures } from '@/components/features-provider';
import { useSplitFleetState } from '@/hooks/use-split-fleets';

export default function SeriesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { has } = useFeatures();
  const showSplitFleets = has('split-fleets');
  const { data: sfState } = useSplitFleetState(id, { enabled: showSplitFleets });

  const resolved = !showSplitFleets || sfState !== undefined;
  const target = showSplitFleets && sfState?.config ? 'split-fleets' : 'competitors';

  useEffect(() => {
    if (resolved) router.replace(`/series/${id}/${target}`);
  }, [resolved, target, id, router]);

  return <SeriesTabFallback status="loading" />;
}
