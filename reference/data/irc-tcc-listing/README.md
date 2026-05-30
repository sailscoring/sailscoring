# International IRC TCC listing — reference

Source material for the **IRC TCC (international)** handicap source in the
Update Handicaps dialog (`lib/irc-rating.ts`).

## Lineage

The IRC Rating Office's official "online TCC listings"
(`ircrating.org/irc-racing/online-tcc-listings/`) is an embedded view of a
TopYacht-hosted listing, and the **CSV download link on that page** is:

```
https://www.topyacht.com.au/rorc/data/ClubListing.csv
```

The file is hosted by TopYacht on the rating authority's behalf, but it *is* the
authority's data — RORC publishes IRC TCCs nowhere else (its separate boat-data
PDFs deliberately omit the rating). It is the whole worldwide list (~3,200
boats), one GET, no access gate, regenerated nightly (UK time); the HTTP
`Last-Modified` header gives provenance.

## Columns

```
Boat Name, Sail No, Cert No, Issue Date, Cert Year, TCC, Endorsed, Secondary,
Non Spi TCC, Crew, DLR, LH, Beam, Draft, Single Furling Headsail, Headsails,
Flying Headsails, Spinnakers, Series Date, Age Date, Racing Area,
SSS Base Value, STIX, AVS, Category, ValidCode
```

Used by the parser: `Sail No` (match key), `TCC` → spin IRC TCC, `Non Spi TCC`
→ non-spin IRC TCC, `Cert No`, `Cert Year`, `Issue Date`, `Endorsed` (`E`),
`Secondary` (`SEC` marks an alternative sail configuration), filtered to
`ValidCode = Yes`.

## Why no committed snapshot

Unlike the (Irish-only) Irish Sailing list, we deliberately **do not** commit a
full copy of this worldwide file. RORC/UNCL provide it for verifying IRC TCCs of
boats competing in IRC events, not for maintaining a separate public mirror of
the database. The app fetches it transiently (cached ~6h) to seed series being
scored; this directory keeps only the fetch script and a tiny sample for
development. A small parser fixture lives at `tests/fixtures/irc-club-listing.csv`.

## Fetching

```
python3 fetch_irc_tcc_listing.py                 # -> club-listing.csv (gitignored)
python3 fetch_irc_tcc_listing.py --area IRL      # only Irish boats
python3 fetch_irc_tcc_listing.py -o out.csv
```
