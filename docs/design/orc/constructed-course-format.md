# The ORC constructed course format

A small JSON document for one constructed course as ORC Rating Systems
rule 402.5 defines it: for each leg, its length and direction, the wind
direction, and optionally the current. It is how an app that builds
courses hands one to a scoring program. Sail Scoring imports it into a
race start (#667).

The field names are ORC's own: those of the `<leg>` element in ORC's PCS
module XML (`reference-docs:handicap-systems/orc/PCS-Module-Specs.pdf`),
which ORC Scorer also uses for a course's legs. So the document converts
field for field to what ORC's software reads. It is an independent format,
not one ORC publishes.

The JSON Schema is [`constructed-course.schema.json`](constructed-course.schema.json).

**Status: proposed** (October 2026).

## Example

The constructed course in ORC's Race Management Guide 2026, §3.2:

```json
{
  "format": "orc-constructed-course",
  "version": 1,
  "name": "ORC Race Management Guide 2026, §3.2",
  "north": "magnetic",
  "legs": [
    { "name": "Start – 1",         "distance": 2.09, "course": 162, "windDirection": 160 },
    { "name": "1 – 1A",            "distance": 0.06, "course": 60,  "windDirection": 155 },
    { "name": "1A – Gate (2P-2S)", "distance": 1.91, "course": 340, "windDirection": 155 },
    { "name": "Gate (2P-2S) – 1",  "distance": 1.89, "course": 161, "windDirection": 160 },
    { "name": "1 – 1A",            "distance": 0.06, "course": 60,  "windDirection": 160 },
    { "name": "1A – Gate (2P-2S)", "distance": 1.91, "course": 340, "windDirection": 160 },
    { "name": "2S – Finish",       "distance": 0.19, "course": 316, "windDirection": 160 }
  ]
}
```

A course placed on the water, with the wind speed the race committee
recorded:

```json
{
  "format": "orc-constructed-course",
  "version": 1,
  "name": "Autumn League, Race 3, Class 1",
  "north": "magnetic",
  "anchor": { "lat": 53.40125, "lng": -6.08413 },
  "legs": [
    { "name": "Start – Windward",   "distance": 0.67, "course": 282.0, "windDirection": 280.0, "windSpeed": 11.5 },
    { "name": "Windward – Gybe",    "distance": 0.78, "course": 144.0, "windDirection": 280.0, "windSpeed": 11.5 },
    { "name": "Gybe – Leeward",     "distance": 0.73, "course": 48.0,  "windDirection": 285.0, "windSpeed": 13.0 }
  ]
}
```

## The document

| Field | | |
|---|---|---|
| `format` | required | `"orc-constructed-course"` |
| `version` | required | `1` |
| `north` | required | `"magnetic"`, the north every direction in the document is measured from |
| `name` | optional | The course's name, for people: shown when importing. Never matched against anything. |
| `anchor` | optional | `{ "lat", "lng" }`, decimal degrees WGS84, south and west negative: where the first leg starts |
| `legs` | required | The legs in sailing order, at least one |

## A leg

| Field | | |
|---|---|---|
| `distance` | required | Nautical miles, to 0.01 NM |
| `course` | required | The leg's direction, start to end, degrees magnetic. `course` is ORC's name for it. |
| `windDirection` | on every leg or none | Where the true wind blows **from**, degrees magnetic |
| `windSpeed` | on every leg or none | The true wind speed the race committee recorded, knots |
| `currentDirection` | optional, with `currentSpeed` | Where the current flows **to** (its set), degrees magnetic |
| `currentSpeed` | optional, with `currentDirection` | The current's rate, knots |
| `name` | optional | The leg as the race committee labels it, e.g. `"Start – 1"` |

## Rules

- **Directions are magnetic**: as on the race committee's compass, on the
  day, at the course. That is how ORC's guidance records them. A reader
  that stores true converts at the anchor, or at whatever else it knows
  about where the course is, on the race's date. Scoring does not depend
  on the north: ORC computes each leg's wind angle as `windDirection −
  course`.
- **A leg split on a wind shift is two legs** (rule 402.5's sub-legs).
  Nothing groups them; they may share a name.
- **The course length is the sum of the legs.** A producer writes each
  distance to 0.01 NM, as ORC records them (rule 401.3). A reader given a
  finer figure rounds it to 0.01 NM, so every reader scores the same
  length. There is no declared total: a second figure would be one more
  thing to disagree with the legs.
- **Wind direction on every leg, or on none.** With none, the document is
  the course without the day's wind, and the reader supplies it (Sail
  Scoring's race start has a course wind that fills the legs). With it on
  every leg, the document is a complete constructed course under 402.5.
- **Wind speed on every leg, or on none**, which is also ORC's own rule. A
  leg with a wind speed has a wind direction.
- **The document does not choose the scoring method.** Performance curve
  scoring derives the wind from the finish times, and scoring at the
  recorded wind uses `windSpeed`. Which one a race uses is the scorer's
  setting.
- **The anchor is the start of the first leg**: the position its distance
  and course are measured from (for a start line, wherever the producer
  measured from, usually its midpoint). Every other point on the course
  follows from the legs, so a reader can draw the course on a chart and
  look up the variation there. Points worked out from the legs are not
  positions anyone recorded, and a reader should not present them as
  such.

## Readers and versions

- A reader refuses a document with a `version` it doesn't know, or with a
  `north` other than `"magnetic"`.
- A reader ignores fields it doesn't know, as ORC's PCS module keeps
  attributes it doesn't know. So adding an optional field that doesn't
  change what the others mean needs no new version.
- The version changes only when an older reader would misread a document.

## ORC's own course shapes

| This format | ORC PCS module `<leg>` | ORC Scorer course leg |
|---|---|---|
| `distance` | `distance` | `Distance` |
| `course` | `course` | `Course` |
| `windDirection` | `windDirection` | `WindDirection` |
| `windSpeed` | `windSpeed` (`0` for none) | `WindSpeed` |
| `currentDirection`, `currentSpeed` | the same names | — |
| `name` on the document | — | the course's name |
| `name` on a leg | — | — |

## Left out

- **Marks**, which side each is left on, passing or rounding, and the two
  ends of a line. Scoring needs none of them, and the legs already carry
  what they would be used to work out.
- **True bearings and a variation.** One north for everything, the one
  race committees use.
- **ORC's per-leg pre-defined allowances** (`predefinedCourse`, scoring a
  leg on the windward/leeward or all-purpose curve instead of its wind
  angle). Adding it would need a new version, since an older reader would
  score those legs on the wrong curve.
- **Which race, start and classes** the course is for, and where the
  document came from. The scorer chooses where it goes.
