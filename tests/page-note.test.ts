/**
 * Published-page notes (#511). The keying matters because a note that keys
 * differently from the page it prints on would drift away from it; the text
 * rendering matters because a note is scorer-typed text going onto a public
 * page.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_PAGE_NOTE_KEY,
  describePageNoteKey,
  orphanedPageNotes,
  pageNoteFor,
  pageNoteKey,
  parsePageNote,
  renderPageNoteHtml,
  withPageNote,
} from '@/lib/page-note';
import type { PageNote } from '@/lib/types';

describe('the page key', () => {
  it('is the fleet name, as publishing keys pages', () => {
    expect(pageNoteKey({ fleetName: 'Puppeteers HPH' })).toBe('Puppeteers HPH');
  });

  it('is reserved for the lone results page, whose fleet name may be synthetic', () => {
    expect(pageNoteKey({ fleetName: 'Unknown', isDefault: true })).toBe(DEFAULT_PAGE_NOTE_KEY);
    expect(pageNoteKey({ fleetName: 'Default', isDefault: true })).toBe(DEFAULT_PAGE_NOTE_KEY);
  });

  it('carries the sub-series, so a block series files one note per block', () => {
    expect(pageNoteKey({ fleetName: 'Class 1', subSeriesName: 'Spring' })).toBe('Spring/Class 1');
    expect(pageNoteKey({ fleetName: 'x', isDefault: true, subSeriesName: 'Spring' })).toBe(
      `Spring/${DEFAULT_PAGE_NOTE_KEY}`,
    );
  });

  it('reads back to a person', () => {
    expect(describePageNoteKey('Prizes')).toBe('“Prizes”');
    expect(describePageNoteKey(DEFAULT_PAGE_NOTE_KEY)).toBe('the results page');
    expect(describePageNoteKey('Spring/Class 1')).toBe('“Class 1” in Spring');
  });
});

describe('writing a note', () => {
  const page = { fleetName: 'Fleet assignments' };

  it('appends the first one, trimmed and stamped', () => {
    const notes = withPageNote(undefined, page, '  Assigned before the Q1 retirement.  ', 1000);
    expect(notes).toEqual([
      { page: 'Fleet assignments', text: 'Assigned before the Q1 retirement.', updatedAt: 1000 },
    ]);
  });

  it('replaces in place, so the list keeps its order', () => {
    const start = withPageNote(withPageNote(undefined, { fleetName: 'A' }, 'a', 1), page, 'b', 2);
    const next = withPageNote(start, { fleetName: 'A' }, 'a2', 3);
    expect(next.map((n) => n.page)).toEqual(['A', 'Fleet assignments']);
    expect(next[0]).toEqual({ page: 'A', text: 'a2', updatedAt: 3 });
  });

  it('removes the entry when the text is cleared', () => {
    const start = withPageNote(undefined, page, 'gone soon', 1);
    expect(withPageNote(start, page, '   ', 2)).toEqual([]);
  });

  it('reads back against the page, and empty against any other', () => {
    const notes = withPageNote(undefined, page, 'note', 1);
    expect(pageNoteFor(notes, page)).toBe('note');
    expect(pageNoteFor(notes, { fleetName: 'Prizes' })).toBe('');
    expect(pageNoteFor(undefined, page)).toBe('');
  });
});

describe('notes whose page is gone', () => {
  it('are the ones keying to no page the series builds', () => {
    const notes: PageNote[] = [
      { page: 'Class 1', text: 'a', updatedAt: 1 },
      { page: 'Class 2 (renamed away)', text: 'b', updatedAt: 1 },
    ];
    expect(orphanedPageNotes(notes, [{ fleetName: 'Class 1' }, { fleetName: 'Prizes' }])).toEqual([
      { page: 'Class 2 (renamed away)', text: 'b', updatedAt: 1 },
    ]);
  });
});

describe('note text', () => {
  it('makes a paragraph of every line, dropping the blank ones', () => {
    expect(parsePageNote('One\n\n\nTwo\n')).toEqual([
      [{ kind: 'text', text: 'One' }],
      [{ kind: 'text', text: 'Two' }],
    ]);
  });

  it('links a labelled target', () => {
    expect(parsePageNote('See [the originals](https://results.hyc.ie/x) for more.')).toEqual([
      [
        { kind: 'text', text: 'See ' },
        { kind: 'link', text: 'the originals', href: 'https://results.hyc.ie/x' },
        { kind: 'text', text: ' for more.' },
      ],
    ]);
  });

  it('links a bare URL without swallowing the sentence it ends', () => {
    expect(parsePageNote('Originals at https://results.hyc.ie/x.')).toEqual([
      [
        { kind: 'text', text: 'Originals at ' },
        { kind: 'link', text: 'https://results.hyc.ie/x', href: 'https://results.hyc.ie/x' },
        { kind: 'text', text: '.' },
      ],
    ]);
  });

  it('gives a bare www host a scheme', () => {
    expect(parsePageNote('www.hyc.ie')).toEqual([
      [{ kind: 'link', text: 'www.hyc.ie', href: 'https://www.hyc.ie' }],
    ]);
  });

  it('keeps a target it will not emit as plain text', () => {
    expect(parsePageNote('[click](javascript:alert(1))')).toEqual([
      [{ kind: 'text', text: '[click](javascript:alert(1))' }],
    ]);
  });

  it('escapes what a scorer types', () => {
    expect(renderPageNoteHtml('Sui 214 <b>retired</b> & the split stands')).toBe(
      '<p>Sui 214 &lt;b&gt;retired&lt;/b&gt; &amp; the split stands</p>',
    );
  });

  it('renders paragraphs and links', () => {
    expect(renderPageNoteHtml('Corrected 16:40.\nSee [why](https://x.test/a?b=1&c=2).')).toBe(
      '<p>Corrected 16:40.</p>\n' +
        '<p>See <a href="https://x.test/a?b=1&amp;c=2" target="_top" rel="noopener">why</a>.</p>',
    );
  });

  it('is empty for a note with nothing in it', () => {
    expect(renderPageNoteHtml('   \n  ')).toBe('');
  });
});
