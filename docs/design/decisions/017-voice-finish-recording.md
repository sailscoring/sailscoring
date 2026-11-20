# ADR-017: Recording finishes by voice

**Status:** Proposed

**Date:** 2026-11-13

**Deciders:** Mark McLoughlin

## Context

On a committee boat one official calls each finisher ("sixteen thirteen …
now") while two others write the sail number and the time down, twice, so
the sheets can be checked against each other. A scorer types the sheet in
later. The horizon has long carried an entry for doing the writing by
voice: a phone listens through a headset and takes the sheet down.

That entry was a first cut, written before most of what it needs existed.
Three things have changed.

- **The path a recording takes to the scorer exists.** The Record finishes
  page, the recorder role and finish sheet submissions (#671) let someone
  who isn't the scorer take a race's finishes down on a phone and hand them
  over for review. [ADR-016](016-authenticated-public-api.md) gives an
  outside app the same thing through the `submissions` scope. So this
  decision is only about capture: how spoken calls become lines of that
  sheet.
- **We looked at what else does this.** Nothing recognises called sail
  numbers against an entry list. A voice recorder beside the paper sheet is
  already ordinary practice, and one app ships exactly that. The one
  attempt at recognition found used general dictation and reported "9 to 5"
  for "925". See [the survey](../../notes/voice-recording/prior-art.md).
- **We measured the horizon entry's design, on synthetic recordings.** It
  proposed a keyword spotter for the word "now" and a recogniser held to
  the entry list for the number, both in sherpa-onnx. The spotter caught
  one "now" in sixteen at best. Given every boat's number as its keywords,
  it took a little over half the calls. General recognisers took 60 to 80%
  when their words were read literally, and the best of them 86 to 93% when
  its words were read against the entry list by sound. See
  [the bench](../../notes/voice-recording/recognition-bench.md), and its
  warning: those are text-to-speech voices and made-up wind.

The requirement is narrow: **record finishes by voice, through a phone or a
tablet.** Checking boats in at the start is the same listening with less to
do, and follows.

What nobody knows yet is whether a phone can hear a person calling numbers
in a breeze well enough to be worth having. Everything below is arranged to
find that out early and cheaply.

## Decision Drivers

- **Feedback first.** The largest unknown, recognition of real calls in
  wind, doesn't depend on how the thing is packaged. The first version
  should be whatever gets real recordings and a race officer's reaction
  soonest.
- **Nothing called is lost.** The recording is the authority, as the tape
  recorder beside the paper sheet is now. The software assists; it doesn't
  decide.
- **A wrong boat taken down with confidence is the worst outcome.** A line
  left open costs a moment. A wrong line nobody questioned costs a result.
- **No signal on the water.** Once it has started, it works without one.
- **Eyes on the line.** The caller can't be reading a screen.
- **The same ears everywhere.** A caller's phone, the next caller's
  different phone and a club tablet should hear a call the same way.
- **It fits what exists.** The recorder's page, the scorer's review, and
  MIT licensing.
- **Volunteers' voices are personal data.** What is said on the boat should
  stay on the phone unless someone decides otherwise.

## Considered Options

### Axis 1: Where it runs

**A page in the web app.** Voice becomes a way of filling in the sheet on
the Record finishes page.

- Nothing to install: a volunteer on the rota opens a link. A change is
  deployed the day it's made.
- Reuses the recorder's sign-in, race picker, sheet and submission.
- A page gets the microphone only while it is on screen with the phone
  awake. On an iPhone a call or the lock button stops it. The page can keep
  the screen on, and can say afterwards that it stopped. It can't listen
  from a pocket.
- No hardware buttons, and little say over which microphone is used.

**Native iOS and Android apps.**

- The best capture there is: listening with the screen off, from a pocket,
  through a chosen headset, with a volume button to mark a time.
- Each platform's own recogniser is free to use, but they are two different
  recognisers, so the two apps would hear differently. Apple's newer
  long-form recogniser doesn't take a vocabulary, and Android's depends on
  the device. In practice both apps would embed the same engine the web
  page would.
- Two codebases, two store reviews, and an install and sign-in before a
  volunteer's first race. Every round of feedback takes days, not minutes.
- It would be a client of ADR-016's public API. Sign-in and the
  `submissions` calls are already there.

**One app from web technology in a native shell.** The page's screens, with
the microphone and the recogniser moved into native code (a Capacitor-style
wrapper, or React Native).

- Most of native capture's advantages for one extra layer, not a rewrite.
- Still two stores and an install.
- Only worth it once we know which of native's advantages are needed.

**A separate web client on the public API.** The same page, but outside the
app, signing in with OAuth as RaceOps would.

- Proves the public API with a first-party client.
- More to build before the first trial, for no difference a caller would
  notice. The shell option above would want this shape, so it is where a
  wrapped app would start.

### Axis 2: What turns speech into words

**The browser's own speech recognition.** No download. But it is a
different recogniser in every browser, it sends audio to a server unless
the browser offers an on-device mode (Chrome does, Safari doesn't promise
it), it gives no word times, and it is tuned for sentences. This is what
turned "925" into "9 to 5".

**Each phone's native recogniser.** Native apps only, and two behaviours to
tune. See above.

**A recognition service.** The best recognisers there are, and no model to
download. It needs a steady signal on the water, sends volunteers' voices
to a third party, and costs per minute.

**An open-source recogniser on the device.** A model of 40 to 130 MB,
downloaded once.

- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) (Apache 2.0) runs
  the same models in a browser as WebAssembly and natively on iOS and
  Android, is actively maintained, and covers streaming recognition,
  recognition of whole utterances, voice-activity detection and keyword
  spotting. We built it for the browser and ran it: the 72 MB model used
  0.10 to 0.15 seconds of one laptop core per second of sound.
- Vosk does the same job with a grammar that restricts the words, on older
  models. Its browser build was last released in 2022.
- transformers.js runs models in a browser, but not in a native app.

### Axis 3: How words become a line of the sheet

**Spot "now", and hold the recogniser to the entry list.** The horizon's
design. On the bench the spotter couldn't find "now", and the same spotter
given the boats' numbers took 56% of calls: a number that begins another
fires early or never, look-alike numbers split the evidence, and every way
of saying every number has to be listed. Biasing a recogniser towards the
entry list, as distinct from spotting, was not tried.

**Take a general recogniser's words literally.** 60 to 80% on the bench.
"Four" arrives as "for", "oh" as "or", "ninety" as "nineteen".

**Read a general recogniser's words against the entry list.** First as
numbers: the whole number, or trailing digits only one boat has. Failing
that, by which boat's number, said aloud, the words sound most like, and
only as a suggestion. 86 to 93% with the best model, with nearly every
wrong line among the suggestions. For the time, take any single word said
after a number, whatever it was heard as: 82 to 92% caught, a steady half
second late.

## Decision

### 1. A page in the web app first

Voice is built into the Record finishes page, behind an operator-managed
feature gate, `voice-recording`. It is the fastest way to a trial, and the
trial is what tells us whether the rest is worth doing. The listening
screen is described in
[the flow](../ux/flows/voice-finish-recording.md).

A native app is not ruled out. §8 says what would bring one.

### 2. Recognition happens on the device, with sherpa-onnx

Built as WebAssembly from a pinned release, running in a worker. The engine
and the model are fetched at the app's build from a pinned release, as the
canonical logos are, and served as static files. They are not committed
here. A phone downloads them once.

Nothing that is said leaves the phone to be recognised.

### 3. Words are read against the entry list, in plain TypeScript

The recogniser's only job is words with times. Deciding what was called is
ours, in a module with no dependency on the engine or the browser, so the
same reading runs on a page, in a test, on the bench, and in a native shell
if there is one. Its rules:

- A number that is one boat's whole number, or the trailing digits of only
  one boat's, is that boat.
- Words that are no number on the list but sound like exactly one boat's
  are that boat **as a suggestion**: the line is marked for checking until
  a person confirms it.
- Words that fit several boats, or a number on no entry, make an unknown
  boat for a person to resolve, as a typed number does today.
- A boat called a second time doesn't get a second line.
- Anything else is talk, and ignored.

The app never invents a boat and never resolves a doubt silently.

### 4. The time comes from when the caller spoke, or from a tap

A line's time is, in order: a press of **Now**; the single word called
after the number, whatever the recogniser took it for; or the moment the
number was called, shown as such. The recogniser's delay is a measured
constant and is subtracted.

The number never moves the time and the time never moves the number. That
was the horizon entry's central point, and it stands.

### 5. The recording is always kept, and stays on the phone for now

The whole session is recorded against the phone's clock, with the list of
what was heard. Every line can be played back from it, which is how a
marked line gets checked. The recorder can save a copy.

Sending the recording to the scorer with the sheet is a later step. It
needs a retention rule and a change to the privacy policy, and is decided
then.

### 6. What it produces is a finish sheet submission

The lines fill the same draft the recorder types into, and it is submitted
for review as it is now. The first version adds nothing to the server.
Start check-ins need a submission to carry them, which it doesn't yet.

### 7. The model is chosen on real recordings, from permissive licences

The first build uses the Apache-licensed English Zipformer of June 2023
(72 MB). On the synthetic bench the Kroko community model was ten to
fifteen points better. Its licence is CC BY-SA. Whether a share-alike
*model*, fetched at run time and not part of the code, sits within the
project's MIT policy is left open until real recordings show whether the
gap is real. The candidates and how they are scored are in the bench notes.

### 8. What would bring a native app

Any of these, seen in trials:

- Listening stops by itself more than rarely during a race, on a phone kept
  awake and in hand.
- Recorders need the phone in a pocket with the screen off, which rain
  makes likely.
- The headset's microphone can't be relied on from the browser.
- A current phone can't run the chosen model faster than real time in the
  browser.

The response would be the third option on Axis 1: the same screens and the
same reading of calls, with the microphone and the recogniser moved into a
native shell on sherpa-onnx's iOS and Android builds, signing in through
ADR-016 as a connected app. Two fully native apps are not proposed.

## Consequences

### Positive

- A race officer can try it from a link within the first milestone.
- The part most likely to need rework, the recogniser, is behind the
  narrowest possible interface: words with times.
- Each trial leaves a recording that makes the bench more truthful.
- No sub-processor, no per-minute cost, and no speech leaving the phone.
- Even where recognition fails, the page is still a timed voice recorder
  with a **Now** button and a sheet to type into, which is more than a
  dictaphone gives.

### Negative

- The phone has to stay awake and in hand. That is a real cost on a wet
  committee boat and may be what forces §8.
- An 85 MB download before first use (the engine and the model), which
  needs a signal.
- A second, small build pipeline for the engine.
- The reading relies on a pause between boats. A crowded finish may not
  give one.

### Risks

- **Real callers in wind defeat the recogniser.** Nothing here has heard
  one. The first milestone is recordings of real finishes run through the
  bench, before any of the app is built, and it can end the project.
- **The synthetic bench flatters or slanders an approach.** Its voices
  garble about one call in ten by themselves. The spotter and "now"
  results were decisive enough to act on; the ranking of models is not.
- **The time rule catches talk.** Any single word after a number counts. A
  real committee boat may say single words for other reasons. The **Now**
  button and the time of the call are the fallbacks.
- **The phone's clock disagrees with the committee's.** Every time comes
  from it. Setup shows it for comparison.
- **Training data terms.** The engine and the models named are permissively
  licensed, but a model's training corpus can carry its own conditions.
  Each candidate's is checked before it ships.
- **iOS changes what a page may do with the microphone.** It has before.
  The gap detection in the flow is the defence, and §8 the remedy.

## Related Decisions

- [ADR-007](007-finish-sheet-model.md): the sheet voice fills in, one
  ordered list with an optional time on each row.
- [ADR-016](016-authenticated-public-api.md): finish sheet submissions, and
  how a native shell would sign in.
- [ADR-006](006-testing-and-logging.md): the reading of calls is pure logic
  and is tested as such.

## References

- [The flow](../ux/flows/voice-finish-recording.md) and
  [the milestones](../voice-recording.md)
- [What already exists](../../notes/voice-recording/prior-art.md)
- [The bench](../../notes/voice-recording/recognition-bench.md)
- [voice-engine](https://github.com/sailscoring/voice-engine): the recogniser's build, its bench, and a page to
  try a release on a phone (the prototype, reworked)
- WebKit bugs on the microphone when a page leaves the screen:
  [204681](https://bugs.webkit.org/show_bug.cgi?id=204681) (Safari in the
  background), [236509](https://bugs.webkit.org/show_bug.cgi?id=236509)
  (an installed web app), and
  [319706](https://bugs.webkit.org/show_bug.cgi?id=319706) (iOS 26)
- MDN, [`SpeechRecognition.processLocally`](https://developer.mozilla.org/docs/Web/API/SpeechRecognition/processLocally)
- Apple developer forums, [contextual strings and the SpeechAnalyzer modules](https://developer.apple.com/forums/thread/811083)
