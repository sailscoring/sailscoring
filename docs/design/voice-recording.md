# Recording finishes by voice

The caller on the committee boat calls each finisher as they do now,
"sixteen thirteen … now", and a phone listening through a headset takes
the sheet down: the boat, and the time where the fleet needs one. The
recorder checks the lines the app wasn't sure of, by playing them back,
and submits the sheet for the scorer to review.

- **Why it is built this way:** [ADR-017](decisions/017-voice-finish-recording.md)
- **What the recorder sees and says:** [the flow](ux/flows/voice-finish-recording.md)
- **What else does this, and what we measured:** [`notes/voice-recording/`](../notes/voice-recording/)
- **Something to try now:** [the prototype](../../prototypes/voice/README.md)

Status, November 2026: proposed. A prototype page and a bench exist.
Nothing has heard a real caller.

## How it works

1. The phone records the whole session against its own clock.
2. A speech recogniser on the phone turns the sound into words with times.
   Nothing is sent anywhere to be recognised.
3. Each run of words is read against the race's entry list. A number that
   is one boat's is that boat. Words that only sound like one boat's number
   are that boat as a suggestion, marked for checking. Anything else that
   looks like a number is an unknown boat, and the rest is talk.
4. The time of a line is a press of **Now**, or the single word called
   after the number, or failing both the moment of the call.
5. The lines fill the finishing order on the Record finishes page, and go
   to the scorer as a finish sheet submission.

## Milestones

Each one ends with something a race officer can react to. The first can
end the project.

### M0. Real recordings, and a verdict

Record real finishes, with the prototype page or any voice recorder, and
keep the paper sheet. Turn each into a bench session and run the candidate
recognisers over them. Try the prototype on the phones recorders actually
carry: does it keep up, and how often does listening stop.

Done when we can say, for real callers: how many calls in ten go down
right without help, how many go down wrong without a mark, which model,
and whether a phone's browser holds the microphone through a finish. A
working target is nine in ten right and no more than one in a hundred
wrong and unmarked. If recognition falls well short, stop here and keep
the recorder: the page is still a timed dictaphone with a **Now** button.

### M1. A first version on Record finishes

The smallest thing worth taking afloat, behind the `voice-recording` gate:

- **Listen** on a race's Record finishes page, the listening screen, the
  tones, **Now**, **Undo** and **Lock**.
- Lines land in the same finishing order the recorder types into, marked
  where the app wasn't sure, and are settled before submitting, with each
  call played back.
- The recording and the sheet survive a reload. The recorder can save the
  recording and the list of calls.
- It needs a signal to open and to submit, and none in between.

Left out on purpose: checking in at the start, result codes by voice,
spoken corrections, boat names, sending the recording to the scorer,
opening the page with no signal, and a native app.

### M2. Dependable on the water

Opening the page with no signal, a sheet that waits for one before it is
submitted, a choice of microphone, and whatever the first trials show is
fragile.

### M3. The recording as evidence

The recording goes to the scorer with the sheet, and the review plays each
line. This needs a retention rule and a change to the privacy policy, and
gives a protest committee something to listen to.

### M4. More of what callers say

Checking boats in at the start, "retired" and the other codes, a spoken
correction, boat names for the fleets that are called by name, and numbers
run together in a busy finish. Ordered by what the trials ask for.

### M5. A native shell, if the trials call for one

ADR-017 lists what would. The screens and the reading of calls carry over;
the microphone and the recogniser move into native code.
