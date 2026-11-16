# Recording finishes by voice: what already exists

A survey of apps and practices near
[recording finishes by voice](../../design/decisions/017-voice-finish-recording.md),
made on 2026-11-12 from public pages, app-store listings and forum threads.
None of these apps was run. Where a claim comes from a listing rather than
from the app's own documentation, it says so.

Nothing found recognises hailed sail numbers against an entry list and
writes a finish sheet. The nearest are an app that records the hails for a
person to transcribe, and one that ran general dictation over them.

## How a finish line is recorded now

The paper process is a caller, a timekeeper and one or two recorders. A
voice recorder running beside them is already ordinary practice:

- TopYacht's *Getting Fast and Accurate Results at a Regatta* has the
  caller's sail numbers written down by scribes and "recorded on a hand
  held tape recorder (this is essential!!!)".
- Southport SC's duty manual gives the recorder the times from the
  timekeeper and the sail numbers from a spotter who announces each boat as
  she crosses.
- A Yachting and Boating World forum thread describes "two people and a
  voice memo". A Yachts and Yachting thread suggests a timed dictaphone for
  boats whose numbers can't be read as they cross.
- World Sailing's race management policies require a hand-held voice
  recorder for the line sighters at the start. No finish-line equivalent was
  found.

So the recording is not a new artefact to argue for. The feature is that
recorder, understanding what it hears, with the recording kept as the
authority.

## Sailing apps

| App | What it does at the finish | What it tells us |
|-----|----------------------------|------------------|
| Regatta Start Timer (Android) | A voice recorder for the finish boat: read out the sail numbers, share the clip with the race office. Records with the screen off. A later release lists "clearer finish-boat voice notes in wind". No recognition (store listing). | Recording alone is worth shipping. Recording with the screen off is something a native app can do and a web page can't. |
| OOD2 (ood2.net) | A "timed dictaphone" that logs recognised words with times. It runs only in Chrome, which suggests the browser's own speech recognition. Its author reports "9 to 5" for "925" (forum post). | General dictation mangles bare numbers. What is heard has to be read against the entry list. |
| SailScores (sailscores.com) | Speech entry of the finishing order on the race editor, for paying supporter clubs. It uses Azure's cloud recognition, with a phrase list built from the entry list's sail numbers and names and from the score codes, so the recogniser is biased towards what can be said. A score code said after a sail number sets that boat's code. It records order, not times (source on GitHub, MPL-2.0). | Biasing recognition towards the entry list is the established approach. It needs a network connection, which a finish boat may not have; ADR-017 recognises on the device and reads the words against the entry list afterwards. |
| RaceTac Committee, Regatta Score (iOS) | RaceTac logs a finish time with a tap on a large clock. Regatta Score has the recorder tap each boat as she crosses (store listings). | A tap for the time is the pattern existing apps settled on. |
| RaceOps (GBSC) | Records finishes offline on the water. See [related apps](../../design/related-apps.md). | The kind of app the `submissions` scope is for; voice would be another. |
| Vakaros RaceSense | Finishes detected from units the boats carry. Already imported. | Where boats carry trackers nobody calls numbers. Voice is for the racing that doesn't. |

The forum threads give the case against keypads: in a busy finish the
recorder can't type fast enough, while on paper a pair written in the wrong
order is "dead easy to mark" for later correction. Whatever replaces paper
has to make a doubtful line as easy to flag.

## Other sports

- **CrewTimer** (rowing). A time is taken with an on-screen or external
  button, and the bow number is matched to it afterwards, with an undo
  (store listing). Time first, identity after, and a hardware button for
  the time.
- **RaceDay Mobile** (running). Bibs go in by typing, a Bluetooth number
  pad or scanning a tag. **RunSpeaker** lets an announcer say a bib number
  to bring up the runner. That is a lookup against a known list, which
  is half of what we want, but it isn't used for timing.
- **Darts scorers** (DartCounter's voice entry, Darts26, the open-source
  finnegan). A small vocabulary of numbers spoken in a noisy room. The
  offline ones recognise on the device. No field measurements were found.

## Voice-directed warehouse picking

The closest industrial relative: a small vocabulary, a noisy place, a
headset, hands and eyes busy. Vendor guides agree on four things:

1. A close-talking, noise-cancelling headset is treated as essential.
2. The vocabulary is constrained to what can be said at that step.
3. Every spoken entry is confirmed. The picker reads check digits off the
   shelf and the system won't move on until they match. The accuracy the
   industry quotes comes from that confirmation, not from the recogniser.
4. The fallback for a failed headset is planned in advance.

The accuracy figures are vendors' own.

## Sources

- TopYacht, [Expectations of race management and admin staff](https://topyacht.com.au/web/?p=1117) and *Getting Fast and Accurate Results at a Regatta*
- [Southport SC race committee duty manual](https://racing.southportsailingclub.com/PDF/RCDutyManual.pdf)
- [YBW forum: yacht and dinghy race timing app](https://forums.ybw.com/threads/yacht-dinghy-race-timing-app.527413/page-2)
- [World Sailing race management policies](https://www.sailing.org/tools/documents/WorldSailingRaceManagementPoliciesJune2016-[20939].pdf)
- [Regatta Start Timer](https://play.google.com/store/apps/details?id=org.stimer.app), [RaceTac Committee](https://apps.apple.com/us/app/id1442574155), [Regatta Score](https://apps.apple.com/us/app/regatta-score/id979994804), [CrewTimer](https://apps.apple.com/us/app/id1450216565)
- [RaceDay Mobile timing app](https://help.runsignup.com/support/solutions/articles/17000125950-mobile-timing-app), [RunSpeaker](https://apps.apple.com/us/app/-/id6756875851)
- SailScores: [`raceEditor.ts`](https://github.com/SailScores/SailScores/blob/master/SailScores.Web/Scripts/raceEditor.ts), *Entering race results* help page
- [finnegan](https://github.com/gurushida/finnegan), [Darts26](https://apps.apple.com/app/id6760676550)
- Voice picking: [Cleverence](https://www.cleverence.com/articles/3pl-business/implement-voice-directed-picking-warehouse-4829/), [RFgen](https://www.rfgen.com/research-library/mobile-supply-chain-white-papers/wearable-tech-warehouse-wp), [Aptean](https://www.aptean.com/en-GB/resources/industry-insights/blog/what-is-voice-picking-technology)
