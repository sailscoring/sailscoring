# Recording finishes by voice

The caller on the committee boat calls each finisher as they do now,
"sixteen thirteen … now", and a phone listening through a headset takes
the sheet down: the boat, and the time where the fleet needs one. The
recorder checks the lines the app wasn't sure of, by playing them back,
and submits the sheet for the scorer to review.

- **Why it is built this way:** [ADR-017](decisions/017-voice-finish-recording.md)
- **What the recorder sees and says:** [the flow](ux/flows/voice-finish-recording.md)
- **What else does this, and what we measured:** [`notes/voice-recording/`](../notes/voice-recording/)
- **The recogniser, its bench, and a page to try it on a phone:** [voice-engine](https://github.com/sailscoring/voice-engine)

Status, November 2026: M1 to M3 are built as a proof of concept, behind the
operator-managed `voice-recording` gate, to be tried on the water. M0 was
not done first: nothing has heard a real caller, and the first trials are
where its questions get answered. See [Trying it](#trying-it) and
[What the proof of concept leaves rough](#what-the-proof-of-concept-leaves-rough).

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

## Where it lives

Arranged so it can leave the app, as the course builder did. Everything is
under a `voice` directory, and the rest of the app touches it in the few
places listed.

| Where | What |
|-------|------|
| `lib/voice/` | Pure logic, no browser: `calls.ts` (words to calls), `session.ts` (a spell of listening: lines, Now, Undo, the time rules), `sheet.ts` (lines onto finish rows, and what is left to settle), `audio.ts`, `types.ts` (the list of calls, a versioned document), `validation.ts` |
| `lib/voice/client/` | The phone: the engine's download and worker, the microphone, the recorder that ties them to a session, its own IndexedDB database, playback, the upload |
| `lib/voice/server/` | The recording store and the API's rules |
| `components/voice/` | The setup dialog, the listening screen, the panel on Record finishes, the scorer's playback |
| `public/voice/` | The microphone worklet and the service worker. The engine (the recogniser, its worker and its model) is a release of [voice-engine](https://github.com/sailscoring/voice-engine), fetched at build by `pnpm voice:sync` as pinned in `lib/voice/engine-release.json`, and not committed |
| `lib/db/schema/voice.ts` | Two tables nothing else refers to: `voice_recordings`, `voice_recording_segments` |
| `app/api/v1/voice/`, `app/api/cron/sweep-voice-recordings/` | Its routes |

The rest of the app knows about it in these places, each a line or two:

- `components/record-finishes/record-finishes.tsx` holds the voice state,
  renders the panel, and keeps its draft on the phone when the gate is on.
- `components/finish-tab.tsx` has a `rowExtra` slot, which is where a
  row's ▶ goes.
- `components/race-entry/finish-submissions-panel.tsx` and the race page
  show the recording to the scorer.
- `lib/api-handlers/finish-submissions.ts` deletes a withdrawn sheet's
  recording.
- `lib/features.ts`, `next.config.ts` (two headers), `vercel.json` (the
  sweep), the backup workflow (the sound is left out), `package.json`.

**The data model.** A recording belongs to a race and is found by the
finish sheet submission it went with, whose id it holds without a foreign
key. The submission itself is unchanged: a line taken by voice is an
ordinary row of the sheet, and the recording's list of calls says, by the
row's id, which call it came from and what was in doubt. So the public
API's submissions are untouched, and a sheet reads the same with the
recording gone.

Every time is the phone's clock. A recording is one or more *takes*,
unbroken runs of sound; an interruption ends a take, and the gap is kept.
The sound is stored and sent in five-second pieces (16 kHz, µ-law on the
wire and the server), so it uploads a little at a time over a poor signal
and a review fetches only the pieces around the line it plays.

**Keeping it.** The phone removes its copy after 7 days. The server's copy
goes when the sheet is withdrawn, when the recorder or a scorer deletes it,
and in any case 30 days after it was sent. A scorer's deletion is for good:
the phone it came from, which still has its own copy, is refused if it
sends it again. Whoever made it and anyone who can score may hear it. The sound is in Postgres for now and is left out of
the database backups, which are kept longer than a recording is. Both
numbers are first guesses (`lib/voice/types.ts`).

## Trying it

1. Get the engine: `pnpm voice:sync` (also run by `prebuild`) fetches the
   [voice-engine](https://github.com/sailscoring/voice-engine) release
   pinned in `lib/voice/engine-release.json`. To try a build of your own,
   assemble one in a voice-engine checkout as its README says, then
   `pnpm voice:sync --from <checkout>/dist/<release>`.
2. Turn on `finish-submissions` and `voice-recording` for the workspace
   (see [workspace provisioning](../workspace-provisioning.md)).
3. Open **Record finishes**, pick the race, **Set up**. Do this ashore.

`e2e/voice-recording.spec.ts` runs the whole flow with a scripted
recogniser. `e2e/voice-real-engine.spec.ts` runs the real one against a
synthetic caller, on a machine that has the engine and `flite`.

What a trial should bring back is M0's list: of ten calls, how many went
down right and how many wrong without a mark; whether the phone kept up
(the saved list of calls has `realTimeFactor`); how often listening
stopped; and the saved recording with the paper sheet, for the bench.

## What the proof of concept leaves rough

- **Never run on a phone.** Chromium on a laptop only. iPhone behaviour
  (the microphone when the screen locks, how much the browser will store)
  is what ADR-017 §8 is waiting to hear about.
- **Sail numbers only.** A boat's alternative sail numbers and bow number
  aren't on the list a call is read against.
- **Fleets timed off a stopwatch** get the order and no times.
- **Kept copies outlive a sign-out.** The page and data the service worker
  keeps for opening with no signal stay on the phone after signing out.
- **A waiting sheet needs the page open.** A phone's browser gives no way
  to send from the background.
- **Not in the activity log.** Sending or deleting a recording leaves no
  entry.
- **No help page, and no privacy policy change.** The policy has to change
  before a volunteer's voice reaches the server:
  [proposed wording](../notes/voice-recording/privacy-wording.md).

## Milestones

Each one ends with something a race officer can react to. The first can
end the project.

### M0. Real recordings, and a verdict

Record real finishes, with voice-engine's check page or any voice recorder, and
keep the paper sheet. Turn each into a bench session and run the candidate
recognisers over them. Try the check page on the phones recorders actually
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

## Follow-up: a second hearing online

Recognising on the phone is what makes this work with no signal, and it
probably costs some accuracy. An online recognition service would hear
better, and most of them can be told what to expect: the entry list's sail
numbers can be given as expected words (Deepgram, AssemblyAI, Google, Azure
and Speechmatics all offer this; SailScores uses Azure's). It would replace
only the step from sound to words. Reading the words against the entry list
stays as it is.

**After the race, not during it.** The recording already reaches the server
in five-second pieces. Once it is all there, the server can send it to a
service that transcribes recordings, and the scorer's review marks each line
where that reading and the phone's disagree. Nothing needs a signal on the
water, every phone still hears a call the same way, and a disagreement
becomes a marked line rather than a wrong boat taken down with confidence.
Streaming to a service live, when the signal allows, would help the caller
but make what the phone hears depend on its signal, and leave two readings
to reconcile on the spot.

**Cost.** Small enough not to shape the design. A call is two or three
seconds, so a 40-boat finish is about two minutes of speech: around a cent
a race at transcription prices (roughly $0.003 to $0.005 a minute), a few
dollars to a few tens of dollars for a club's season. A per-workspace quota
of minutes, behind its own gate and counted so the real cost is visible, is
enough to start with.

**What it needs first.**

- **Evidence that it's better.** Run M0's real recordings through two or
  three services with the entry list as expected words, scored as the bench
  scores the on-device candidates. Without that number this is a guess.
- **A privacy policy change.** The service becomes a sub-processor of
  volunteers' voices: a data processing agreement, an EU endpoint, and the
  service's settings for not training on or keeping the sound.
