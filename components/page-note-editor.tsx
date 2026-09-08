'use client';

/**
 * Writing a note that goes on a published page (#511).
 *
 * The same editor in both places a note is written: the preview, where the
 * page it prints on is in view, and the publish dialog, where the scorer
 * already is when the note is about to go out. It stays small deliberately —
 * a note is a sentence or two, and anything larger invites an essay onto a
 * results page.
 */

import { useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  PAGE_NOTE_MAX_LENGTH,
  pageNoteFor,
  pageNoteKey,
  parsePageNote,
  withPageNote,
  type NotePageRef,
} from '@/lib/page-note';
import type { Series } from '@/lib/types';

/** A note as its reader will meet it — the same parse the published HTML
 *  uses, so the two cannot disagree about what the text says. */
export function PageNoteText({ text, className }: { text: string; className?: string }) {
  const paragraphs = parsePageNote(text);
  return (
    <div className={className}>
      {paragraphs.map((para, i) => (
        <p key={i} className="[&+p]:mt-1">
          {para.map((seg, j) =>
            seg.kind === 'link' ? (
              <a
                key={j}
                href={seg.href}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                {seg.text}
              </a>
            ) : (
              <span key={j}>{seg.text}</span>
            ),
          )}
        </p>
      ))}
    </div>
  );
}

export interface PageNoteEditorProps {
  /** The note as it stands; '' for a page that carries none. */
  value: string;
  /** Save the trimmed text. An empty string removes the note. */
  onSave: (text: string) => void;
  onCancel: () => void;
  /** What the note is on, for the field's label and placeholder. */
  label: string;
  placeholder?: string;
  /** When the note was last written, shown so a note from three days ago is
   *  recognised as one before it goes out again. */
  updatedAt?: number;
}

export function PageNoteEditor({
  value,
  onSave,
  onCancel,
  label,
  placeholder,
  updatedAt,
}: PageNoteEditorProps) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    // Caret at the end: the common edit is adding to what is already there.
    const len = ref.current?.value.length ?? 0;
    ref.current?.setSelectionRange(len, len);
  }, []);

  const changed = text.trim() !== value.trim();

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/40 p-2" data-testid="page-note-editor">
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(text.trim());
        }}
        rows={3}
        maxLength={PAGE_NOTE_MAX_LENGTH}
        aria-label={`Note on ${label}`}
        data-testid="page-note-text"
        placeholder={placeholder ?? 'What a reader of this page needs to know'}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
      <div className="flex items-center gap-2">
        <p className="flex-1 text-xs text-muted-foreground">
          Plain text. Links become links.
          {updatedAt != null && value.trim() !== '' && (
            <> Written {new Date(updatedAt).toLocaleString()}.</>
          )}
        </p>
        <span className="text-xs tabular-nums text-muted-foreground">
          {text.length}/{PAGE_NOTE_MAX_LENGTH}
        </span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => onSave(text.trim())} disabled={!changed}>
          Save
        </Button>
      </div>
    </div>
  );
}

/**
 * The note strip above the preview: what this page will carry, and the way
 * in to changing it.
 *
 * The preview is the honest place to write a note — it enumerates exactly the
 * pages the build produces, and shows each one as its reader will meet it, so
 * the note is typed and then watched landing in the page. The series note
 * appears here too, read-only until asked for: seeing the whole of what this
 * page will say is the point, and it would be a poor showing to have to leave
 * the page to find half of it.
 */
export function PageNoteStrip({
  series,
  page,
  pageLabel,
  onSave,
}: {
  series: Pick<Series, 'seriesNote' | 'pageNotes'>;
  page: NotePageRef;
  /** How the page is named in the picker above — the note's label. */
  pageLabel: string;
  onSave: (patch: (s: Series) => Partial<Series>) => void;
}) {
  const [editing, setEditing] = useState<'page' | 'series' | null>(null);
  const pageNote = pageNoteFor(series.pageNotes, page);
  const seriesNote = series.seriesNote ?? '';
  const noteEntry = (series.pageNotes ?? []).find((n) => n.page === pageNoteKey(page));

  const savePageNote = (text: string) => {
    onSave((s) => ({ pageNotes: withPageNote(s.pageNotes, page, text) }));
    setEditing(null);
  };

  return (
    <div className="space-y-1.5 text-sm" data-testid="page-note-strip">
      {editing === 'series' ? (
        <PageNoteEditor
          value={seriesNote}
          label="every page"
          placeholder="Something every page of this publication should say"
          onSave={(text) => {
            onSave(() => ({ seriesNote: text }));
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        seriesNote.trim() !== '' && (
          <div className="flex items-start gap-2 text-xs text-muted-foreground">
            <span className="shrink-0 font-medium">Every page:</span>
            <PageNoteText text={seriesNote} className="min-w-0 flex-1" />
            <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2" onClick={() => setEditing('series')}>
              Edit
            </Button>
          </div>
        )
      )}

      {editing === 'page' ? (
        <PageNoteEditor
          value={pageNote}
          label={pageLabel}
          updatedAt={noteEntry?.updatedAt}
          onSave={savePageNote}
          onCancel={() => setEditing(null)}
        />
      ) : pageNote.trim() === '' ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>No note on this page.</span>
          <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing('page')}>
            Add a note
          </Button>
          {seriesNote.trim() === '' && (
            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditing('series')}>
              Add one to every page
            </Button>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">On this page:</span>
          <PageNoteText text={pageNote} className="min-w-0 flex-1 text-xs" />
          <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2" onClick={() => setEditing('page')}>
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2"
            onClick={() => savePageNote('')}
          >
            Remove
          </Button>
        </div>
      )}
    </div>
  );
}
