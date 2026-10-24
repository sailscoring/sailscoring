# The published results API

A read-only JSON API over published results, for apps: a club's race-day
app, a clubhouse screen, a results widget on a club website. It serves what
the published pages show, shaped as they show it, under a versioned contract
([ADR-015](design/decisions/015-published-results-api.md)).

This is what an app should build on. The `.sailscoring.json` data file beside
each publication is for re-scoring and import, and is
[not a stable API](public-export-format.md#stability).

## Finding a publication

Start from the indexes ([the public index format](public-index-format.md)):

```
/p/index.json                        the club workspaces publishing
/p/{workspace}/index.json            every publication in a workspace
/p/{workspace}/{season}/index.json   the publications filed under one season
```

Each publication there carries an `api` link, its resource in this API. A
publication made before the API has no link until it is published again.

## Resources

```
/api/public/v1/publications/{id}                    the publication
/api/public/v1/publications/{id}/standings          every fleet's standings
/api/public/v1/publications/{id}/standings/{fleet}  one fleet's
/api/public/v1/publications/{id}/races              the sailed races
/api/public/v1/publications/{id}/races/{n}          one race's results, by fleet
/api/public/v1/publications/{id}/competitors        the entry list
```

The OpenAPI 3.1 description is at `/api/public/v1/openapi.json`, generated
from the schemas the responses are built to. It is the field-by-field
reference; what follows is what it cannot say.

- **The publication** says what it is (`kind`: a scored `series`, a
  split-fleet `championship`, or an `archive` kept as originally published),
  its fleets, its page and data file, and under `resources` which of the
  others it publishes and when each was last published. A resource missing
  there is a `404`.
- **`{fleet}`** is a fleet's `key`, as the publication and every resource
  name it: the fleet's name kebab-cased (`Cruisers 1` is `cruisers-1`).
- **`{n}`** is the race's number in the series. A fleet that sat races out
  numbers the ones it sailed for itself on its pages, so each fleet in a
  race also carries its own `label` (`R2`).
- **A sub-series** publishes a table per (sub-series, fleet); each table and
  each fleet's race results say which in `subSeries`.
- **A championship** publishes one ranking, its fleet named
  `Championship`, with each competitor's `fleet` once the fleet has split,
  and its races fleet by fleet. The repêchage and cut-from tables its page
  prints beside the ranking are on the page only.
- **An archive** serves what the source printed: each score's `display` is
  the original text, with no points or codes, and `details` and `summary`
  carry the source's own columns.

## What a resource says, and when it changes

**A resource follows the page that shows it.** Each changes when the scorer
publishes a page showing its data, and only then:

- a fleet's standings, and its results in each race, with the fleet's page
  or a combined page showing the fleet;
- a championship's ranking with its Championship page, and its races with
  its Race results page;
- the entry list with the Entries page.

So publishing only the entry list changes no results, and the API agrees
with the pages an app links to. A resource is removed when the last page
showing it is unpublished. The publication resource changes on every
publish. Two consequences:

- **One publication's resources can come from different publishes**, last
  week's standings beside today's entry list. Each says when in
  `publishedAt`.
- **The index can run ahead of the API.** The race count and dates in
  `index.json`, like the data file, are rebuilt on every publish whichever
  pages are ticked.

**Only what the pages show.** A competitor carries the fields the series
displays and nothing else: a field the series has switched off is absent,
as is one the competitor has no value for. Every score carries `display`,
the cell as the page prints it (`(12.0 DNF)`), so an app never has to
re-derive the formatting.

**Times are local.** Every resource carries `timeZone`, the instance's IANA
zone. A date or time without an offset (`date`, `startTime`, `finishTime`)
is local to it; a timestamp ending in `Z` (`publishedAt`) is UTC.

## Identity

A competitor's `id` is the same in every resource and every publish of the
series, and reveals nothing internal. It is not related across series: the
same sailor has unrelated ids in two series. Where the workspace publishes
competitor pages, a competitor also carries `identity`, the slug and URL of
their public timeline across the workspace's series. That is the identity to
keep.

An instance may rotate the key ids are hashed under. Every id of a series
then changes at its next publish, as one event: an app sees the series
re-keyed between one fetch and the next. `identity` never changes with it.

## Polling

- Every response carries an `ETag`. Send it back as `If-None-Match` and an
  unchanged resource is answered `304 Not Modified` with no body. From a
  page, that header needs a CORS preflight, which the API answers.
- Responses are cached at the CDN for at least a minute, and dropped from it
  when the publication's view is written, so a publish shows within seconds.
  Polling faster than once a minute gains nothing.
- The API takes no query parameters, and refuses any with `400`.
- There is no rate limit today. One may be introduced if a client abuses
  the API; it would answer `429`.

## Versioning and stability

- **The version is in the path.** Within `v1`, changes are additive: new
  resources, new optional fields, new values where a field is documented as
  open-ended. A reader should ignore fields it does not know.
- **A breaking change is a new version**, served beside the old one. The old
  version keeps serving for **a year** after its successor ships, with
  `Deprecation` and `Sunset` headers once it is deprecated.
- **The API is versioned apart from the data file**, which changes with the
  scoring model. A new scoring feature adds a field here at most.
