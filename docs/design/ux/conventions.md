# UI Conventions

How forms and messages in the app should read. Each section records what a
survey of the app found and the rule that follows from it; a section is
added only once it has been surveyed, so the gaps are listed at the end
rather than guessed at.

Conventions written down elsewhere:
[keyboard-navigation.md](../keyboard-navigation.md) for shortcuts and focus,
[user-docs.md](../user-docs.md) for the help pages,
[naming.md](../naming.md) for the product's name,
[glossary.md](../../requirements/glossary.md) for the racing vocabulary, and
CLAUDE.md's *Tone and Humour* for the voice.

## Placeholders

A placeholder is grey text in an empty field, and people read it as a value
already there. A scorer took the race-start dialog's `3.24` for a course
length left over from earlier editing (#711, #713).

A placeholder is one of:

1. **A format hint**: `HH:MM:SS`, `H:MM:SS`.
2. **An example, marked as one**: `e.g. Howth Yacht Club`.
3. **The value used when the field is left blank**, with the label saying
   so: the penalty dialog's `20` under "Percentage (default 20)", the
   publish dialog's default page URL.
4. **A prompt or a description of the empty state**: `Search series…`,
   `Pick a club…`, `Not uploaded`.

Never a bare value that could be real. A field that records what happened
in a race (a gun time, a wind, a course length, a position) takes a format
hint or nothing: those are the fields a scorer checks against what they
remember, and an example there reads as the record. An example belongs in
the error that a bad entry gets (see *Error messages*), where it can't be
mistaken for data.

Of the 123 placeholders surveyed in October 2026, about a dozen broke this
rule; #713 lists and fixes them.

## Labels and units

- **A measurement shows its unit**, in the label (`Course length (NM,
  optional)`, `Distance (NM)`, `Wind (kt)`) or beside the input (`wind
  [ ] °T`, `[ ] to [ ] kt from`). The app does this throughout; keep it.
- **Units are written `NM`, `kt` and `°`**, never `nm`, `kts` or `knots`
  (help prose may say "knots"). A bearing says which north: `°T` or `°M`.
- **Times are local.** A time of day is `HH:MM:SS`, an elapsed time
  `H:MM:SS`. Where an input accepts shorter forms (`14:05`, `1405`), its
  error lists them.
- **Required fields aren't marked.** A missing one is caught on save, with
  "Sail number is required." **"(optional)" marks a field a scorer might
  otherwise think they must fill in**, chiefly the race facts in the
  race-start dialog (`Gun time (optional)`). Forms where most fields are
  optional, such as the competitor form, don't mark each one.
- **A line under the field says what it's used for** when that isn't
  obvious from the label ("Required to score a time-on-distance fleet;
  record it to 0.01 NM.").

## Error messages

All errors in the app are shown inline, beside the field or at the foot of
the dialog; there are no toasts.

**A field error says what to enter**, in the field's own units, with an
example:

> Enter the course length as a positive number of nautical miles, e.g. 3.24.
>
> Enter a valid time, e.g. 14:05, 14:05:00 or 1405 — or leave blank for fleets only.

Older forms say "TCC must be a decimal number between 0.5 and 1.5
(e.g. 0.972)."; that's fine, but write new ones as "Enter …". A missing
required field is "*Field* is required."

**A failure says what didn't happen, what state the user's work is in, and
what to do**:

> The race couldn't be created. Nothing was saved — try again.
>
> That didn’t go through (…). Your list is still here; try again.
>
> Someone else changed this since you opened it. Reload, then try again.

Start with "Couldn’t …" (most of the app says "Could not" or "Couldn’t"),
never "Failed to … Please try again.". A change that didn't save goes
through `describeWriteFailure` (`lib/write-failure.ts`), which words it by
cause: no permission, a read-only series, no connection, a fault on our end.
"Try again" alone tells the scorer to repeat something that may be
pointless. When the server says why, pass its message on rather than
replacing it with a generic one: its errors are written for the scorer.

**Apostrophes are curly** (`’`) in UI text, as in most of the app.

## Not yet surveyed

- **Notices and warnings.** There's no shared notice component, and amber
  and red are used in many shades; what amber means against red (a race
  scored but worth checking, against one where nothing is scored) needs a
  survey before it's a rule.
- **Unavailable features.** When a control is hidden and when it's shown
  disabled with a reason: archived, final and as-published series, a role
  that can't edit, a feature switched off for the workspace.
