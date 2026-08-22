# Sailwave Tally — the web service

Sailwave Tally is an NFC-based sign-out / sign-in system: each competitor's
tally token is a tag, readers ("stations") at the top of the slip record taps,
and a web app shows race management who is afloat. The 2026 ILCA 7 Men's World
Championship is trialling it.

The Sailwave-file side of tallies — the `comptally` field and the TPI/TPO
penalty codes — is in [`tally-in-sailwave.md`](tally-in-sailwave.md).

These notes record the service **as observed from the outside on 2026-08-22**,
by fetching public pages. There is no published API, no documentation, and no
stability contract; treat everything here as liable to change without notice.

## Two deployments

| Host | Stack | Notes |
|------|-------|-------|
| `tally.sailwave.com` | ASP.NET Web Forms (`GridView1`, postbacks, `ScriptResource.axd`) | Older generation. Still serving a 9er event. |
| `tallytest.sailwave.com` | ASP.NET Core Razor Pages, "Version 1.0.233.0758 - Built 21/08/2026" | Current generation. **This is where the ILCA 7 Worlds data lives.** |

The `tallytest` name is unreassuring for a world championship, but the data on
it is the real, live entry list and the build date is a day before the event.
The plain `tally.sailwave.com` host is the older software, not a production
counterpart of the same data.

## Addressing

An event is identified by an integer **EID**. The ILCA 7 Men's Worlds is
`EID=1`. The current event is also stashed in a `SWTally_EID` cookie (one-year
expiry), which is why some routes work with the id in the path and some with
it in the query string.

| Route | Auth | What it is |
|-------|------|------------|
| `/?EID=1` | none | Landing page; a form to set the current event id |
| `/Tally/1` (or `/Tally?EID=1`) | none | The tally display |
| `/Map?Name={id}` | none | One competitor's status and movement history |
| `/Edit?EID=1` | password | Change names, sail numbers, fleets, tally numbers |
| `/Admin/1` | password | Manage events and competitors, upload Sailwave files |
| `/About` | — | Linked from the landing page, returns 404 |

## The tally display

`/Tally/1` renders a per-fleet summary only:

| Fleet | Total | NA | Out | In | Action |
|-------|-------|----|-----|----|--------|
| Blue | 47 | 0 | 5 | 0 | Display |
| Red | 47 | 0 | 5 | 0 | Display |
| Yellow | 47 | 0 | 2 | 0 | Display |
| Totals | 141 | 0 | 12 | 0 | |

The per-competitor grid sits behind those "Display" buttons, and **selecting a
fleet is a POST** — `/Tally/1?handler=SelectFleet` with `FleetName`, `EventId`
and an ASP.NET antiforgery token, storing the selection in server-side session
state. There is no GET equivalent: `?FleetName=`, `?SelectedFleet=`, `?fleet=`
and friends all return the unselected page. **The competitor grid is not
reachable by URL.**

The older deployment renders its grid without a selection step, which is where
the status vocabulary is legible. Cells are sail numbers coloured by status,
with a tooltip of `helm name` + `DD HH:MM:SS`, and a legend whose element ids
give the internal codes:

| Id | Label |
|----|-------|
| `LblX` | No Activity |
| `LblO` | Out-on water |
| `LblI` | In-Ashore |
| `LblC` | Collected |
| `LblR` | Returned |

`No Activity` cells carry a `00:00:00` timestamp, i.e. a null rather than a
real time. The new deployment's summary columns (`NA`, `Out`, `In`) are the
same vocabulary, counted.

## Live updates

`/Tally/{eid}?handler=Updates` is a Server-Sent Events stream
(`content-type: text/event-stream`, `x-accel-buffering: no`). It opens with a
`: connected <ISO timestamp>` comment and later emits a `refresh` event. The
event carries **no payload** — the page's handler closes the stream and calls
`window.location.reload()`. It is a cache-buster, not a data feed.

## No API

There is no JSON surface. Beware of probing for one: unknown `?handler=` names
**silently fall through to the default page render**, so `?handler=Data`,
`?handler=Json` and `?handler=Competitors` all return HTTP 200 with the
ordinary tally-display HTML (the pages differ only in their freshly minted
antiforgery token). A 200 here is not evidence that a handler exists.
`/api/...` and `/swagger/index.html` 404.

## The Map page

`/Map?Name=518` is the per-competitor view:

```
AIN 211017
Name:         Daniil Krutskikh
Class:        Red            <- the fleet, not the boat class
Tally:        T0001
Status:       Collected
Last Updated: 20/08/2026 14:27:10

Transactions for Competitor
Time                  Direction   Station
18/08/2026 14:43:46   Collected   201
18/08/2026 14:44:51   Collected   201
18/08/2026 14:45:03   Collected   201
18/08/2026 14:45:15   Collected   201
18/08/2026 14:51:22   Out         201
18/08/2026 14:51:25   Out         201
18/08/2026 14:51:34   In          201
18/08/2026 14:51:37   In          201
18/08/2026 14:51:39   In          201
20/08/2026 14:27:10   Collected   5
```

Notes on that log, all of which matter to any consumer:

- **Directions** observed are `Collected`, `Out`, `In`. `Returned` is in the
  legend but was not seen.
- **Station** is a numeric reader id (`201`, `5`).
- **Timestamps** are `DD/MM/YYYY HH:MM:SS`, no timezone.
- **A single physical tap produces several rows.** Four `Collected` within 90
  seconds, two `Out` three seconds apart, three `In` five seconds apart. This
  is setup testing, but it shows the log is raw reader events with no
  de-duplication — nothing may assume one row per intent.
- The sequence above is Out and back In within twelve seconds on 18 August,
  five days before racing. It is a commissioning test, not a race.

## `Name` is a row id, not a tally number

The `Name` parameter is the service's own competitor primary key —
`/Map?Name=1` answers "Competitor with ID 1 not found." It is global across
events, not per-event: the Worlds' 141 competitors occupy **518–658**
(517 and 659 are both empty, and 658−518+1 = 141 = the published entry count),
so roughly 517 records from earlier events precede them.

**The tally number cannot be computed from it.** The ids follow the order the
Sailwave file was loaded in; the tally numbers were assigned after sorting the
entry list by nationality then sail number. The two orders agree at the start
and then drift:

| `Name` | Tally | Boat |
|--------|-------|------|
| 518 | T0001 | AIN 211017 |
| 519 | T0002 | AIN 217113 |
| 520 | T0003 | ARG 222111 |
| 521 | **T0007** | AUS 209514 |
| 600 | T0080 | IRL 224514 |
| 658 | T0136 | USA 221234 |

Tally numbers increase with the id across this sample, but the gap between
them does not settle: 517, 517, 517, 514, 520, 522.

Nor is there a lookup by anything else. Only an integer `Name` is honoured:

| Tried | Result |
|-------|--------|
| `/Map?Name=518` | the competitor |
| `/Map?Name=518&EID=1` | the competitor (EID ignored) |
| `/Map?Tally=T0001`, `/Map?Tally=T0001&EID=1` | default page, no competitor |
| `/Map?Name=T0001` | HTTP 200, empty card, **no error message** |
| `/Map?SailNo=211017`, `/Map?Id=518` | default page, no competitor |
| `/Map/518` | 404 |

So the only two ways to obtain a tally→URL mapping are to POST the fleet form
and scrape the resulting grid, or to enumerate `/Map?Name=N` across a guessed
range. Both are scraping.

### Unverified: what is on the token

The route name, and a dense integer key that is meaningless outside this
service, both fit the NFC tags being NDEF URL records encoding
`/Map?Name={id}` — tap a phone on a tally token and you land on that page.
That would make `Name` the tag's payload rather than an internal detail. Not
confirmed; it needs a physical token.

## Privacy

`/Map` is unauthenticated and the key is a small integer, so anyone can walk
the range and read every competitor's name, boat, fleet, current afloat/ashore
status, and timestamped movement history. That is a deliberate property — a
tally display is meant to be public at the club — but it is a consideration
for anything of ours that links into it, and a reason not to mirror the
movement data ourselves.
