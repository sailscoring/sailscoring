# Recording Finishes by Voice

How whoever calls the finishers on the committee boat gets the finishing
order into Sail Scoring by saying it. The caller calls each boat as they do
now, "sixteen thirteen … now", with a phone or tablet listening through a
headset. The app takes the sail number and the time down as a line of the
same sheet a recorder types on the Record finishes page, and the recorder
submits it for the scorer to review as they do today.

Context: [ADR-017](../../decisions/017-voice-finish-recording.md) for why it
is built this way, [`voice-recording.md`](../../voice-recording.md) for the
milestones, and [`finish-entry.md`](finish-entry.md) for the sheet being
filled in. This flow is a proposal: nothing here has been tried on the water,
and the first milestone exists to find out what is wrong with it.

---

## Design priorities, in order

1. **Eyes stay on the line.** In ordinary use the caller never looks at the
   phone. What they need to know comes as a sound. The screen is for the
   moments between boats, and reads at arm's length.
2. **Nothing called is lost.** The recording runs from Listen to Stop. Every
   line can be played back, and a call the app could not place still leaves
   a line.
3. **The app never guesses silently.** A line it is unsure of says so and
   stays marked until someone settles it. A wrong boat taken down with
   confidence is the worst outcome, and worse than a line left open.
4. **The time and the boat are separate.** Correcting which boat a line is
   never moves its time, and moving its time never changes the boat.
5. **It is the same sheet.** Voice fills in the finishing order the recorder
   could have typed. Typing and tapping stay available the whole time, and
   the paper sheet beside it stays the cross-check.
6. **It works wet.** Large targets, a screen that can be locked against rain
   and sleeves, and nothing that depends on a steady hand.

---

## How a boat is called

The app is built around what callers already say. This is the whole of what
a caller needs to know, and it fits on a card:

```
┌──────────────────────────────────────────────────────────┐
│  Calling finishers                                       │
│                                                          │
│  Say her number, then "now" as she crosses.              │
│      "sixteen thirteen …  now"                           │
│                                                          │
│  Any way you'd read it off the sail:                     │
│      "one six one three"      "sixteen thirteen"         │
│      "four oh seven eight"    "seven double one one"     │
│                                                          │
│  A long number: the last three or four digits will do,   │
│  if no other boat ends the same.                         │
│                                                          │
│  Leave a breath between boats.                           │
│  No "IRL". Talk to each other as usual: it listens for   │
│  numbers and ignores the rest.                           │
│                                                          │
│  One tone: she's down.   Two low tones: look when you    │
│  can.                                                    │
└──────────────────────────────────────────────────────────┘
```

**The time comes from when "now" is said, not from the app recognising the
word.** A recogniser hears a shouted "now" as "no", "mow" or "well" about as
often as it hears "now". So any single word called on its own within a few
seconds of a number fixes that boat's time, at the moment it was said. A
caller who says "mark" or "gone" instead is understood without the app
being told.

The **Now** button does the same job by touch, for a caller who would
rather tap, or a second person keeping time.

For a fleet scored on finishing order alone, there is no "now" to say: the
numbers in the order called are the sheet, as on paper.

---

## Getting ready

Done ashore or on the way out, while there is still a signal. The recorder
opens **Record finishes**, picks the race, and finds one new line above the
finishing order:

```
│  Race 5, Autumn League                                   │
│  HYC Autumn League · 2026-10-04                          │
│                                                          │
│  Take finishes by voice                    [ Set up ]    │
│                                                          │
│  Starts                                                  │
│  Class 1, due 11:00            [ Started at ]            │
```

**Set up** walks through four things and shows each as done:

```
┌──────────────────────────────────────────────────────────┐
│  Take finishes by voice                                  │
│                                                          │
│  ✓ Listening on this phone                               │
│    Downloaded once (85 MB). Nothing you say leaves       │
│    the phone.                                            │
│                                                          │
│  ✓ Microphone: Jabra Evolve                              │
│    ▁▂▅▇▅▂▁                                               │
│                                                          │
│  ✓ Entry list: 26 boats in this race                     │
│                                                          │
│  ○ Try it: call any boat's number                        │
│                                                          │
│      Heard "sixteen thirteen"                            │
│      IRL 1613  Checkmate  Class 2                        │
│                                                          │
│  This phone's time is 10:41:07.                          │
│  It should agree with the committee boat's clock.        │
│                                                          │
│                              [ Not now ]  [ Listen ]     │
└──────────────────────────────────────────────────────────┘
```

- **The download** happens once per phone. Until it has finished, Listen is
  unavailable and the line says how far it has got. It needs a signal, which
  is why setting up is something to do before leaving the harbour.
- **The microphone** names the one in use, with a level, so a headset that
  hasn't connected is seen ashore rather than at the first finisher.
- **Try it** is the mic check and the calling lesson in one. It shows what
  was heard and which boat that is.
- **The clock** is shown because every time on the sheet will come from it.
  The start times the recorder notes are taken from a watch, and the two
  have to agree.

The setup dialog fits a phone and scrolls inside itself, as every dialog
does.

---

## Listening

**Listen** replaces the page with one screen. It stays up, and the phone
stays awake, until **Stop**.

```
┌──────────────────────────────────────────┐
│ ● Listening   ▁▃▆▃▁          12:42:19    │
│                                          │
│                                          │
│   1613                                   │
│   Checkmate · Class 2                    │
│   12:42:07                               │
│                                          │
│ ──────────────────────────────────────── │
│   12:41:51   8338   Indian               │
│   12:41:40   2016   Ghost Raider  check  │
│   12:41:31   …44    2 boats      choose  │
│   12:41:02   4078   Dux                  │
│                                          │
│                                          │
│  [ Undo ]     [    Now    ]     [ Lock ] │
│                                  Stop    │
└──────────────────────────────────────────┘
```

The last boat taken is the largest thing on the screen, readable at arm's
length: number, name, time. Below it, the lines before, newest first.

### What a call becomes

| What was heard | The line | Sound |
|----------------|----------|-------|
| A boat's whole number, or trailing digits only one boat has | The boat | One tone |
| Not a number on the list, but it sounds like exactly one boat's | The boat, marked **check** | One tone, then a low one |
| A number that fits more than one boat | An unknown boat, marked **choose**, with the boats it could be | Two low tones |
| A number on no entry | An unknown boat under that number, as typing one gives today | Two low tones |
| A boat already on the sheet | No new line. Her line notes she was called again, and when | Two low tones |
| Talk | Nothing | None |

A line marked **check** counts as taken: the boat is on the sheet in her
place. The mark is a promise that someone will listen to that call before
the sheet is submitted.

### Times

On a fleet that needs times, a line's time is, in order of preference:

1. The **Now** button, pressed within a few seconds either side of the call.
2. The word called after the number.
3. The moment the number itself was called. The line then shows its time as
   **called 12:42:05**, to be accepted or corrected.

A press of **Now** with no call near it is kept as a line with a time and
no boat yet. The next call names her. That is how a second person can keep
time for a caller who only calls numbers, and how a caller catches up when
three boats cross together: three presses, then three numbers.

### Controls

- **Undo** removes the last line and says which: "Removed 1613". The
  recording keeps the call.
- **Now** is the widest target on the screen.
- **Lock** covers the screen so rain and sleeves do nothing. A held press
  unlocks it. Listening carries on.
- **Stop** asks once ("Stop listening? 14 boats taken.") and returns to the
  sheet.

Typing a number is one tap away, behind the list: the sheet below is the
ordinary finishing order, and a boat can be added to it by hand at any
point without stopping.

### When listening is interrupted

A phone call, another app, or the screen being switched off stops the
microphone. The app can't prevent that. It can say so:

```
│ ▲ Not listening from 12:44:10 to 12:44:52.               │
│   Boats called then were not heard. Check them against   │
│   the paper sheet.                                       │
│                                          [ OK ]          │
```

Listening restarts by itself when the page is back in front. The gap is
kept with the recording.

---

## After the last boat

**Stop** returns to the Record finishes page for the race, with the
finishing order filled in. Above it, what is left to do:

```
│  Taken by voice: 22 boats · 3 lines to check             │
│                                                          │
│  ▶  12:41:40   IRL 2016  Ghost Raider   sounded like     │
│                                    [ Yes ]  [ Change ]   │
│  ▶  12:41:31   …44                      2 boats          │
│                       [ IRL 2144 ]  [ IRL 9044 ]         │
│  ▶  12:47:15   IRL 1975  Aura            called 12:47:15 │
│                                    [ Keep ]  [ Change ]  │
```

- **▶ plays the call**: the few seconds of the recording around that line.
  This is the step that makes the sheet trustworthy, and it is why the
  recording is kept.
- Each line is settled with one tap where the app's reading was right, and
  by the sheet's ordinary editing where it wasn't.
- Every line of the finishing order below has the same ▶, for a boat the
  recorder wants to hear again.
- **Not yet recorded** lists the boats nobody called, as it does now, for
  their codes.

Then **Submit for review**, unchanged. The scorer sees a finish sheet
submission like any other. Lines still marked **check** go across as they
are, and the review shows the mark, so a recorder in a hurry can leave the
listening to the scorer.

**The recording stays on the phone.** The page offers to save a copy (the
audio and the list of calls with their times) and says when the phone's
copy will be removed. Sending it to the scorer with the sheet is a later
step, with a retention rule of its own.

---

## Checking boats in at the start

The same listening, before the start, with no times: each number called
ticks a boat as seen in the starting area, and the screen's list is the
boats still being looked for. It gives the scorer the difference between a
boat that never came out and one that started and didn't finish. It waits
until finishes work, and until a submission can carry check-ins.

---

## What this flow leaves open

| # | Question | How it gets answered |
|---|----------|----------------------|
| 1 | Do callers pause between boats in a busy finish, or run numbers together? | Recordings from real finishes |
| 2 | Is any single word after a number safe to take as the time, or does talk get caught? | Recordings from real finishes |
| 3 | Is a tone enough, or does the caller want the number read back? | The first trials |
| 4 | Cruiser callers often call the boat's name, not her number. Is matching names by sound good enough? | A trial with a cruiser fleet |
| 5 | Should a correction be spoken ("correction, one six three one")? | The first trials: how often Undo is reached for |
| 6 | Does the phone need to work from a pocket, screen off? | The first trials. If so, see ADR-017 on a native app |
| 7 | How long is the recording kept on the phone, and who may be sent it? | Before the recording leaves the phone |
