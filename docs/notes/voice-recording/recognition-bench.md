# Recognising called sail numbers: a first bench

What was learned, on 2026-11-12 and 13, by running speech recognisers over
synthetic recordings of a caller on a finish boat. It informed
[ADR-017](../../design/decisions/017-voice-finish-recording.md). This run
used a native build of each recogniser. The bench now lives in
[voice-engine](https://github.com/sailscoring/voice-engine/tree/main/bench),
which benches each release's own WebAssembly on these same sessions,
published there as `sessions-synthetic-1`.

**Read the numbers as comparisons, not predictions.** The voices are
text-to-speech, the noise is made up, and nobody was on a boat. The first
milestone of the build replaces this with recordings of real finishes.

## What was run

- **48 sessions**, about two hours of sound. Eight voices (a text-to-speech
  model trained on the VCTK corpus's British and Irish speakers), each at
  three noise levels: none, wind-like noise 10 dB below the voice, and
  noise as loud as the voice.
- **Timed sessions**: 22 boats, each called and then "now" between a
  quarter of a second and two seconds later, a few seconds between boats,
  and other people talking in a third of the gaps ("we have about two
  minutes now before the next one"). The entry list is 26 keelboat numbers
  chosen to be confused: 1613 and 1631, 2016 and 2060, 1330 and 1333, 4078
  and 4087.
- **Burst sessions**: 34 of 40 dinghies with six-digit numbers, called by
  their last four digits about a second apart, with no "now".
- Numbers were said digit by digit ("one six one three"), in pairs
  ("sixteen thirteen"), with "oh" or "zero", and with "double".

Each recogniser's words went through the same reading
(the prototype's `calls.mjs`, now the app's `lib/voice/calls.ts`) and the result was
scored against what was called: the right boat, the wrong boat, a line left
open for a person, or nothing.

## What it showed

**1. A recogniser's words can't be taken at their spelling.** With no
sentence around them, "four" comes back as "for" or "poor", "oh" as "or" or
"of", "ninety" as "nineteen", "sixty" as "sixth". Reading the words only as
numbers put 60 to 80% of calls on the right boat. Adding a second reading,
"which boat's number, said aloud, does this sound most like", took the best
recogniser from 74 to 80% up to 86 to 93%.

**2. A keyword spotter given every boat's number does worse, not better.**
This was the closed-vocabulary idea: sherpa-onnx's 3.3M-parameter spotter
with each boat's number, in each way of saying it, as a keyword. It took
56% of calls and tuning its thresholds didn't move that. The faults are in
the method. One number that begins another (1330, 1333) fires early or not
at all, near-identical numbers split the evidence, and every way of saying
every number has to be listed in advance.

**3. "Now" can't be recognised, and doesn't need to be.** The spotter
caught 11 of 176 at best. The general recognisers wrote "no", "mow", "well", "law"
and "lock". Taking instead *any single word said on its own within six
seconds of a number* as the mark caught 82 to 92% with the best model,
whatever the word was heard as. The time lands a steady half second after
the word (0.53 to 0.62 s for the streaming models, never more than 0.8 s
at the 95th percentile), which is a constant to subtract.

**4. Confident mistakes were rare.** Of 176 timed calls per noise level,
between 0 and 6 went down as the wrong boat, and nearly all of those were
"sounds like" suggestions, which the design marks for checking. Across the
burst sessions, at most 2 of 272 were wrong without that mark.

**5. Talk stayed out.** Between 0 and 3 lines in each set of eight
sessions came from conversation, though the talk included number words and
"now".

## The recognisers

Right boat, as a percentage of calls, at no noise / 10 dB / 0 dB. "As a
suggestion" is the share of timed calls that were right only by sound.

| Recogniser | Licence | Size | Timed | Burst | As a suggestion |
|------------|---------|------|-------|-------|-----------------|
| Zipformer English 20M, streaming | Apache 2.0 | 44 MB | 73 / 70 / 67 | 83 / 76 / 71 | about 22% |
| Zipformer English 2023-06-26, streaming | Apache 2.0 | 72 MB | 76 / 80 / 76 | not run | about 23% |
| Kroko English, streaming | CC BY-SA | 68 MB | 86 / 93 / 88 | 90 / 81 / 80 | about 14% |
| Moonshine tiny, cut at silences | MIT | 43 MB | 73 / 80 / 67 | 81 / 63 / 64 | about 18% |
| Parakeet 110M, cut at silences | CC BY 4.0 | 126 MB | 86 / 92 / 84 | not run | about 24% |

- The sessions differ between noise levels, so a few points either way
  within a row is chance.
- **Parakeet is there as a ceiling.** A recogniser that size getting no
  further than 92% says the synthetic voices themselves garble about one
  call in ten. Kroko is at that ceiling. The Apache-licensed Zipformers are
  ten to twenty points under it.
- Cutting at silences and recognising each piece whole gives better times
  (the mark lands 0.2 to 0.4 s late rather than 0.55 s) and costs less
  than half the computing. It hears nothing until the caller stops.
- All of them run several times faster than real time on a laptop: 0.01 to
  0.07 seconds of computing for a second of sound, on two threads. In a
  browser, as WebAssembly on one thread, the 72 MB Zipformer took 0.10 to
  0.15.

## In a browser

The prototype page (now voice-engine's [check page](https://github.com/sailscoring/voice-engine/tree/main/check)) runs the same
recognisers as WebAssembly, on one thread, and was driven in headless
Chromium at phone size with one of the timed sessions, both as a file and
through a simulated microphone in real time.

| Recogniser | Computing per second of sound | Words arrive after | A line appears after the call |
|------------|-------------------------------|--------------------|-------------------------------|
| Zipformer English 20M | 0.05 s | 0.4 s | about 1.8 s |
| Zipformer English 2023-06-26 | 0.11 s | 0.4 s | about 1.8 s |
| Kroko English | 0.07 s | 1.5 s | about 2.8 s |

- These are a laptop's figures. A phone will be several times slower, and
  whether it stays under real time is for the first milestone to measure.
- A line waits for a one-second pause to be sure the call is over, then for
  the recogniser's own delay. Kroko hands its words over in larger pieces,
  so its better hearing costs a second. A call that is already one boat's
  whole number, and the start of no other's, wouldn't have to wait for the
  pause at all. That is not built.
- The engine is a 13 MB download, beside the model.
- The page read the session as the native bench did: 21 of 22 boats with
  Kroko, 16 of 22 with the larger Zipformer.

## What it doesn't show

- How any of this does with a person shouting numbers into wind. Real
  callers may be easier than these voices or much harder.
- Whether callers leave the pause between boats that the reading relies on.
- Whether the "any single word" rule for the time survives real talk on a
  committee boat.
- How a phone copes. The browser figures are a laptop's.
- Boat names. Only numbers were called.

## Running it again

voice-engine's [bench](https://github.com/sailscoring/voice-engine/tree/main/bench) runs a release over these
sessions and scores it with the app's own reading of calls. Its first run,
on release v1 (the larger Zipformer above), gave 76.7 / 79.5 / 76.1% right
for the timed sessions and 77.2 / 72.4 / 76.5% for the burst ones, with
"now" landing 0.60 to 0.66 s late.

It benches the streaming recognisers a release can carry. The native runs
above of Moonshine and Parakeet, cut at silences, and of the keyword
spotter, were made with the prototype's own bench, which is in this repo's
history (`prototypes/voice/bench/run.mjs`, removed in November 2026).
