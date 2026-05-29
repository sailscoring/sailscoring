#!/usr/bin/env python3
"""Convert the Irish Sailing IRC & ECHO ratings page to CSV.

Source: https://www.sailing.ie/Racing/Racing-Services/Echo-IRC-Ratings

The page is a DotNetNuke site that server-renders the *entire* national
ratings list into a single HTML table (`<table id="dt">`). DataTables.js
provides client-side search / sort / paginate / CSV+Excel export on top, but
there is no API, JSON endpoint, or server-side download — one GET of the page
returns the complete dataset. This script fetches that page (or reads a saved
copy) and writes the `#dt` table out as CSV, which is exactly the data the
page's own "CSV" button serialises from the DOM.

stdlib only — no third-party dependencies.

Usage:
    python3 fetch_irc_echo_ratings.py                  # fetch live -> irc-echo-ratings.csv
    python3 fetch_irc_echo_ratings.py -o out.csv       # choose output path
    python3 fetch_irc_echo_ratings.py --html page.html # parse a saved page instead of fetching
"""

from __future__ import annotations

import argparse
import csv
import sys
import urllib.request
from html.parser import HTMLParser
from pathlib import Path

URL = "https://www.sailing.ie/Racing/Racing-Services/Echo-IRC-Ratings"
TABLE_ID = "dt"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"
DEFAULT_OUTPUT = Path(__file__).with_name("irc-echo-ratings.csv")


class RatingsTableParser(HTMLParser):
    """Extract the `<thead>`/`<tbody>` cells of the table with id == TABLE_ID."""

    def __init__(self, table_id: str) -> None:
        super().__init__(convert_charrefs=True)
        self.table_id = table_id
        self.header: list[str] = []
        self.rows: list[list[str]] = []

        self._in_table = False
        self._table_depth = 0  # nested-table guard
        self._in_thead = False
        self._in_row = False
        self._in_cell = False
        self._cell_parts: list[str] = []
        self._current_row: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "table":
            if not self._in_table and attr.get("id") == self.table_id:
                self._in_table = True
                self._table_depth = 1
            elif self._in_table:
                self._table_depth += 1
            return
        if not self._in_table:
            return
        if tag == "thead":
            self._in_thead = True
        elif tag == "tr":
            self._in_row = True
            self._current_row = []
        elif tag in ("td", "th"):
            self._in_cell = True
            self._cell_parts = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "table" and self._in_table:
            self._table_depth -= 1
            if self._table_depth == 0:
                self._in_table = False
            return
        if not self._in_table:
            return
        if tag == "thead":
            self._in_thead = False
            # The Irish Sailing markup puts <th> cells directly inside <thead>
            # with no <tr> wrapper, so the <tr> close never commits the header.
            if not self.header and self._current_row:
                self.header = self._current_row
                self._current_row = []
        elif tag in ("td", "th"):
            self._in_cell = False
            self._current_row.append("".join(self._cell_parts).strip())
        elif tag == "tr":
            self._in_row = False
            if not self._current_row:
                return
            if self._in_thead or (not self.header and not self.rows):
                # First row (in thead, or the leading row if there's no thead)
                # is the header.
                if not self.header:
                    self.header = self._current_row
            else:
                self.rows.append(self._current_row)

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_parts.append(data)


def load_html(html_path: str | None) -> str:
    if html_path:
        return Path(html_path).read_text(encoding="utf-8", errors="replace")
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (trusted URL)
        raw = resp.read()
    return raw.decode("utf-8", errors="replace")


def parse_ratings(html: str) -> tuple[list[str], list[list[str]]]:
    parser = RatingsTableParser(TABLE_ID)
    parser.feed(html)
    if not parser.header:
        raise SystemExit(
            f"Could not find table id=\"{TABLE_ID}\" — the page layout may have changed."
        )
    # Normalise ragged rows to the header width.
    width = len(parser.header)
    rows = [(r + [""] * width)[:width] for r in parser.rows]
    return parser.header, rows


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--output", default=str(DEFAULT_OUTPUT), help="CSV output path")
    ap.add_argument("--html", help="parse a saved HTML file instead of fetching the live page")
    args = ap.parse_args()

    header, rows = parse_ratings(load_html(args.html))

    out = Path(args.output)
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(rows)

    print(f"Wrote {len(rows)} boats to {out} ({len(header)} columns)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
