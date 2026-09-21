'use client';

import { useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';

import { searchHelp } from '@/lib/help-search';
import type { HelpGroupDef } from '@/app/help/sections';

/**
 * The same search over the panel's index (#613).
 *
 * The panel navigates by calling `showChapter`, not by following a link, so
 * the results are buttons here where the page's are anchors — landing on a
 * section costs nothing new either way, since the panel already scrolls to
 * the anchor it is given.
 */
export function PanelSearch({
  groups,
  onOpen,
}: {
  groups: HelpGroupDef[];
  onOpen: (slug: string, sectionId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => searchHelp(groups, query), [groups, query]);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help…"
          aria-label="Search help"
          data-testid="help-panel-search"
          className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      {searching && (
        <div data-testid="help-panel-search-results" className="space-y-1 text-sm">
          {hits.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              Nothing matches. The search covers section titles and keywords, not the
              text inside a chapter.
            </p>
          ) : (
            hits.map(({ group, section }) => (
              <div key={`${group.slug}-${section.id}`}>
                <button
                  type="button"
                  onClick={() => onOpen(group.slug, section.id)}
                  className="text-left hover:underline"
                >
                  {section.title}
                </button>
                <span className="ml-2 text-xs text-muted-foreground">{group.label}</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
