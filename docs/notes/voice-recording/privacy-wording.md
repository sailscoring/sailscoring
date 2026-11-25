# Finishes by voice: what the privacy policy needs to say

Sending a recording to the scorer with the finish sheet puts something new
on the server: the voices of the people on the committee boat, and a
transcript of what they said. Sending is the default, so the scorer can use
the recording to resolve problems with the sheet and answer scoring
inquiries (#776). The policy
lives in the marketing site (`sailscoring/sailscoring.ie`,
`app/legal/privacy/page.tsx`), and has to change before the
`voice-recording` feature is turned on for anyone but ourselves. Nothing
below has been applied there.

What the app does, which the wording has to match (see
[`voice-recording.md`](../../design/voice-recording.md), *Keeping it*):

- Speech is recognised on the phone. No sound is sent anywhere to be
  recognised, and no third party hears it.
- The recording goes to the scorer with the sheet unless the recorder
  turns off **Send the recording with the finish sheet**. It is on to begin
  with, and the calling card says so.
- With the sound go the words the phone recognised in it: a transcript of
  everything said near the phone, talk included, kept for as long as the
  sound.
- A recording that is sent is stored with the workspace's other data
  (Neon). Whoever made it and the workspace's scorers can play it.
- It is deleted when the sheet is withdrawn, when the recorder or a scorer
  deletes it, and otherwise 90 days after the last race in its series (or
  after it was sent, if that is later). Its sound is never
  written to a backup.
- No new sub-processor.

## Proposed wording

Under **What we collect, and why**, a new heading after *Competitors and
race data*:

> ### Recordings of finishes
>
> A workspace may record a race's finishes by voice: a phone on the
> committee boat records as each competitor's sail number is called out, and
> the finishing order is made from the recording. The speech is recognised
> on the phone itself; no sound is sent to us, or to anyone else, for that.
>
> The phone keeps the recording for seven days, and then removes it. Unless
> the person recording turns it off, the recording is sent with the finish
> sheet, with a transcript of what was said, and we store both so the
> workspace's scorers can check a finish, answer a scoring inquiry, and give
> a protest committee a record of what was called. A recording holds the
> voices of whoever was speaking near the phone, and anything else they
> said. Only the person who made it and the workspace's scorers can play it
> or read its transcript, and either can delete it.
>
> The lawful basis is the workspace's legitimate interest in an accurate
> record of a race's finish. The people recording should tell those on the
> boat with them that a recording is being made.

Under **How long we keep it**, a new item:

> - **Recordings of finishes, and their transcripts:** until 90 days after
>   the last race of the series the recording was made in (or after it was
>   sent, if that is later), or sooner if the finish sheet it came with is
>   withdrawn or the recording is deleted. Recordings are not included in
>   database backups.

And the *Last updated* date.

## Open questions for whoever applies it

- **Is a legitimate interest the right basis**, or should the recorder be
  asked to confirm that everyone on the boat knows? Voices of volunteers
  who never opened the app are the unusual part.
- **The server's copy is tied to the end of the series**: 90 days after its
  last race, so it outlasts a scoring inquiry or a request for redress,
  whose time limits the sailing instructions set. Seven days on the phone
  is still a first guess.
- **The default is decided:** sending is on unless switched off, so the
  scorer has the recording when a problem or an inquiry comes up.
