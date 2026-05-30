#!/usr/bin/env python3
"""Fetch the worldwide IRC TCC listing (ClubListing.csv).

Source: the CSV download behind the IRC Rating Office's official online TCC
listings (`ircrating.org/irc-racing/online-tcc-listings/`), hosted by TopYacht
on the rating authority's behalf:

    https://www.topyacht.com.au/rorc/data/ClubListing.csv

This is the authority's own data — RORC publishes IRC TCCs nowhere else. One GET
returns the whole worldwide list; no access gate. The data is provided for
verifying IRC TCCs of boats competing in IRC events, so use it for that and do
not maintain a separate public mirror (see README.md). This script just downloads
the file, optionally filtering to one racing area (country) by the Sail No prefix.

stdlib only — no third-party dependencies.

Usage:
    python3 fetch_irc_tcc_listing.py                  # fetch -> club-listing.csv
    python3 fetch_irc_tcc_listing.py -o out.csv       # choose output path
    python3 fetch_irc_tcc_listing.py --area IRL       # only IRL-prefixed sail nos
    python3 fetch_irc_tcc_listing.py --csv saved.csv  # re-filter a saved file
"""

from __future__ import annotations

import argparse
import csv
import io
import sys
import urllib.request
from pathlib import Path

URL = "https://www.topyacht.com.au/rorc/data/ClubListing.csv"
USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"
DEFAULT_OUTPUT = Path(__file__).with_name("club-listing.csv")


def load_csv(csv_path: str | None) -> str:
    if csv_path:
        return Path(csv_path).read_text(encoding="utf-8", errors="replace")
    req = urllib.request.Request(URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:  # noqa: S310 (trusted URL)
        return resp.read().decode("utf-8", errors="replace")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("-o", "--output", default=str(DEFAULT_OUTPUT), help="CSV output path")
    ap.add_argument("--area", help="keep only rows whose Sail No starts with this prefix, e.g. IRL")
    ap.add_argument("--csv", help="re-filter a saved CSV instead of fetching")
    args = ap.parse_args()

    reader = csv.reader(io.StringIO(load_csv(args.csv)))
    rows = list(reader)
    if not rows:
        raise SystemExit("ClubListing is empty — the source file may have changed.")
    header = rows[0]
    try:
        sail_idx = header.index("Sail No")
    except ValueError as exc:
        raise SystemExit("Missing the 'Sail No' column — the file format may have changed.") from exc

    body = rows[1:]
    if args.area:
        prefix = args.area.upper()
        body = [r for r in body if len(r) > sail_idx and r[sail_idx].upper().startswith(prefix)]

    out = Path(args.output)
    with out.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(body)

    print(f"Wrote {len(body)} boats to {out} ({len(header)} columns)", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
