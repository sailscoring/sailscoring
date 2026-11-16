# Finishes by voice: what the privacy policy needs to say

Sending a recording to the scorer with the finish sheet puts something new
on the server: the voices of the people on the committee boat. The policy
lives in the marketing site (`sailscoring/sailscoring.ie`,
`app/legal/privacy/page.tsx`), and has to change before the
`voice-recording` feature is turned on for anyone but ourselves. Nothing
below has been applied there.

What the app does, which the wording has to match (see
[`voice-recording.md`](../../design/voice-recording.md), *Keeping it*):

- Speech is recognised on the phone. No sound is sent anywhere to be
  recognised, and no third party hears it.
- The recording stays on the phone unless the recorder leaves **Send the
  recording to the scorer with the sheet** on. It is on to begin with.
- A recording that is sent is stored with the workspace's other data
  (Neon). Whoever made it and the workspace's scorers can play it.
- It is deleted when the sheet is withdrawn, when the recorder or a scorer
  deletes it, and otherwise 30 days after it was sent. Its sound is never
  written to a backup.
- No new sub-processor.

## Proposed wording

Under **What we collect, and why**, a new heading after *Competitors and
race data*:

> ### Recordings of finishes
>
> A workspace may record a race's finishes by voice: a phone on the
> committee boat listens as each boat's sail number is called and writes
> the finishing order down. The speech is recognised on the phone itself;
> no sound is sent to us, or to anyone else, for that.
>
> The phone keeps the recording for seven days, so the person recording can
> play a call back, and then removes it. If they choose to send it with the
> finish sheet, we store it so the workspace's scorers can listen to a call
> they are unsure of, and so a protest committee has a record of what was
> called. A recording holds the voices of whoever was speaking near the
> phone, and anything else they said. Only the person who made it and the
> workspace's scorers can play it, and either can delete it.
>
> The lawful basis is the workspace's legitimate interest in an accurate
> record of a race's finish. The people recording should tell those on the
> boat with them that a recording is being made.

Under **How long we keep it**, a new item:

> - **Recordings of finishes:** 30 days after a recording is sent, or
>   sooner if the finish sheet it came with is withdrawn or the recording
>   is deleted. Recordings are not included in database backups.

And the *Last updated* date.

## Open questions for whoever applies it

- **Is a legitimate interest the right basis**, or should the recorder be
  asked to confirm that everyone on the boat knows? Voices of volunteers
  who never opened the app are the unusual part.
- **Thirty days and seven days are first guesses.** A protest is usually
  heard the same day, but a request to reopen one can come later.
- **The default.** Sending is on unless switched off. Off unless switched
  on is the more cautious reading of the same policy.
