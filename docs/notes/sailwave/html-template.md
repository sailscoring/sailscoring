# Sailwave HTML Results Template

Analysis of the Sailwave-generated HTML results files from HYC 2025
(`~/projects/sailwave/reshyc/backups/results.hyc.ie/reshyc/2025/`, ~121 `.htm` files).
Reference for issue #13 (local HTML export) and the results rendering pipeline.

## Common structure

Every file follows this skeleton:

```
<!doctype html>
<head>
  <meta ...> (see variants below)
  <title>Sailwave results for {event} at {venue} {year}</title>
  <style>...</style>            ← identical CSS, inlined
  <script>swGetURLArgs()</script>
  <script src="jquery 2.1.3 from Google CDN"></script>
  <script>HighlightWins JS (see variants)</script>
  [optional favicon link]
</head>
<body>
  <header></header>             ← always empty
  <table class="headertable">  ← 3-col: left logo | h1+h2 | right logo
  <div style="clear:both;"></div>
  <style>div.applicant-break {page-break-after:always;}</style>  ← print style, in body
  [optional <h3 class="seriestitle">Results are provisional as of HH:MM on Month D, YYYY</h3>]
  [one or more fleet sections:]
    <h3 class="summarytitle" id="summary{fleet_id}">{Fleet Name}</h3>
    <div class="caption summarycaption">Sailed: N, Discards: N, To count: N, [Rating system: X,] Entries: N, Scoring system: Appendix A</div>
    <table class="summarytable">...</table>
  [one or more race sections:]
    <h3 class="racetitle" id="r{n}{fleet_id}">{Race label} - {Fleet Name}&nbsp;-&nbsp;{Date}</h3>
    [<div class="caption racecaption">Start: ..., Finishes: ..., Time: ...</div>]
    <table class="racetable">...</table>
  <p class="hardleft"><a href="..."></a><br/><a href="mailto:..."></a></p>
  <p class="hardright"><a href="..."></a><br/><a href="mailto:..."></a></p>
  <p>Sailwave Scoring Software {version}<br/><a href="https://www.sailwave.com">...</a></p>
  <footer></footer>             ← always empty
  <div id="scrollbottom"></div>
</body>
```

## Built-in Sailwave styles

Sailwave ships 26 named styles. Each style is a pure CSS file in `Styles/*.htm`
(no HTML wrapper). Sailwave inlines the chosen style's CSS into every exported
results file. The style choice has no effect on the HTML structure — only the
visual appearance changes.

**HYC uses UK Windsurfing Association.** This is confirmed by comparing the CSS
block extracted from HYC's 2025 results files against the Sailwave style files:
the layout rules (`body`, `table`, `td, th`, `.caption`, `.hardleft/.hardright`,
`.odd`) match UK WA exactly and do not match any other style.

### Style comparison: notable differences

| Style | `th` background | Row tint | Borders | Font |
|-------|----------------|----------|---------|------|
| **UK Windsurfing Association** | none (plain) | `.odd #eef` only | `#999` grey solid | 80% arial |
| Default | none (plain) | none | `#999` grey solid | 80% arial |
| Default plus | `#ddd` grey | none | `#999` grey solid | 80% arial |
| Blue Blocks | `#aaf` blue | `.even #bbf` / `.odd #ddf` | `#fff` white solid | 72% arial |
| Navy Blocks | `navy` | `.even/.odd navy` (white text) | `#fff` white solid | 72% arial |
| The blues | `#0055aa` + yellow text | `.even #ccccff` | none | 72% arial |
| Red Head | `#cc0000` + white text | `.even #d7d7d7` | none | 72% arial |
| Grey days | `#bbb` | `.even #d7d7d7` | none | 80% arial |
| Faded lines | none | none | bottom-only `#999` | 80% arial |
| Jet black | none | none | `#eee` on black background | 80% arial |

The styles are cosmetic-only. None change the HTML class names or table
structure that our renderer emits. UK WA is a minimal, high-legibility style —
plain header cells, a single light-blue `.odd` row tint, grey borders — which
is why it reads well for dense results tables.

**`table.headertable` override.** Every Sailwave export (regardless of style)
appends two extra rules after the style CSS:

```css
table.headertable {border: 0px;}
table.headertable td{border: 0px;}
```

These are not in the UK WA style file; Sailwave adds them unconditionally. Our
renderer includes them explicitly.

### UK Windsurfing Association — full CSS

```css
body {font: 80% arial, helvetica, sans-serif; text-align: center;}
.hardleft  {text-align: left; float: left;  margin: 15px 0  15px 25px;}
.hardright {text-align: right; float: right; margin: 15px 25px 15px 0;}
table {text-align: left; margin: 0px auto 30px auto; font-size: 1em; border-collapse: collapse; border: 1px #999 solid;}
td, th {padding: 4px; border: 1px #999 solid; vertical-align: top;}
.caption {padding: 5px; text-align: center; border: 0; font-weight: bold;}
p {text-align: center;}
.contents {text-align: left; margin-left: 20%;}
.race {background-color: #eee;}
.odd {background-color: #eef;}
.natflag {border: 1px #999 solid;}
.nattext {font-size: 0.8em;}
.place1 {font-weight: bold; background-color: #ffffaa;}
.place2 {font-weight: bold; background-color: #aaaaff;}
.place3 {font-weight: bold; background-color: #ffaaaa;}
.placen {}
```

---

## CSS inlined in every file (UK WA + Sailwave base)

The CSS inlined into HYC's Sailwave files is the UK Windsurfing Association
style above, plus the unconditional `headertable` override Sailwave appends:

```css
body {font: 80% arial, helvetica, sans-serif; text-align: center;}
.hardleft  {text-align: left; float: left;  margin: 15px 0  15px 25px;}
.hardright {text-align: right; float: right; margin: 15px 25px 15px 0;}
table {text-align: left; margin: 0px auto 30px auto; font-size: 1em; border-collapse: collapse; border: 1px #999 solid;}
td, th {padding: 4px; border: 1px #999 solid; vertical-align: top;}
.caption {padding: 5px; text-align: center; border: 0; font-weight: bold;}
p {text-align: center;}
.contents {text-align: left; margin-left: 20%;}
.race {background-color: #eee;}
.odd {background-color: #eef;}
.natflag {border: 1px #999 solid;}
.nattext {font-size: 0.8em;}
.place1 {font-weight: bold; background-color: #ffffaa;}
.place2 {font-weight: bold; background-color: #aaaaff;}
.place3 {font-weight: bold; background-color: #ffaaaa;}
.placen {}
table.headertable {border: 0px;}
table.headertable td{border: 0px;}
```

## Table structures

### Summary table (series standings)

```html
<table class="summarytable" cellspacing="0" cellpadding="0" border="0">
<colgroup span="N">
  <col class="rank" />
  <col class="sailno" />
  <col class="boat" />        <!-- sometimes absent (dinghy scratch) -->
  <col class="helmname" />
  <col class="club" />        <!-- open/offshore only -->
  <col class="rating" />      <!-- handicap only -->
  <col class="race" />        <!-- repeated per race -->
  <col class="total" />
  <col class="nett" />        <!-- absent when discards=0 on some files -->
</colgroup>
<thead>
  <tr class="titlerow">
    <th>Rank</th>
    <th>Sail</th>  <!-- or "SailNo" or "Sail Nr" -->
    ...
    <th><a class="racelink" href="#r{n}{fleet_id}">R{n}</a></th>  <!-- or "R1 Jul 23" or full name -->
    <th>Total</th>
    <th>Nett</th>
  </tr>
</thead>
<tbody>
  <tr class="odd summaryrow">   <!-- alternates odd/even -->
    <td>1st</td>
    <td>1840</td>
    ...
    <td class="rank1">1.0</td>  <!-- new template: rank class on td -->
    <!-- OR plain <td>1.0</td>  old template: class added by JS at runtime -->
    ...
    <td>5.0</td>   <!-- Total -->
    <td>5.0</td>   <!-- Nett -->
  </tr>
</tbody>
```

Discard notation: score wrapped in parens: `(6.0 DNC)` or `(2.0)`.
Result codes appended with space: `"5.0 DNC"`, `"11.0 DNF"`.

### Race table — handicap (time-based)

```html
<colgroup>
  <col class="rank" />
  <col class="sailno" />
  <col class="boat" />
  <col class="helmname" />
  <col class="club" />        <!-- open/offshore only -->
  <col class="rating" />
  <col class="start" />
  <col class="finish" />
  <col class="elapsed" />
  <col class="corrected" />
  <col class="points" />      <!-- sometimes absent in single-race events -->
</colgroup>
```

DNF/DNS rows: start/finish/corrected cells contain `&nbsp;`, elapsed cell contains the code.

### Race table — scratch (position-based)

```html
<colgroup>
  <col class="rank" />
  <col class="sailno" />
  <col class="helmname" />
  <col class="place" />
  <col class="points" />
</colgroup>
```

No time columns at all. `Finishes: Place` in racecaption.

## Two template variants

### Old template (Sailwave 2.37.xx, mostly club series files)
- No `<html>` tag
- Cache: `<meta http-equiv="Cache-control" content="no-cache">`
- No favicon
- Burgee `<img>` elements have no `id` attribute
- Uses **HighlightWins3 v1.6 + HighlightDiscards v1.1** (both scripts present)

### New template (Sailwave 2.38.xx, open/offshore/event files)
- `<html lang="en-US">`
- `<meta http-equiv="Content-Type" content="text/html;charset=ISO-8859-1"/>`
- Full cache headers: `no-cache, no-store, must-revalidate` + Pragma + Expires: 0
- `<link rel="shortcut icon" href="https://www.sailwave.com/favicon.ico"/>`
- Burgee images have `id="venueburgee"` and `id="eventburgee"`
- Uses **HighlightWins3v3 only** (no HighlightDiscards)

The new template is the target for our implementation.

## Highlight effects: what the JS does and how to reproduce it

### HighlightWins3v3 (new template)

The Sailwave template emits `class="rank1"`, `class="rank2"`, `class="rank3"` directly on
summary table `<td>` elements for 1st, 2nd, 3rd-placed scores. The script applies background
colours to those cells, skipping cells that contain result codes:

```javascript
var ignoreText = /^(?!.*\b(DNC|DNF|DNS|OCS|BFD|UFD|RET|DSQ|DGM|DNE)\b).*/i

$(selectorRank1).filter(fn).css("background", '#ffd700');  // gold
$(selectorRank2).filter(fn).css("background", '#6a91c5');  // steel blue
$(selectorRank3).filter(fn).css("background", '#da6841');  // burnt orange
```

A `rank1` cell showing `"11.0 DNC"` gets no gold background — the result code overrides
the podium highlight.

**How to reproduce without JS:** The classes are already on the `<td>` elements at render
time. Add CSS rules, and only emit the rank class when the score is not a result code:

```css
td.rank1 { background: #ffd700; }
td.rank2 { background: #6a91c5; }
td.rank3 { background: #da6841; }
```

**Note on style vs JS colours.** UK WA (and every other Sailwave style) also defines
`.place1/2/3` CSS rules with paler colours (`#ffffaa`, `#aaaaff`, `#ffaaaa`). These were
used by the old template, which emitted `class="place1"` on cells. In the new template,
cells carry `class="rank1"` instead, so the UK WA `.place1` rule never fires — only the
JS-applied `#ffd700` etc. colours are visible. Our static `td.rank1/2/3` CSS replicates
the JS runtime behaviour exactly.

### HighlightWins3 v1.6 + HighlightDiscards v1.1 (old template)

**HighlightWins3 v1.6:**
1. Scans `document.getElementsByTagName('col')` to find indices of `<col class="race">` elements
2. Uses jQuery `:nth-child(n)` to add `.summaryrace` class to the corresponding `<td>` cells in `.summarytable tbody`
3. Colours `.summaryrace` cells whose text matches `/\b1\.0/`, `/\b2\.0/`, `/\b3\.0/` — same colours as v3

**HighlightDiscards v1.1:**
1. Same column detection (code duplicated)
2. Finds `.summaryrace` cells whose text matches `/\b\)/` (discard notation `(n.n)`)
3. Sets their background to `#f2f2f2` (light grey)

The discard highlight runs second and overrides the win highlight — a discarded 1st
place `(1.0)` becomes grey, not gold. Correct behaviour.

**How to reproduce without JS:** Use a `.discard` class emitted at render time:

```css
td.rank1 { background: #ffd700; }
td.rank2 { background: #6a91c5; }
td.rank3 { background: #da6841; }
td.discard { background: #f2f2f2; }
/* discard overrides rank via source order; or use td.discard.rank1 if needed */
```

## Variable content per file

| Element | Notes |
|---------|-------|
| Left header image | URL + alt text. Most files: HYC logo. Lambay: HYC + Kinetica sponsor. |
| Right header image | URL + alt text. Most files: HYC logo. Lambay: race-specific sponsor. |
| H1 | Event name |
| H2 | Fleet/venue subtitle |
| Provisional timestamp | Optional. "Results are provisional as of HH:MM on Month D, YYYY". ~13/121 files omit it (published as final). |
| Fleet sections | 1 or more per file. Each: title, caption metadata, column list, rows. |
| Race sections | 1 or more per file. Each: title + anchor ID, optional caption, column list, rows. |
| Footer links | Usually empty `href=""` and `mailto:""` — club/scorer contact placeholders. |
| Sailwave version | In footer paragraph. |

Multiple fleets per file: all summary tables come first, then all race tables.

## Scoring display details

- Summary rank: ordinal string — "1st", "2nd", "3rd", "4th" ...
- Race rank: integer — 1, 2, 3 ...
- Points: decimal (`"1.0"`) even for scratch in most files; some scratch files use integers (`"1"`)
- Result codes: appended to points with a space — `"5.0 DNC"`, `"11.0 DNF"`
- Discards: score and code wrapped in parens — `"(6.0 DNC)"`, `"(2.0)"`
- Race column header links: `<a class="racelink" href="#r1class_1_hph">R1</a>`. Earlier completed races in a long series sometimes rendered as plain text with no `<a>`.
