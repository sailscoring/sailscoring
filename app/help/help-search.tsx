'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';

import { useShortcuts } from '@/hooks/use-keyboard-shortcut';
import { searchHelp } from '@/lib/help-search';
import type { HelpGroupDef } from './sections';
import { helpHrefForSection } from './sections';

/**
 * The search box over the help index (#613).
 *
 * Reported by a scorer who expected one: 62 sections across 10 chapters, and
 * the only way in was reading the index. It filters the chapter list rather
 * than replacing it — with the box empty the page is exactly what it was, so
 * nothing is taken away from someone who does know their way around.
 *
 * The groups are already narrowed per viewer, so a section this workspace
 * cannot see is not in the list being searched and cannot be found.
 */
export function HelpSearch({ groups }: { groups: HelpGroupDef[] }) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useShortcuts([
    {
      key: '/',
      description: 'Search help',
      section: 'Help',
      handler: () => inputRef.current?.focus(),
    },
  ]);

  const hits = useMemo(() => searchHelp(groups, query), [groups, query]);
  const searching = query.trim().length > 0;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help — try “discard”, “DNC”, “burgee”…"
          aria-label="Search help"
          data-testid="help-search"
          className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      {searching && (
        <div data-testid="help-search-results">
          {hits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing matches “{query.trim()}”. The search covers section titles and
              their keywords, not the text inside a chapter — so a word only used
              mid-chapter won’t be found here.
            </p>
          ) : (
            <nav className="space-y-1 text-sm">
              <p className="text-xs text-muted-foreground">
                {hits.length} section{hits.length === 1 ? '' : 's'}
              </p>
              {hits.map(({ group, section }) => (
                <div key={`${group.slug}-${section.id}`}>
                  <Link
                    href={helpHrefForSection(group.slug, section.id)}
                    className="hover:underline"
                  >
                    {section.title}
                  </Link>
                  <span className="ml-2 text-xs text-muted-foreground">{group.label}</span>
                </div>
              ))}
            </nav>
          )}
        </div>
      )}
    </div>
  );
}
