# Tally numbers in Sailwave

Background for the Sailwave *file and scoring* side of tallies. The web
service that reads the NFC tokens is a separate thing — see
[`service.md`](service.md).

Sources: `reference-docs:tool-manuals/sailwave/Sailwave-User-Guide-2025-V16.md`
and the published 2026 ILCA 7 Men's World Championship competitor list at
`sailwave.com/results/2026_ILCA_Men_Worlds.htm`.

## What a tally number is

A numbered token issued to each competitor at registration, handed over when
launching and collected when returning, so race management can tell who is
still afloat. It is a **safety** procedure, not a scoring one. The glossary
already carries the term (`docs/requirements/glossary.md`).

Our target events already specify it: IODAI's 2025 major-event SIs say
"19.3 Boats will be attributed a tally number at registration", with SI 5.4
requiring competitors to tally out before launching.

## The `comptally` field

Sailwave has a built-in per-competitor `tally` field, stored in `.blw` as
`comptally`. Its value is free text and its meaning is entirely conventional
— the user guide is explicit:

> At dinghy events it's common practice to have to sign on and off the water
> for safety reasons. The way this is organised is to allocate a tally number
> for each competitor. However, this column has no special meaning and you can
> rename it and use it for any purpose you like; bow number being a popular
> alternative.

(Sailwave has a separate `BowNumber` field, so the repurposing is a habit
rather than a necessity.)

Values seen in the wild differ in shape, which matters for anything that
parses them:

| Source | Values |
|--------|--------|
| `tests/fixtures/sailwave/2026 ILCA Leinsters results.blw` | bare integers, `1`–`21` |
| 2026 ILCA 7 Men's Worlds | zero-padded, `T0001`–`T0141` |

At the Worlds the numbers run `T0001`–`T0141` with **no gaps**, sorted by
nationality then sail number, across three fleets of 47 (Red, Blue, Yellow).
So the tally number there is allocated by the organising authority after the
entry list closed, not in entry order.

### How Sailwave publishes it

The Worlds "Competitor List" report puts Tally first, ahead of Fleet:

```
Tally | Fleet | Nat | Sail | Helm | WS ID
T0001 | Red   | AIN | 211017 | Daniil Krutskikh | AINXDK2
```

Column classes on the `<colgroup>` are `tally fleet nat sailno helmname
helmid`, and the header text is the field's title — so a scorer who renamed
the column to "Bow" gets "Bow" in the published table.

### What Sail Scoring does with it today

Nothing. `lib/sailwave-import.ts` sweeps every `comp*` key into the raw
competitor record, so `comptally` survives parsing, but no mapping reads it
and `Competitor` in `lib/types.ts` has no field to put it in. It is dropped
silently on import.

## Tally penalties: TPI and TPO

Failing to tally out or in is penalisable, and Sailwave scorers handle it with
two codes the user guide documents but does **not** ship:

| Code | Meaning |
|------|---------|
| TPI | Tally Penalty In — standard penalty for not checking in as specified in NoR and/or SI |
| TPO | Tally Penalty Out — standard penalty for not checking out as specified in NoR and/or SI |

They appear in the guide's list of non-standard codes alongside DFP, DPI1,
NDA, ARB, TLE and XPA. The scorer creates them by hand, and the guide is
emphatic about one setting:

> When creating custom codes for things like Safety penalties [TPI & TPO
> above], *i.e.* check out/in, it is important that '*This is a code where
> Rule A6.2 applies (other boats scores are not changed)*' is checked.

For a penalty that applies to the series rather than to one race, the guide
points at Sailwave's competitor `Penalties` field, which holds a total added
to nett points, cannot be discarded, and has to be kept correct by hand.

### How that maps onto our engine

Our `DPI` built-in is already the same shape: `pointsMethod:
{ type: 'additive_stated' }`, `otherScoresUnchanged: true`, with the stated
points carried on `Finish.penaltyOverride`. A scorer can record a tally
penalty today by entering DPI with the agreed points.

What is missing is the *label*. Sailwave's reason for creating a named code is
that it "helps explain what the penalty was for" — the published results say
TPO, not DPI. We have no user-defined codes: `getCodeDefinition(code,
customCodes)` in `lib/scoring-codes.ts` takes a `customCodes` argument, but no
caller supplies one and nothing persists such definitions, so the seam is
designed and unbuilt.

A `.blw` that actually uses TPI/TPO reaches `lib/sailwave-import.ts:830`,
where `getCodeDefinition` returns undefined and the code lands on the
unrecognised-code path.
