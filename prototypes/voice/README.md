# Finishes by voice: prototype

A single page that listens to sail numbers being called and takes them down
as a finishing order, on the device, with nothing sent anywhere. It exists to
answer the questions
[ADR-017](../../docs/design/decisions/017-voice-finish-recording.md) can't
answer from a desk: can a phone's browser hear a caller on a committee boat,
and does the [flow](../../docs/design/ux/flows/voice-finish-recording.md)
feel right in the hand.

**Throwaway.** It isn't part of the app: no sign-in, no races, no
submission. The entry list is typed into a box and everything is gone on
reload. What is meant to survive is `calls.mjs`, the part that reads a
recogniser's words as calls, and what the bench in `bench/` measures.

The app now has its own version of this, on the Record finishes page: see
[`docs/design/voice-recording.md`](../../docs/design/voice-recording.md).
`calls.mjs` lives on there as `lib/voice/calls.ts`. The engine the app
serves is a release of
[voice-engine](https://github.com/sailscoring/voice-engine), which builds
it in CI; the build here is the prototype's own. This page stays for the
bench, and for trying a model the app doesn't ship, until both move to
voice-engine too.

## Trying it

The listening engine and its models aren't committed (13 MB and 180 MB).
They live in `engine/`, which git ignores.

```
./fetch-models.sh        # the models, from the sherpa-onnx releases
./build-engine.sh        # the engine: about ten minutes, needs cmake
pnpm voice-prototype     # serve it over HTTPS; prints the addresses
```

A phone's browser gives a page the microphone only over HTTPS, so the
server makes itself a certificate the first time it runs. Open the address
it prints for the local network on a phone on the same Wi-Fi, and accept
the warning about the certificate. On the water there is no Wi-Fi: load the
page ashore, keep it open, and it carries on working, since nothing after
the first load needs a connection.

Then:

1. Replace the entry list with real sail numbers and names, one boat a line.
2. Pick a model. The larger Zipformer is the one we could ship today.
3. **Listen**, and call boats: "sixteen thirteen … now".
4. **Stop**, and settle the lines it wasn't sure of. ▶ plays each call back.
5. **Save the recording** and **Save the list of calls**. A recording of a
   real finish, with the paper sheet beside it, is what the bench most
   needs.

**Run a recording…** puts a sound file through the same ears, faster than
real time. It is how a recording made on a voice recorder gets tried
against a new model or a changed `calls.mjs`.

## What to watch for on a phone

- Does **Listen** start at all? iPhone needs iOS 16.4 or later.
- The last line of the sheet says how long recognising took for each second
  of sound. Above about 0.7, the phone can't keep up with that model.
- Lock the phone or take a call while it listens. The page should come back
  saying when it wasn't listening.
- A headset: does the page name it, and do the tones come through it?
- Wind. The reason for all of this.

## What's here

| File | What it is |
|------|------------|
| `calls.mjs` | Words with times in, calls out: the sail-number reading, the matching against the entry list, and the rule for what fixes a time. No engine, no browser. |
| `app.js`, `index.html` | The microphone, the screen, the tones. |
| `listener-worker.js` | The recogniser, off the main thread. |
| `serve.mjs` | The local HTTPS server. |
| `bench/` | Scores recognisers on recordings whose calls are known. |

## The bench

`bench/run.mjs` runs each recogniser natively (not in a browser) over a
directory of sessions, each a 16 kHz mono `.wav` with a `.json` beside it
saying what was called and when, and scores what `calls.mjs` makes of the
words. `bench/gen/gen.mjs` makes synthetic sessions from text-to-speech
voices and wind-like noise. Both are plain Node, installed with `npm` in
their own directories, apart from the app's dependencies.

```
cd bench && npm install
node run.mjs <models dir> <sessions dir> [engine …]
```

The method and the first results are in
[`docs/notes/voice-recording/recognition-bench.md`](../../docs/notes/voice-recording/recognition-bench.md).
