/**
 * The shared public-page chrome for the whole `/p/...` surface (navy hero,
 * red accent, Poppins, the `Sail Scoring — sailscoring.ie` footer): listing
 * pages, tree indexes, the career arc, competitor and ranking pages all wrap
 * themselves in this so they read as one site. Split from the listing
 * renderers so the tree modules and the listing modules can both use it
 * without importing each other.
 */

import { escapeHtml as esc } from './html';

/** The sail-mark path, on the tightened `205 205 840 840` viewBox. */
const MARK_PATH =
  'M551,757.3c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-125.9,125.9c29.4-.8,58.5-.7,87.4.3l191.1-191.1c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-177.3,177.3c33.3,1.8,66.2,4.7,98.7,8.8l59.9-59.9c-5.6-11.7-3.5-26.2,6.2-35.9,12.4-12.4,32.4-12.4,44.7,0,12.4,12.4,12.4,32.4,0,44.7-9.7,9.7-24.2,11.8-35.9,6.2l-48.4,48.4c87.3,12.9,171.9,34.6,253.4,65.8-95.4-229.3-112.6-465-9.6-706L315.1,906.2c31.6-3.2,62.9-5.5,93.9-6.9l142.1-142Z';

/** Inline brand sail mark — self-contained (no external image). */
function markSvg(fill: string, size: number): string {
  return `<svg viewBox="205 205 840 840" width="${size}" height="${size}" aria-hidden="true" style="vertical-align:middle;"><path fill="${fill}" d="${MARK_PATH}"/></svg>`;
}

/** Self-contained SVG favicon (red sail mark as a data URI). */
const FAVICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="205 205 840 840"><path fill="#fb3a3b" d="${MARK_PATH}"/></svg>`,
)}">`;

/** Brand lockup for the hero: white sail mark + the "Sail Scoring" wordmark,
 *  side by side, linking to the brand site. */
function brandLockup(): string {
  return `<a class="brand" href="https://sailscoring.ie" target="_top" rel="noopener">${markSvg('#ffffff', 44)}<span class="brandname">Sail Scoring</span></a>`;
}

/** The workspace's own logo in the hero, on a white chip so any colourway stays
 *  legible on the navy background. Empty string when the workspace has no logo. */
function heroLogo(url: string): string {
  if (!url) return '';
  return `<div class="wslogo"><img src="${esc(url)}" alt=""></div>`;
}

const FOOTER = `<footer class="credit">${markSvg('#fb3a3b', 14)} Sail Scoring &mdash; <a href="https://sailscoring.ie" target="_top" rel="noopener">sailscoring.ie</a></footer>`;

const STYLE = `*{box-sizing:border-box;}
body { font-family: "Poppins", system-ui, -apple-system, "Segoe UI", Roboto, Arial, helvetica, sans-serif; margin: 0; background: #f4f6f8; color: #1a1a1a; }
.hero { background: #073358; color: #fff; padding: 32px 24px 28px; text-align: center; border-bottom: 4px solid #fb3a3b; }
.hero h1 { font-size: 1.7em; font-weight: 700; color: #fff; margin: 22px 0 0; }
/* Logos sit in a centred row with a generous gap. The lockup is vertically
   stacked — mark over wordmark — so it reads square next to the (usually
   squarish) workspace logo rather than as a wide banner. */
.hero .herologos { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: 40px; }
.hero .brand { display: inline-flex; flex-direction: column; align-items: center; gap: 8px; text-decoration: none; }
.hero .brandname { color: #fff; font-size: 1.15em; font-weight: 700; letter-spacing: 0.01em; }
.hero .brand:hover .brandname { text-decoration: underline; }
.hero .wslogo { display: inline-flex; align-items: center; justify-content: center; background: #fff; border-radius: 10px; padding: 12px 16px; box-shadow: 0 1px 3px rgba(0,0,0,0.18); }
.hero .wslogo img { display: block; height: 60px; width: auto; max-width: 260px; object-fit: contain; }
.content { max-width: 720px; margin: 28px auto 40px; padding: 0 20px; }
p.back { margin: 0 0 16px; font-size: 0.82em; }
p.back a { color: #073358; text-decoration: none; }
p.back a:hover { color: #fb3a3b; text-decoration: underline; }
p.browse { margin: 0 0 18px; font-size: 0.9em; font-weight: 600; }
p.browse a { color: #073358; text-decoration: none; }
p.browse a:hover { color: #fb3a3b; text-decoration: underline; }
ul.listing { list-style: none; padding: 0; margin: 16px 0; }
ul.listing li { background: #fff; border: 1px solid #e2e6ea; border-left: 4px solid transparent; border-radius: 8px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(7,51,88,0.06); transition: box-shadow .15s, border-color .15s, transform .1s; }
ul.listing li:hover { box-shadow: 0 4px 14px rgba(7,51,88,0.13); border-left-color: #fb3a3b; transform: translateY(-1px); }
ul.listing li a { display: block; padding: 16px 20px 18px; font-size: 1.15em; font-weight: 600; color: #073358; text-decoration: none; }
ul.listing .meta { display: block; color: #6b7280; font-size: 0.78em; font-weight: 400; margin-top: 6px; padding-bottom: 2px; }
/* Event rows (the workspace index, ADR-011): the event title links to its
   index, the page links beneath jump straight to a results table. */
ul.listing li a.evt { padding: 14px 20px 4px; }
ul.listing li a.evt:last-child { padding-bottom: 16px; }
ul.listing .pages { display: block; padding: 0 20px 14px; font-size: 0.85em; color: #6b7280; }
ul.listing .pages a { display: inline; padding: 0; font-size: 1em; font-weight: 500; color: #073358; }
ul.listing .pages a:hover { color: #fb3a3b; text-decoration: underline; }
h2.section { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.08em; color: #073358; font-weight: 700; margin: 28px 0 10px; }
h2.series { font-size: 1.15em; color: #073358; font-weight: 700; margin: 24px 0 8px; }
h3.subseries { font-size: 1.0em; color: #073358; font-weight: 700; margin: 20px 0 6px; }
h3.subseries a { color: inherit; text-decoration: none; }
h3.subseries a:hover { color: #fb3a3b; text-decoration: underline; }
h3.cat { font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.08em; color: #073358; font-weight: 700; margin: 20px 0 8px; }
details.season { border-top: 1px solid #e2e6ea; padding: 14px 0 6px; }
details.season summary { font-size: 1.2em; color: #073358; font-weight: 700; cursor: pointer; }
details.season summary:hover { color: #fb3a3b; }
.picker { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 20px; }
/* Stable flex widths, not content width: a select sizes to its widest option,
   so a fully-populated select would otherwise wrap the row and re-flow every
   time a filter changes the options. */
.picker select { font: inherit; font-size: 0.9em; padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; background: #fff; color: #073358; min-width: 0; }
.picker select:disabled { color: #94a3b8; }
.picker #picker-year, .picker #picker-cat { flex: 1 1 110px; }
.picker #picker-series { flex: 2 1 200px; }
p.empty { color: #6b7280; text-align: center; margin: 48px 0; }
footer.credit { text-align: center; color: #475569; font-size: 0.85em; padding: 22px 20px; border-top: 1px solid #e2e6ea; }
footer.credit a { color: #073358; text-decoration: none; }
footer.credit a:hover { color: #fb3a3b; text-decoration: underline; }`;

/**
 * The shared public-page chrome (navy hero, red accent, Poppins, the
 * `Sail Scoring — sailscoring.ie` footer). `extraCss` is appended after the
 * base stylesheet for page-specific rules.
 */
export function renderPublicShell(
  title: string,
  hero: string,
  body: string,
  extraCss = '',
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
${FAVICON}
<style type="text/css">
${STYLE}
${extraCss}
</style>
</head>
<body>
<header class="hero">${hero}</header>
<main class="content">
${body}
</main>
${FOOTER}
</body>
</html>`;
}

/** The standard hero: the brand lockup beside the workspace logo, then the
 *  heading. `headingHtml` is inserted as-is (callers escape their own text). */
export function renderPublicHero(headingHtml: string, logoUrl = ''): string {
  return `<div class="herologos">${brandLockup()}${heroLogo(logoUrl)}</div>\n<h1>${headingHtml}</h1>`;
}
