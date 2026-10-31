# Scoring Codes Flow

How a scorer changes the way a series scores its codes. By default a series
scores the RRS Appendix A codes, as now. When the sailing instructions say
otherwise, the scorer can change a built-in code or add one of the series'
own. That is the escape hatch, and the design treats it as one.

Context: Phase 4 of [`scoring-codes.md`](../../scoring-codes.md), which
records the scope decided in October 2026: one table per series, built-in
codes changeable, the series' own codes chosen from a fixed list of rules,
averages and points set by hand left to RDG, and a self-service gate
(`custom-scoring-codes`). This flow may change the engine design there. What
it asks of the engine is collected under *What this asks of the engine*.

---

## Design priorities, in order

1. **The RRS is the default, and it stays in view.** A series that never
   needs this sees one extra line on the Scoring card and nothing else.
   After a change, the scorer can always see the RRS rule a code replaced.
2. **Opening it is a deliberate act.** It takes one action and a screen
   saying what it is for. It isn't a toggle sitting in a form.
3. **The detail stays in its own dialog.** The Scoring card keeps its
   discards and its A5.2/A5.3 choice. Code tables are not added to the
   settings page.
4. **The prose is the check.** Every rule is restated as a sentence, which is
   what the scorer compares with their sailing instructions. The split-fleet
   setup works the same way.
5. **A change from the RRS can be seen everywhere it matters**: on the
   Scoring card, in the finish-sheet menus, and on every published page.
6. **Race day doesn't change.** Series codes join the finish-sheet menus
   that already exist. A scorer has nothing new to learn at the finish line.

---

## Where it starts

The Scoring card, expanded, ends with one line under the A5 radios:

```
│  ○ Starting area, including DNC (RRS A5.3 as changed by DBSC)        │
│  ☐ Rank only boats that took part                                    │
│                                                                      │
│  Scoring codes: as RRS Appendix A                                    │
│  Do your sailing instructions add a code, or score one differently?  │
│  Change scoring codes…                                               │
│                                                                      │
│  [ Done ]                                                            │
```

Collapsed, the card's summary says nothing about codes while they are
standard. Once a code has changed, the summary names the change:

```
│ Scoring                                                       Edit ▸  │
│ 1 discard per 4 races · DNF: starting area · Codes: TLE added,        │
│ SCP changed                                                           │
```

and the expanded line becomes **Scoring codes: 1 added, 1 changed from the
RRS — Edit scoring codes…**.

With the gate off, the line is absent. A series that already has changed
codes (one imported, or one made in another workspace) says so
instead, in the way the card already handles proportional discards: *"This
series scores 2 codes differently from the RRS (TLE, SCP). Turn on **Custom
scoring codes** in Workspace settings to edit them."* The codes still
score, publish and appear in the finish-sheet menus.

---

## Opening the dialog

The first time, the dialog opens on a screen that says what this is for:

```
┌─ Scoring codes ──────────────────────────────────────────────────────┐
│                                                                      │
│  This series scores every code as RRS Appendix A sets out, with      │
│  DNF and the codes scored like it based on the boats that came to    │
│  the starting area (A5.3).                                           │
│                                                                      │
│  Change this only when your notice of race or sailing instructions   │
│  do: a code the RRS doesn’t have, such as TLE, or a standard code    │
│  scored differently. Every published results page will list what     │
│  you change, so readers can check it against the instructions.      │
│                                                                      │
│                                   [ Cancel ]  [ Change scoring codes ]│
└──────────────────────────────────────────────────────────────────────┘
```

**Change scoring codes** shows the table. Nothing is saved yet: the series
counts as changed only once a code is added or changed. A scorer who looks
around and closes the dialog has changed nothing, and next time sees this
screen again. Once the series has a change, the dialog opens straight on
the table.

---

## The table

```
┌─ Scoring codes ──────────────────────────────────────────────────────────┐
│                                                                          │
│  REPLACE THE BOAT’S RESULT                                               │
│  DNF   Did not finish            came to the start + 1           RRS     │
│  DNS   Did not start             as DNF                          RRS     │
│  OCS   On course side            as DNF                          RRS     │
│  NSC   Did not sail the course   as DNF                          RRS     │
│  RET   Retired                   as DNF                          RRS     │
│  DSQ   Disqualified              as DNF                          RRS     │
│  DNE   Not excludable DSQ        as DNF · not discardable        RRS     │
│  UFD   U flag disqualification   as DNF                          RRS     │
│  BFD   Black flag disq.          as DNF                          RRS     │
│  DNC   Did not come to the start series entries + 1              RRS     │
│  TLE   Time limit expired        finishers + 1, at most DNF      Series  │
│                                                                          │
│  ADD TO THE BOAT’S FINISHING PLACE                                       │
│  ZFP   Z flag penalty            20% of DNF                      RRS     │
│  SCP   Scoring penalty           2 points                        Changed │
│                                  RRS: 20% of DNF, or as decided          │
│  DPI   Discretionary penalty     points decided per boat         RRS     │
│                                                                          │
│  REDRESS                                                                 │
│  RDG   Redress given             decided per boat                RRS     │
│                                                                          │
│  [ Add a code ]                                                          │
│                                                                          │
│  Reset all to the RRS                                         [ Done ]   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **The groups are the two kinds of code** the engine knows, plus redress.
  The kind is the first thing a scorer has to understand about a new code,
  so it organises the list.
- **"as DNF"** is how the RRS itself is written. A5.2 and A5.3 score DNS,
  OCS, NSC, RET, DSQ, DNE, UFD and BFD all the same way as DNF, so the table
  says so. Changing DNF moves the whole group, which is what an SI that
  says "DNF, DNS, OCS … shall be scored …" means. Breaking one code out of
  the group is a change to that code.
- **DNF's rule follows the A5 choice on the Scoring card.** Switching the
  radio there changes the DNF row here, and the row stays marked RRS. An
  edit here is a change from whichever A5 rule is chosen.
- **A changed row shows the RRS rule beneath it**, so the departure can be
  read without opening the row.
- **RDG and DPI rows open read-only.** Their points are decided for each
  boat, in the redress and penalty dialogs. Only DPI's "can be discarded"
  is editable.
- Every row opens the code's editor, including the RRS rows. **Reset all to
  the RRS** lists what it will undo and asks first. It is refused while any
  result uses one of the series' own codes (see *Codes in use*).

---

## Editing a code

The editor replaces the table inside the same dialog, with **← All codes**
to return. A series code:

```
┌─ Scoring codes ─────────────────────────────────── ← All codes ──┐
│                                                                  │
│  Code          [ TLE    ]                                        │
│  Description   [ Time limit expired: finished outside the      ] │
│                [ 10-minute window (SI 16.1)                    ] │
│                Printed under the results. Name the clause of     │
│                your instructions that defines the code.          │
│                                                                  │
│  The code      ● Replaces the boat’s result                      │
│                ○ Adds points to her finishing place              │
│                                                                  │
│  Points        ● One place after   [ the finishers      ▾] + [1] │
│                ○ The same as       [ DNF ▾]                      │
│                ○ A fixed           [   ] points                  │
│                ☑ No more than DNF scores                         │
│                                                                  │
│                ☑ Can be discarded                                │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │ A boat scored TLE gets points for the place after the last │  │
│  │ boat to finish in her fleet, but never more than a DNF. It │  │
│  │ can be discarded. Other boats keep their places.           │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Delete code                                [ Cancel ] [ Save ]  │
└──────────────────────────────────────────────────────────────────┘
```

- **The base list** for *One place after* is: *the series entries*, *the
  boats that came to the starting area*, *the finishers*. The `+ N` is a
  whole number, 1 or more.
- **"Adds points"** swaps the Points block for: ● *A stated number of
  points* `[ ]`, ○ *A percentage of DNF* `[ ]%`, always capped at DNF's
  points, as 44.3(c) caps ZFP and SCP.
- **The sentence in the box** is generated from the choices and updates as
  they change. It is the check, and the same sentence is printed on
  published pages.
- **A built-in code's editor** has the same Points block. Its code, name and
  kind are fixed, and it shows the RRS rule above the controls:
  *"RRS A5.3, chosen on the Scoring card: one place after the boats that
  came to the starting area + 1."* **Reset to the RRS** takes the place of
  Delete. For ZFP and SCP the editable figure is the percentage, or a
  switch to a stated number of points.

**Messages** (per [conventions](../conventions.md)):

- Code empty: "Code is required."
- Bad code: "Enter a code of up to 6 letters or digits, e.g. TLE."
- Clash with a built-in: "DNF is an RRS code. To change how it scores, open
  it from the list."
- Clash in the series: "This series already has a code TLE."
- A loop: "TLE can’t score the same as XPA, which scores the same as TLE."
- Fixed points not a number: "Enter the points as a number, e.g. 5."

---

## Codes in use

Results that already use a code are rescored when it changes, as in
Sailwave. The editor shows that cost before **Save**:

```
│  Used by 4 results in R2, R5 and R6. Saving rescores them.        │
```

The change is recorded in the activity log, and the revision history can
restore the series as it was before.

**Deleting** a series code that results use is refused, with a way out:

```
│  TLE is used by 4 results in R2, R5 and R6.                       │
│  Replace it with [ DNF ▾]  [ Replace and delete ]                 │
```

ADR-013 requires this. A result can't be left holding a code whose meaning
is gone. **Reset to the RRS** on a changed built-in is always allowed,
because the code still exists.

---

## On the finish sheet

Series codes go into the menus where their kind fits, after the RRS codes,
under a *This series* divider:

- **Codes that replace the result** go in the finishing-order code menu,
  for a boat that crossed the line (TLE belongs there), and in the *Not yet
  recorded* panel's `[···]` picker.
- **Codes that add points** go in the penalty dialog's *Penalty* select,
  after ZFP, SCP and DPI. They need no figure, because the code carries its
  points.
- The quick-assign buttons (DNS, DNF, OCS …) are unchanged.
- **A changed built-in** sits in its usual place, with a small marker. Its
  tooltip gives the series' rule.
- **A typed or imported code** (keyboard entry, finish-sheet CSV) is
  checked against the series' table. An unknown one gets: "TLE isn’t a code
  in this series. Add it under Settings → Scoring → Scoring codes."

Today, HYC's sign-out penalty is a DPI of 2 points labelled "Sign-out",
typed for each boat. A series code, *SOP: adds 2 points*, makes it one
choice from a menu with nothing to type. The DPI label stays for one-off
penalties.

---

## On published pages

Each published results page that uses a code scored differently from the
RRS lists it under the results:

```
  Scoring codes that differ from the RRS
  TLE  Time limit expired: finished outside the 10-minute window (SI 16.1).
       Points for the place after the last boat to finish in her fleet,
       never more than a DNF.
  SCP  Scoring penalty: 2 points added (RRS: 20% of the DNF score).
```

Only codes used on that page are listed, and only codes that differ from
the RRS. A standard series' pages are unchanged. The published results API
carries the same list as data.

---

## Importing from Sailwave

With the gate on, the Sailwave import wizard turns #238's warnings into a
summary of what it will carry over:

```
  This file scores 3 codes differently from the RRS. They’ll be the
  series’ scoring codes:
    DNF   one place after the finishers + 1   (RRS: series entries + 1)
    DNC   one place after the finishers + 2   (RRS: series entries + 1)
    DPI1  adds 1 point                        (not an RRS code)
```

Anything the table can't hold still warns, as now: averages over listed
races, points set by hand on a code other than RDG, and per-fleet code
tables. With the gate off, the import warns just as it does today.

---

## Use cases

**HYC Dinghy Frostbites 2026/27**, if HYC keeps TLE. The scorer adds TLE as
one place after the finishers + 1, at most DNF, and SOP as adds 2 points
(SI 19.1). The sentence shows that TLE is worked out from **places**, the
2025 Appendix LG wording. The 2021 wording in the SI counts the last
finisher's *points*, and the two differ when that boat is carrying the
sign-out penalty. Reading the sentence is where the scorer would notice.

**2026 ILCA Leinsters (Skerries)**, the `.blw` behind #238. DNF is changed
to finishers + 1 and DNC to finishers + 2. The rest of the group follows
DNF. The import fills this in.

**DBSC.** Its "starting area, including DNC" option is DNC changed to
"the same as DNF". Whether that option stays on the Scoring card is an
open question below.

---

## What this asks of the engine

- **Built-ins defined the RRS way.** DNS through BFD are "the same as DNF",
  and the A5 choice sets DNF's base. Scoring doesn't change; how the
  registry describes it does.
- **The kind is fixed per code and decides A6.2.** A code that replaces
  the result moves other boats up. One that adds leaves their scores alone.
  There is no separate A6.2 control.
- **No control for "came to the starting area".** Every code except DNC
  counts the boat as having come, and a code that is "the same as DNC"
  inherits DNC's answer. Sailwave's started and finished flags are left
  out unless a real SI needs them.
- **"Finishers" means the boats that finished in her fleet**, counted as
  places, so ties and a penalised last boat don't move the base. Whether
  a UFD or BFD boat that crossed counts is open.
- **A cap at DNF's points**, for any code that replaces the result.

---

## Open questions

1. **The A5 radios.** Keep them on the Scoring card as the quick, common
   choice, with the table following them (as drawn), or move them into the
   DNF row? Keeping them means DBSC's third option either stays as it is or
   turns into a changed DNC.
2. **Rescoring preview.** Is it worth showing the points that will change
   ("R5 Murphy 13 → 21") before saving a code in use, or is the count
   enough?
3. **Code spelling.** Sailwave allows mixed case (`RDGa`). Should codes be
   uppercase only?
4. **Where the list publishes** for split-fleet championships, which
   already have a Scoring notes page: on every page, there, or both?
5. **Finish-sheet submissions** through the public API (ADR-016) accept the
   RRS codes. Should they accept series codes too?
