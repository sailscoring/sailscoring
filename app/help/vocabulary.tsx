'use client';

/**
 * Which split-fleet vocabulary a help reader sees.
 *
 * Championship sailing instructions use two sets of stage words that borrow
 * each other's terms for different stages (see `Vocabulary` in
 * `lib/split-fleets.ts`), and a series picks one. Help chapters are not
 * series-scoped, so the section that explains championships has to work out
 * whose words to speak. In order:
 *
 *   1. what the reader picked on the section's own control;
 *   2. `?vocab=` on the /help page, so a link from a series carries its words;
 *   3. the series on the screen the help panel is sitting beside;
 *   4. the reader's remembered pick from an earlier visit;
 *   5. the default.
 *
 * Only an explicit pick is remembered: a link or a series never overwrite
 * what the reader chose for themselves.
 */

import { usePathname } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { useFeatures } from '@/components/features-provider';
import { useSplitFleetState } from '@/hooks/use-split-fleets';
import {
  DEFAULT_VOCABULARY,
  VOCABULARIES,
  parseVocabularyKey,
  type Vocabulary,
  type VocabularyKey,
} from '@/lib/split-fleets';

const STORAGE_KEY = 'sailscoring:help-vocabulary';

export type HelpVocabularySource = 'choice' | 'url' | 'series' | 'stored' | 'default';

export interface HelpVocabularyValue {
  key: VocabularyKey;
  vocab: Vocabulary;
  source: HelpVocabularySource;
  choose: (key: VocabularyKey) => void;
}

const HelpVocabularyContext = createContext<HelpVocabularyValue | null>(null);

/** The series id in a /series/:id/… path — series ids are UUIDs, which keeps
 *  the other /series/ routes (new, import) from being mistaken for one. */
function seriesIdFromPath(pathname: string): string | null {
  const match = /^\/series\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i.exec(
    pathname,
  );
  return match ? match[1] : null;
}

export function HelpVocabularyProvider({
  initial,
  children,
}: {
  /** The vocabulary the URL asked for, where the reader arrived by a link. */
  initial?: VocabularyKey | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { has } = useFeatures();

  // The series beside the panel. Gated on the feature so nobody without
  // championships pays for the request; on the Split Fleets tab itself the
  // cache is already warm and it costs nothing.
  const seriesId = seriesIdFromPath(pathname ?? '');
  const seriesState = useSplitFleetState(seriesId ?? '', {
    enabled: seriesId !== null && has('split-fleets'),
  });
  const seriesConfig = seriesId !== null ? seriesState.data?.config : null;
  // A tabulated vocabulary only: an override is words the toggle cannot
  // name, so the section falls back to what the reader would otherwise see.
  const seriesKey =
    seriesConfig && !seriesConfig.vocabularyOverride
      ? parseVocabularyKey(seriesConfig.vocabulary ?? DEFAULT_VOCABULARY)
      : null;

  const [choice, setChoice] = useState<VocabularyKey | null>(null);
  const [stored, setStored] = useState<VocabularyKey | null>(null);

  // Storage is unreadable during SSR, so the remembered pick can only be
  // restored post-hydration.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      setStored(parseVocabularyKey(localStorage.getItem(STORAGE_KEY)));
    } catch {
      // An unavailable store just means nothing to restore.
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const choose = useCallback((key: VocabularyKey) => {
    setChoice(key);
    setStored(key);
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // Private-mode storage failures are not worth surfacing.
    }
  }, []);

  const value = useMemo<HelpVocabularyValue>(() => {
    const [key, source]: [VocabularyKey, HelpVocabularySource] = choice
      ? [choice, 'choice']
      : initial
        ? [initial, 'url']
        : seriesKey
          ? [seriesKey, 'series']
          : stored
            ? [stored, 'stored']
            : [DEFAULT_VOCABULARY, 'default'];
    return { key, vocab: VOCABULARIES[key], source, choose };
  }, [choice, initial, seriesKey, stored, choose]);

  return <HelpVocabularyContext.Provider value={value}>{children}</HelpVocabularyContext.Provider>;
}

/** The vocabulary the help around this component speaks. Outside a provider
 *  it is the default, and choosing does nothing — a section rendered
 *  somewhere new degrades to the static prose it used to be. */
export function useHelpVocabulary(): HelpVocabularyValue {
  const value = useContext(HelpVocabularyContext);
  return (
    value ?? {
      key: DEFAULT_VOCABULARY,
      vocab: VOCABULARIES[DEFAULT_VOCABULARY],
      source: 'default',
      choose: () => {},
    }
  );
}
