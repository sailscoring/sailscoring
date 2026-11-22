# Recording Finishes by Voice

How whoever calls the finishers on the committee boat gets the finishing
order into Sail Scoring by saying it. The caller calls out each competitor
as they do now, "sixteen thirteen … now", with a phone or tablet recording
through a headset. The recording is what the feature makes: a transcript,
the NOW marks and the recognised sail numbers are layers on top of it, and
finishes are made from those layers by a person, while recording or
afterwards. The finishes land on the same sheet a recorder types on the
Record finishes page, and the sheet goes to the scorer with its recording.

Context: [ADR-017](../../decisions/017-voice-finish-recording.md) for why it
is built this way, [`voice-recording.md`](../../voice-recording.md) for the
milestones, and [`finish-entry.md`](finish-entry.md) for the sheet being
filled in. This flow was redesigned after a first trial of the check page
(#776): the earlier version took lines down as it listened.

---

## Design priorities, in order

1. **The recording comes first.** Record starts it at once, with no
   download, entry list or signal needed. Recognition joins in when it is
   ready, and can be run over the whole recording afterwards.
2. **Nothing is decided while recording.** A sail number is usually called
   out as the competitor approaches, often well before they finish. The
   app pairs sail numbers with NOWs afterwards, with hindsight, and a
   person accepts each finish.
3. **The app never guesses silently.** A suggestion looks like one until a
   person accepts it, and a doubtful one says why. Where the sail numbers
   and the NOWs around them don't agree in number, nothing is paired.
4. **A finish is a competitor and a time, set separately.** Changing the
   competitor never moves the time, and moving the time never changes the
   competitor.
5. **Eyes stay on the line.** A tone says what was heard. The screen is for
   the moments between finishers, and reads at arm's length.
6. **It is the same sheet.** Typing stays available the whole time, and the
   paper sheet beside it stays the cross-check.

---

## Calling finishers

```
┌──────────────────────────────────────────────────────────┐
│  Calling finishers                                       │
│                                                          │
│  Call out each sail number, then "now" as they finish,   │
│  or press NOW. Leave a pause between competitors.        │
│                                                          │
│  Any way you'd read it off the sail:                     │
│      "one six one three"      "sixteen thirteen"         │
│                                                          │
│  Everything said near the phone is recorded, and the     │
│  recording goes to the scorer with the finish sheet.     │
│                                                          │
│  One tone: a sail number was recognised.                 │
│  Two low tones: a sail number not on the entry list.     │
│  A click: a time was marked.                             │
└──────────────────────────────────────────────────────────┘
```

A NOW can come any time after its sail number: two seconds or thirty. Any
single word called out soon after a sail number counts as its NOW, since a
recogniser hears "now" as "no" or "mow" as often as not, and "now", "mark"
or "gone" count however much later they come.

---

## Getting ready

**Set up** on the Record finishes page, ashore: the recogniser's one
download (optional: without it the sound and the NOWs are still recorded),
the microphone with a level, the entry list's size, a trial call that shows
who was heard, and the phone's clock for comparison with the committee
boat's. **Record** there, or on the page itself, starts recording.

---

## Recording

```
┌──────────────────────────────────────────┐
│ ● Recording  03:19  ▁▃▆▃▁      12:44:11  │
│ 8 sail numbers recognised · 9 NOW        │
├──────────────────────────────────────────┤
│ 12:41:31  then eight three three eight   │
│                       [8338 Gannet]      │
│ 12:41:39.4 NOW pressed ──── suggested    │
│                            8338 Gannet   │
│            · 21 s quiet ·                │
│ 12:42:04  sixteen thirteen [1613 Kestrel]│
│ 12:44:09  and one three three…           │  ← largest: newest
├──────────────────────────────────────────┤
│  [ Lock ]  [          NOW           ]    │
│              Stop recording              │
└──────────────────────────────────────────┘
```

- **The timeline builds as it goes,** newest at the bottom. Words appear
  grey while the recogniser works on them. A recognised sail number becomes
  a chip naming the competitor; one not on the entry list, or a close
  match, is marked. Talk is kept, dimmed. Scrolling up stops it following;
  **Back to live** returns.
- **NOW** draws a line at that instant, to a tenth of a second, and nothing
  else. A word called out after a sail number draws a dashed one.
- **No Undo.** Nothing is committed, so a NOW pressed by mistake is a line
  no finish uses.
- **Tapping a row** opens the finish editor without stopping, for a spare
  pair of hands. Nobody has to.
- **Interruptions** appear where they happened: "Not recording from
  12:44:41 to 12:45:20. Anything called out then was not recorded."
  Recording restarts by itself when the page is back in front.
- **Lock** covers the screen against rain and sleeves; a held press lets go.

---

## The timeline, afterwards

**Open the timeline** from the Record finishes page, or from a row of the
sheet.

- **The strip** is the recording to scale around a playhead in the middle:
  the sound, each NOW a line, sail numbers where they were called out, and
  finishes as flags. Drag it, or use the arrow keys, to move the playhead;
  the buttons below nudge it by a second or a tenth and play from it. The
  pane above shows the playhead's time; it is where a video frame would go.
- **The list** is the same timeline with quiet stretches folded. Tapping a
  row moves the playhead there, plays from two seconds before, and opens
  the editor.
- **Finish here** makes a finish at the playhead, for a competitor nobody
  called out or marked, found by listening.
- **Accept N suggested finishes** accepts every suggestion with a
  recognised competitor and a single NOW. **Next to check** steps through
  the rest in time order.

### Making a finish

Every route opens the same editor, with two fields. Whatever it opened on
fills one, and the timeline around it offers the other.

| Where you start | Filled in | You choose |
|-----------------|-----------|------------|
| A NOW | The time | The competitor: type a sail number or name, or tap one called out nearby |
| A recognised sail number | The competitor | The time: a NOW nearby, when it was called out, or the playhead |
| A sail number not on the entry list | What was heard, to correct | A competitor from the autocomplete, then the time |
| The playhead | The time | The competitor |
| A finish | Both | Change either, or **Not a finish** |

A typed sail number that matches no competitor is kept as one not on the
entry list. A competitor who already has a place on the sheet can't be
given a second.

### What is suggested

1. A sail number called out again before its NOW is the same call.
2. A word said straight after a sail number is its NOW.
3. Of what is left, sail numbers and NOWs pair in order, run by run, when
   their counts agree, however far apart they are.
4. A NOW with no sail number before it takes one called out a few seconds
   after it ("now … that was 1613").
5. When the counts don't agree, nothing is paired: "One NOW for two sail
   numbers".
6. A sail number with no NOW is a finish in the order called: clear for a
   fleet scored on finishing order, to check for one that needs times.

---

## The finish sheet

The ordinary sheet (ADR-007). Accepted finishes are rows like any other.
Suggestions are rows too, marked **suggested** with **Accept**, or with the
reason to check ("close match", "not on the entry list", "no sail number"),
and each has the way into the timeline. Changing a suggested row by hand
accepts it as changed; deleting it says it is not a finish. Nothing moves
or disappears when a row is dealt with, except the mark.

**Submit for review** has **Send the recording with the finish sheet**
beside it, on unless the recorder turns it off. Only accepted finishes are
submitted; suggestions nobody accepted go with the recording, for the
scorer to accept. With sending off, the recording stays on the phone for
seven days.

---

## The scorer

The review of the submission plays the recording around each finish, and
**Open the recording** shows the same timeline. What the scorer accepts
there, or changes, is added to what is applied. Afterwards the recording
stays beside the race, for a scoring inquiry, until it is deleted.

---

## What this flow leaves open

| # | Question | How it gets answered |
|---|----------|----------------------|
| 1 | How long the scorer's copy lasts: it has to outlast a scoring inquiry | Before the feature reaches anyone else |
| 2 | Should recording start before the start, so the starting signals check the clock? | The first trials |
| 3 | Playback while recording, with a headset | The first trials |
| 4 | Cruiser callers often call the name, not the sail number | A trial with a cruiser fleet |
| 5 | Does the phone need to work from a pocket, screen off? | The first trials; if so, ADR-017 §8 |
