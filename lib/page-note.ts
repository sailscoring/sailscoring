/**
 * Explanatory notes on published pages (#511).
 *
 * A scorer sometimes has to say something on a results page that the figures
 * cannot say for themselves: that Tuesday's fleet assignment was computed
 * before a retirement was applied to Q1 and so does not reconcile with the
 * standings beside it; that Q4 was abandoned and resailed; that a
 * reconstructed archive differs from the originals in a stated way, with a
 * link to them. Sailwave scorers do this in the series and race comment
 * fields, and results readers know the convention.
 *
 * Two independent slots, both rendered, in a fixed order: `Series.seriesNote`
 * on every page of the publication, `Series.pageNotes` on one page each. Not
 * a default with per-page overrides — that shape has to answer how a page
 * suppresses the default, and the answer is always some flavour of "an
 * explicitly empty string", which nobody guesses.
 *
 * The text is plain, with the smallest formatting that covers the job:
 * paragraphs, `[label](url)` links, and bare URLs. Everything else is escaped.
 * Parsing happens once, here, into segments both the published HTML and the
 * in-app editor render — so the two cannot disagree about what a note says.
 */

import { escapeHtml } from './html';
import type { PageNote } from './types';

/** Bound on one note. Longer than a race's conditions note (500) because an
 *  editorial note carrying a link needs the room, short enough that a note
 *  stays a note rather than becoming the page. */
export const PAGE_NOTE_MAX_LENGTH = 1000;

/** Key of the lone results page of a single-fleet series. Reserved because
 *  that page's fleet name can be synthetic ("Default", "Unknown") and is
 *  therefore not a handle — the same reason `PublishedSeriesPage.isDefault`
 *  exists. `@` cannot begin a fleet name that publishing would key by. */
export const DEFAULT_PAGE_NOTE_KEY = '@default';

/** The identity of a page, as much of it as keying needs. Every built page
 *  (`FleetHtmlFile`) and every published one (`PublishedSeriesPage`) already
 *  carries these three fields. */
export interface NotePageRef {
  fleetName: string;
  isDefault?: boolean;
  subSeriesName?: string;
}

/**
 * The key a page's note is filed under: the same name-handle the publish
 * dialog, the publish handler and the URL-freeze machinery key pages by, so
 * a note and the page it prints on cannot drift apart. A fleet rename orphans
 * the note exactly as it orphans that fleet's frozen URL.
 */
export function pageNoteKey(page: NotePageRef): string {
  const leaf = page.isDefault ? DEFAULT_PAGE_NOTE_KEY : page.fleetName;
  return page.subSeriesName ? `${page.subSeriesName}/${leaf}` : leaf;
}

/** The note filed against a page, or '' when it carries none. */
export function pageNoteFor(
  notes: PageNote[] | undefined,
  page: NotePageRef,
): string {
  const key = pageNoteKey(page);
  return notes?.find((n) => n.page === key)?.text ?? '';
}

/**
 * The note list with `page`'s note set to `text` — appended, replaced, or (for
 * blank text) removed. Returns a new array; order is otherwise preserved, so
 * the list reads in the order notes were first written.
 */
export function withPageNote(
  notes: PageNote[] | undefined,
  page: NotePageRef,
  text: string,
  now: number = Date.now(),
): PageNote[] {
  const key = pageNoteKey(page);
  const rest = (notes ?? []).filter((n) => n.page !== key);
  const trimmed = text.trim();
  if (trimmed === '') return rest;
  const existing = (notes ?? []).find((n) => n.page === key);
  const entry: PageNote = { page: key, text: trimmed, updatedAt: now };
  if (!existing) return [...rest, entry];
  return (notes ?? []).map((n) => (n.page === key ? entry : n));
}

/** Notes filed against pages the series no longer builds — left in place
 *  rather than silently dropped, and surfaced once so they can be cleared. */
export function orphanedPageNotes(
  notes: PageNote[] | undefined,
  livePages: NotePageRef[],
): PageNote[] {
  const live = new Set(livePages.map(pageNoteKey));
  return (notes ?? []).filter((n) => !live.has(n.page));
}

/** How a note key reads back to a person, for the orphan list. */
export function describePageNoteKey(key: string): string {
  const slash = key.lastIndexOf('/');
  const leaf = slash === -1 ? key : key.slice(slash + 1);
  const block = slash === -1 ? '' : key.slice(0, slash);
  const name = leaf === DEFAULT_PAGE_NOTE_KEY ? 'the results page' : `“${leaf}”`;
  return block ? `${name} in ${block}` : name;
}

// ---- Text ----

/** A run of a paragraph: plain text, or a link with its label. */
export type NoteSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string };

export type NoteParagraph = NoteSegment[];

/** `[label](url)` first, then a bare URL or a bare `www.` host. The bare
 *  forms stop before trailing punctuation, so a URL ending a sentence does
 *  not swallow the full stop or a closing bracket. */
const LINK_RE =
  /\[([^\]\n]+)\]\(([^)\s]+)\)|((?:https?:\/\/|www\.)[^\s<]*[^\s<.,;:!?)\]}"'])/gi;

/** The href a link segment gets, or null when the target is not one this
 *  renderer is willing to emit. Only http(s) and mailto reach the page:
 *  a note is scorer-authored text on a public page, and anything else
 *  (`javascript:`, `data:`) has no legitimate use in one. A rejected target
 *  keeps its label as plain text rather than vanishing. */
function noteHref(raw: string): string | null {
  const url = raw.trim();
  if (/^www\./i.test(url)) return `https://${url}`;
  if (/^https?:\/\//i.test(url) || /^mailto:/i.test(url)) return url;
  return null;
}

/**
 * A note as paragraphs of segments. Every line break starts a new paragraph
 * and blank lines collapse: a scorer typing two lines means two lines, and
 * Markdown's "a single newline is a space" rule surprises everyone who has
 * not been told about it.
 */
export function parsePageNote(text: string): NoteParagraph[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map(parseNoteLine);
}

function parseNoteLine(line: string): NoteParagraph {
  const segments: NoteParagraph = [];
  let at = 0;
  const pushText = (s: string) => {
    if (s === '') return;
    const last = segments[segments.length - 1];
    if (last?.kind === 'text') last.text += s;
    else segments.push({ kind: 'text', text: s });
  };
  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(line)) !== null) {
    pushText(line.slice(at, match.index));
    at = match.index + match[0].length;
    const [label, target] = match[3] != null ? [match[3], match[3]] : [match[1], match[2]];
    const href = noteHref(target);
    if (href) segments.push({ kind: 'link', text: label, href });
    else pushText(match[0]);
  }
  pushText(line.slice(at));
  return segments;
}

/** A note as the paragraphs of a published page. Returns '' for a note with
 *  no content, so the caller can leave the block out entirely. */
export function renderPageNoteHtml(text: string): string {
  return parsePageNote(text)
    .map(
      (para) =>
        `<p>${para
          .map((seg) =>
            seg.kind === 'link'
              ? `<a href="${escapeHtml(seg.href)}" target="_top" rel="noopener">${escapeHtml(seg.text)}</a>`
              : escapeHtml(seg.text),
          )
          .join('')}</p>`,
    )
    .join('\n');
}
