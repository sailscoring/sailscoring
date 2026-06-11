/**
 * HTML escaping, one definition. Two strictness levels because the existing
 * call sites genuinely differ and published output must stay byte-identical:
 * the results renderer and the published index escape four characters; the
 * auth emails also escape apostrophes.
 */

/** Escape the four characters that can break out of HTML text nodes and
 *  double-quoted attributes: & < > ". Apostrophes pass through — the
 *  published renderers never emit values into single-quoted attributes, and
 *  their output bytes must not change for existing inputs. */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** `escapeHtml` plus apostrophes (`'` → `&#39;`) — for contexts that may
 *  interpolate into single-quoted attributes, e.g. the auth emails. */
export function escapeHtmlAttr(str: string): string {
  return escapeHtml(str).replace(/'/g, '&#39;');
}
