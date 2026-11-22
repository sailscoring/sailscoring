# Recording finishes by voice

The caller on the committee boat calls out each finisher as they do now,
"sixteen thirteen … now", and a phone records it through a headset. The
recording is what the feature makes: a transcript, the NOW marks and the
recognised sail numbers are layers on it, and the app suggests finishes
from them, which a person accepts. The sheet goes to the scorer for review
with its recording, unless the recorder turns that off.

- **Why it is built this way:** [ADR-017](decisions/017-voice-finish-recording.md)
- **What the recorder sees and says:** [the flow](ux/flows/voice-finish-recording.md)
- **What else does this, and what we measured:** [`notes/voice-recording/`](../notes/voice-recording/)
- **The recogniser, its bench, and a page to try it on a phone:** [voice-engine](https://github.com/sailscoring/voice-engine)

Status, November 2026: M1 to M3 are built as a proof of concept, behind the
operator-managed `voice-recording` gate, to be tried on the water, and were
rebuilt around the recording's timeline after a first trial of the check
page (#776). M0 was not done first: nothing has heard a real caller, and
the first trials are where its questions get answered. See [Trying it](#trying-it) and
[What the proof of concept leaves rough](#what-the-proof-of-concept-leaves-rough).

## How it works

1. The phone records the whole session against its own clock, and the
   presses of NOW. It needs no recogniser to do so.
2. A speech recogniser on the phone, where it has been downloaded, turns
   the sound into words with times. Nothing is sent anywhere to be
   recognised. A recording made without it can be recognised afterwards.
3. The words are read into a timeline (`timeline.ts`): snippets of speech,
   the sail numbers in them read against the entry list, and the single
   words called out after a sail number, taken as NOWs.
4. Finishes are suggested with hindsight: sail numbers and NOWs pair in
   order when their counts agree, and never when they don't. A person
   accepts each one, on the timeline or on the sheet.
5. Accepted finishes are rows of the sheet on the Record finishes page;
   suggestions sit there marked, and stay behind when it is submitted. The
   recording goes with the sheet, and the scorer can accept what was left.

## Where it lives

Arranged so it can leave the app, as the course builder did. Everything is
under a `voice` directory, and the rest of the app touches it in the few
places listed.

| Where | What |
|-------|------|
| `lib/voice/` | Pure logic, no browser: `calls.ts` (words to sail numbers), `timeline.ts` (the timeline read from a recording, and the finishes it suggests), `timeline-rows.ts` (the timeline as a list, and what the editor offers), `live.ts` (words on the phone's clock, and the tones, while recording), `sheet.ts` (finishes and suggestions onto finish rows), `audio.ts`, `types.ts` (the recording, a versioned document), `validation.ts` |
| `lib/voice/client/` | The phone: the engine's download and worker, the microphone, the recorder, its own IndexedDB database, playback, the upload |
| `lib/voice/server/` | The recording store and the API's rules |
| `components/voice/` | The setup dialog, the recording screen, the timeline (strip, list, editor), the panel on Record finishes, the scorer's review |
| `public/voice/` | The microphone worklet and the service worker. The engine (the recogniser, its worker and its model) is a release of [voice-engine](https://github.com/sailscoring/voice-engine), fetched at build by `pnpm voice:sync` as pinned in `lib/voice/engine-release.json`, and not committed |
| `lib/db/schema/voice.ts` | Two tables nothing else refers to: `voice_recordings`, `voice_recording_segments` |
| `app/api/v1/voice/`, `app/api/cron/sweep-voice-recordings/` | Its routes |

The rest of the app knows about it in these places, each a line or two:

- `components/record-finishes/record-finishes.tsx` holds the voice state,
  renders the panel, and keeps its draft on the phone when the gate is on.
- `components/finish-tab.tsx` has a `rowExtra` slot, which is where a
  row's mark (suggested, or the reason to check) and the way into the
  timeline go.
- `components/race-entry/finish-submissions-panel.tsx` and the race page
  show the recording to the scorer; the review applies what the scorer
  accepted from it with the submission.
- `lib/api-handlers/finish-submissions.ts` deletes a withdrawn sheet's
  recording.
- `lib/features.ts`, `next.config.ts` (two headers), `vercel.json` (the
  sweep), the backup workflow (the sound is left out), `package.json`.

**The data model.** A recording belongs to a race and is found by the
finish sheet submission it went with, whose id it holds without a foreign
key. Its document (format 2) holds evidence, written while recording and
never edited (takes, gaps, presses of NOW, the words heard), and decisions
(the finishes a person accepted, each under the id of its row on the sheet,
and what they said was not a finish). The readings (snippets, sail numbers,
spoken NOWs, suggestions) are never stored: they are read again from the
evidence whenever it, the entry list or the model's timing changes, and
decisions point at times and presses, never at a reading, so they survive a
new one. The submission itself is unchanged: an accepted finish is an
ordinary row of the sheet. So the public API's submissions are untouched,
and a sheet reads the same with the recording gone.

Every time is the phone's clock. A recording is one or more *takes*,
unbroken runs of sound; an interruption ends a take, and the gap is kept.
The sound is stored and sent in five-second pieces (16 kHz, µ-law on the
wire and the server), so it uploads a little at a time over a poor signal
and a review fetches only the pieces around what it plays.

**Keeping it.** The recording goes to the scorer with the sheet unless the
recorder turns that off. The phone removes its copy after 7 days. The
server's copy goes when the sheet is withdrawn, when the recorder or a
scorer deletes it, and in any case 30 days after it was sent, which a
series longer than a month outlives: it has to outlast a scoring inquiry,
and is still to be settled. A scorer's deletion is for good:
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

What a trial should bring back is M0's list: of ten calls, how many were
suggested right and how many wrong without a mark; whether the phone kept
up (the saved timeline has `realTimeFactor`); how often recording stopped;
and the saved recording with the paper sheet, for the bench.

## What the proof of concept leaves rough

- **Never run on a phone.** Chromium on a laptop only. iPhone behaviour
  (the microphone when the screen locks, how much the browser will store)
  is what ADR-017 §8 is waiting to hear about.
- **Sail numbers only.** A competitor's alternative sail numbers and bow
  number aren't on the list a call is read against.
- **Fleets timed off a stopwatch** get the order and no times.
- **Kept copies outlive a sign-out.** The page and data the service worker
  keeps for opening with no signal stay on the phone after signing out.
- **A waiting sheet needs the page open.** A phone's browser gives no way
  to send from the background.
- **Not in the activity log.** Sending or deleting a recording leaves no
  entry.
- **No help page, and no privacy policy change.** The policy has to change
  before a volunteer's voice reaches the server, which by default it now
  does: [proposed wording](../notes/voice-recording/privacy-wording.md).
- **Playback while recording** isn't offered; the editor on the recording
  screen has no Play.
- **The scorer's decisions in a review are the review's.** What the scorer
  accepts from the recording is applied with the submission, and is not
  kept in the recording: closing the review without applying forgets it.
- **No Show in recording on the race's finish sheet.** The race's
  recordings are opened from the list beside the sheet.

## Milestones

Each one ends with something a race officer can react to. The first can
end the project.

### M0. Real recordings, and a verdict

Record real finishes, with voice-engine's check page or any voice recorder, and
keep the paper sheet. Turn each into a bench session and run the candidate
recognisers over them. Try the check page on the phones recorders actually
carry: does it keep up, and how often does recording stop.

Done when we can say, for real callers: how many calls in ten go down
right without help, how many go down wrong without a mark, which model,
and whether a phone's browser holds the microphone through a finish. A
working target is nine in ten right and no more than one in a hundred
wrong and unmarked. If recognition falls well short, the recorder still
stands: it records with no recogniser, and finishes are made from its NOWs
by listening.

### M1. A first version on Record finishes

The smallest thing worth taking afloat, behind the `voice-recording` gate:

- **Record** on a race's Record finishes page, the recording screen with
  the timeline building as it goes, the tones, **NOW** and **Lock**.
- Suggested finishes on the sheet, marked; accepting them, and checking
  the rest in the timeline, with each finish played back.
- The recording and the sheet survive a reload. The recorder can save the
  recording and its timeline.
- It needs a signal to open and to submit, and none in between.

Left out on purpose: checking in at the start, result codes by voice,
spoken corrections, calling by name, opening the page with no signal, and
a native app.

### M2. Dependable on the water

Opening the page with no signal, a sheet that waits for one before it is
submitted, a choice of microphone, and whatever the first trials show is
fragile.

### M3. The recording as evidence

The recording goes to the scorer with the sheet by default, the review
plays each finish and lets the scorer accept what the recorder left, and
the recording stays beside the race for a scoring inquiry. Built; what it
still needs before it reaches anyone else is a retention rule that outlasts
a scoring inquiry and the change to the privacy policy. It gives a protest
committee something to listen to.

### M4. More of what callers say

Checking competitors in at the start, "retired" and the other codes, a
spoken correction, names for the fleets that are called by name, and
numbers run together in a busy finish. Ordered by what the trials ask for.
Later layers on the timeline: the finishing horn picked out of the sound as
a NOW nobody pressed, a second phone, and video.

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
service that transcribes recordings, and the scorer's review marks each finish
where that reading and the phone's disagree. Nothing needs a signal on the
water, every phone still hears a call the same way, and a disagreement
becomes a finish to check rather than a wrong competitor recorded with confidence.
Streaming to a service live, when the signal allows, would help the caller
but make what the phone hears depend on its signal, and leave two readings
to reconcile on the spot.

**Cost.** Small enough not to shape the design. A call is two or three
seconds, so a finish of 40 competitors is about two minutes of speech: around a cent
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
