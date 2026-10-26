# The public API

Sail Scoring's public API, under `/api/public/v1`, has two parts:

- **The published results** ([ADR-015](design/decisions/015-published-results-api.md)):
  read-only JSON over published results, for apps such as a club's race-day
  app, a clubhouse screen, or a results widget on a club website. It serves
  what the published pages show, shaped as they show it. It needs no sign-in.
- **Acting in a workspace** ([ADR-016](design/decisions/016-authenticated-public-api.md)),
  a preview: an app reads a workspace's series, sets up its races, starts and
  courses, and publishes, for a signed-in user who has connected it, through
  an OAuth access token.

"Public" means documented and stable, not "needs no key". Both parts share
one [OpenAPI 3.1 description](#the-description), one version, and one
[error shape](#errors).

The published results are what an app should read results from. The
`.sailscoring.json` data file beside each publication is for re-scoring and
import, and is [not a stable API](public-export-format.md#stability).

# The published results

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
/api/public/v1/publications/{id}/schedule           every race, sailed or not
```

[The OpenAPI description](#the-description) is the field-by-field reference;
what follows is what it cannot say.

- **The publication** says what it is (`kind`: a scored `series`, a
  split-fleet `championship`, or an `archive` kept as originally published),
  its fleets, its page and data file, and under `resources` which of the
  others it publishes, with each one's URL and when it was last published.
  That is the list to go by: a resource missing there is a `404`. The pages
  `index.json` lists only hint at it.
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
- **The schedule** lists every race the series scores, by date, sailed or
  not, with each start's gun and fleets (a start may have no time, and a
  race no starts), a `status` of `sailed` or `scheduled`, and for a sailed
  race a `results` link. A past race still `scheduled` was blown out,
  abandoned, or not yet entered; the schedule does not say which. It is
  the schedule of the races a series scores, not a club calendar.
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
- the entry list with the Entries page;
- the schedule with the Schedule page, including each race's `status`: a
  race sailed since the Schedule was last published still reads
  `scheduled`.

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
- The published results take no query parameters, and refuse any with
  `400`.
- There is no rate limit on them today. One may be introduced if a client
  abuses the API; it would answer `429`.

## Versioning and stability

- **The version is in the path.** Within `v1`, changes are additive: new
  resources, new optional fields, new values where a field is documented as
  open-ended. A reader should ignore fields it does not know.
- **A breaking change is a new version**, served beside the old one. The old
  version keeps serving for **a year** after its successor ships, with
  `Deprecation` and `Sunset` headers once it is deprecated.
- **The API is versioned apart from the data file**, which changes with the
  scoring model. A new scoring feature adds a field here at most.

## Trying it out

The published results need no key, so `curl` and a browser are enough. Find a
publication through a workspace index, then start from its publication
resource:

```sh
# The workspace's publications, and each one's API link where it has one
curl -s https://app.sailscoring.ie/p/hyc/index.json | jq '.publications[] | {name, api}'

P=https://app.sailscoring.ie/api/public/v1/publications/<id>
curl -s $P | jq .resources          # what this publication serves
curl -s $P/standings | jq '.tables[0].rows[] | [.rankDisplay, .competitor.sailNumber, .netDisplay]'
curl -s $P/races/1 | jq '.fleets[0].results[:3]'

# Polling: send the ETag back, and an unchanged resource is a 304
curl -sI $P/standings | grep -i etag
curl -s -o /dev/null -w '%{http_code}\n' -H 'If-None-Match: "<etag>"' $P/standings
```

To browse it from the spec instead, open [editor.swagger.io](https://editor.swagger.io),
choose **File → Import URL**, and give it
`https://app.sailscoring.ie/api/public/v1/openapi.json`. In the right-hand
pane, expand an operation (start with `GET /publications/{id}`), click
**Try it out**, enter the publication's id (the UUID ending its `api` link,
not the whole URL), and **Execute**. The editor shows the request it sent
as a `curl` command, the response, and its headers. A `{fleet}` is a key
from the publication's `fleets`; an `{n}`, a race number from `races`. The
requests go from the browser straight to the API, which allows any origin.

# Acting in a workspace (preview)

An app acting for the people who use it: an ORC course-plotting page
setting up a day's races and a course for each start, or a race-day app
publishing results after the last race. The calls act as the signed-in user,
in one workspace they chose, and never beyond what their role there allows.

**This part is a preview.** Its calls may still change incompatibly, with
notice to the registered apps, until the label comes off; the description
marks them `x-stability-level: alpha`. The published results are not a
preview.

## Getting access

1. **Register the app.** Apps are registered by Sail Scoring, not by
   themselves: ask [mark@hyc.ie](mailto:mark@hyc.ie), saying what the app is
   and its exact redirect URIs (https; or http on `127.0.0.1` while
   developing). You get a client id. A web page or an app with no server of
   its own is a public client, with no secret; an app with a server can have
   a secret instead.
2. **Send the user through the authorization code flow, with PKCE**
   (`S256`):

   ```
   GET /api/auth/oauth2/authorize?response_type=code&client_id=…
       &redirect_uri=…&scope=read races offline_access&state=…
       &code_challenge=…&code_challenge_method=S256
   ```

   The user signs in to Sail Scoring if they aren't, chooses which of their
   workspaces the app may act in, and approves the scopes. The browser comes
   back to the redirect URI with a `code`.
3. **Exchange the code** at `POST /api/auth/oauth2/token`
   (`grant_type=authorization_code`, with the `code_verifier`), and get an
   access token (`ssat_…`, an hour) and, if you asked for `offline_access`,
   a refresh token (`ssrt_…`, 90 days). Renew with
   `grant_type=refresh_token`.
4. **Call the API** with `Authorization: Bearer ssat_…`.

The workspace must have connected apps switched on; while this part is a
preview, Sail Scoring switches it on workspace by workspace. The discovery
document is at `/.well-known/oauth-authorization-server`.

| Scope | Lets the app | Needs the user's role to allow |
|---|---|---|
| `read` | Read the workspace's series, entries, races, starts, finishes and publications | reading |
| `races` | Add and delete races, change and delete starts, set each start's course | scoring |
| `publish` | Publish and unpublish results | scoring |
| `offline_access` | Keep its access with a refresh token | |

A grant covers **one workspace**. An app that should reach two is connected
to each, and keeps a token for each. The user can see and disconnect it from
their account page. An access token is tied to the browser session the user
approved it in: signing out ends it, and the refresh token gets a new one; a
session that lapses (90 days without using Sail Scoring in that browser)
ends the grant, and the app asks again.

## Calls

```
GET    /workspaces                                   the workspace this token reaches
GET    /workspace/seasons                            seasons, for publishing under
GET    /series                                       every series
GET    /series/{id}                                  a series
GET    /series/{id}/fleets                           its fleets
GET    /series/{id}/competitors                      its entry list
GET    /series/{id}/races                            its races, each with its starts
POST   /series/{id}/races                            add races, with their starts
GET    /series/{id}/races/{raceId}                   a race, with its starts
DELETE /series/{id}/races/{raceId}                   delete a race
GET    /races/{raceId}/finishes                      a race's finishes
PATCH  /races/{raceId}/starts/{startId}              change a start's gun or fleets
DELETE /races/{raceId}/starts/{startId}              delete a start
PUT    /races/{raceId}/starts/{startId}/course       set a start's course
GET    /series/{id}/publish                          the series' publication
POST   /series/{id}/publish                          publish it
DELETE /series/{id}/publish                          unpublish it
GET    /publications                                 every publication in the workspace
```

What the description can't say:

- **Ids are the ones the writes take**, and stay a thing's id for its life.
  A race's `number` is renumbered when an earlier race is deleted or the
  races are reordered; keep a race by its `id`.
- **A field with nothing to say is `null`**, never absent.
- **Writes are actions.** None replaces a whole record, so an app never has
  to send back fields it read. A field the call doesn't take is refused.
- **Creating races**: they go after the series' last race and are numbered
  by the server. Choose their ids (and their starts') if you may retry, so a
  retry replaces rather than adds; or send an `Idempotency-Key`.
- **A fleet starts once per race.** A start that would take another start's
  fleet is refused, so a start can be found by its fleets.
- **Times are local**: a gun is `HH:MM:SS` (`HH:MM` is accepted), on the
  race's `date`.
- **A course** is set from an [ORC constructed course
  document](design/orc/constructed-course-format.md), sent as written: in
  magnetic, with an anchor where there is one. It's read and converted as the
  race-start dialog's import does: bearings to true at the variation where
  the course is, on the race's day. A start that already has legs is
  replaced only with `?replace=true`. The start's `course` says `north:
  "magnetic"` when nothing said where the course was, so it couldn't be
  converted.
- **The workspace header** (`x-sailscoring-workspace`, an id or a slug) may
  name the grant's workspace, or be left out.
- **`If-Match`** on a start change refuses it (`409`) if the start changed
  since that version.
- **Rate limit**: 120 calls a minute for each user an app acts for;
  `429` with `Retry-After` beyond it.
- **Any origin** may call it: the token is the only credential, and no
  cookie is ever read.

## A race day, worked through

A course-plotting page setting up one day of the Autumn League: two starts,
a course on the first. `$T` is the access token.

```sh
API=https://app.sailscoring.ie/api/public/v1
auth=(-H "Authorization: Bearer $T")

# Find the series and its fleets, once a season: keep the fleet ids.
curl -s "${auth[@]}" $API/series | jq '.series[] | {id, name}'
S=<series id>
curl -s "${auth[@]}" $API/series/$S/fleets | jq '.fleets'

# Add the day's race, with its starts.
curl -s "${auth[@]}" -H 'Content-Type: application/json' -X POST $API/series/$S/races -d '{
  "races": [{
    "date": "2026-10-04",
    "starts": [
      { "fleetIds": ["<Class 1 id>"], "startTime": "11:00" },
      { "fleetIds": ["<Class 2 id>"], "startTime": "11:05" }
    ]
  }]
}' | jq '.races[0] | {id, number, starts: [.starts[] | {id, startTime}]}'
R=<race id>; START=<the 11:00 start's id>

# Set the first start's course, from the page's own document.
curl -s "${auth[@]}" -H 'Content-Type: application/json' -X PUT \
  $API/races/$R/starts/$START/course --data-binary @course.json | jq '.course | {north, distanceNm}'

# A general recall: the gun moves, and the course stays.
curl -s "${auth[@]}" -H 'Content-Type: application/json' -X PATCH \
  $API/races/$R/starts/$START -d '{ "startTime": "11:10" }' | jq '{startTime, legs: (.course.legs | length)}'
```

## Errors

Both parts answer an error the same way:

```json
{ "error": "invalid", "message": "The request body isn't what this call takes.",
  "problems": [{ "field": "races.0.date", "message": "Invalid string" }] }
```

`error` is one of `invalid` (400), `unauthenticated` (401), `forbidden`
(403), `not-found` (404), `conflict` (409), `archived` (423),
`rate-limited` (429) or `internal` (500), and is stable. `message` is for a
person and may change: don't match on it. `problems` comes with `invalid`,
one per field at fault.

# The description

The OpenAPI 3.1 description of both parts is served at
`/api/public/v1/openapi.json`, generated from the schemas the requests and
responses are built to. A copy is committed as
[`openapi/public-v1.json`](openapi/public-v1.json) and regenerated with
`pnpm openapi:generate`; CI fails a change that breaks it, outside the
preview.
