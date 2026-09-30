'use client';

// The split-fleet section of the “Running a series” chapter, in its own
// file because every stage word in it comes from the reader's vocabulary
// (see app/help/vocabulary.tsx): sailing instructions use two sets of words
// that borrow each other's for different stages, so “medal race” or
// “qualifying fleet” typed into the prose is wrong for half the scorers
// reading it. `tests/split-fleets-vocabulary.test.ts` scans this file for
// exactly that.

import {
  VOCABULARIES,
  VOCABULARY_OPTIONS,
  capitaliseStage,
  parseVocabularyKey,
  stageAdjective,
  type SeriesStage,
  type Vocabulary,
  type VocabularyKey,
} from '@/lib/split-fleets';

import { HelpShot, Section } from '../ui';
import { useHelpVocabulary, type HelpVocabularySource } from '../vocabulary';

/** The tab of the sample championship, captured once per vocabulary so the
 *  picture beside the prose uses the same words (scripts/feature-shots.ts). */
const SHOTS: Record<VocabularyKey, string> = {
  'opening-medal': '/help/shots/split-fleets.webp',
  'qualification-final': '/help/shots/split-fleets-qualification-final.webp',
};

/** Where the words came from, when it wasn't the reader's own pick. */
const SOURCE_NOTES: Partial<Record<HelpVocabularySource, string>> = {
  series: 'Matching the championship you have open.',
  url: 'Set by the link you followed.',
  stored: 'Remembered from your last visit.',
};

/** The stage words in the forms the prose needs — the same shape the Split
 *  Fleets tab builds for itself. */
function words(vocab: Vocabulary) {
  return {
    /** Stages 1 and 2 together. */
    series: vocab.seriesName,
    qualifying: vocab.stages.qualifying,
    final: vocab.stages.final,
    medal: vocab.stages.medal,
    title: (stage: SeriesStage) => capitaliseStage(vocab.stages[stage].name),
  };
}

function article(noun: string): string {
  return `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`;
}

function VocabularyControl() {
  const { key, source, choose } = useHelpVocabulary();
  const option = VOCABULARY_OPTIONS.find((o) => o.key === key);
  const note = SOURCE_NOTES[source];
  return (
    <div className="rounded-md border bg-muted/50 p-3 space-y-1">
      <label htmlFor="help-vocabulary" className="block text-sm font-medium text-foreground">
        This section uses the words of
      </label>
      <select
        id="help-vocabulary"
        className="w-full max-w-full rounded-md border bg-background px-2 py-1 text-sm text-foreground"
        value={key}
        onChange={(e) => {
          const next = parseVocabularyKey(e.target.value);
          if (next) choose(next);
        }}
      >
        {VOCABULARY_OPTIONS.map((o) => (
          <option key={o.key} value={o.key}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="text-xs">
        {option?.terms}.{note ? ` ${note}` : ''}
      </p>
    </div>
  );
}

/** The one place both vocabularies have to appear: the explanation of why
 *  there is a control at all. Every word of it is read from the tables so
 *  the two never drift apart. */
function VocabulariesCompared() {
  const om = VOCABULARIES['opening-medal'];
  const qf = VOCABULARIES['qualification-final'];
  return (
    <p>
      Two vocabularies are in use for the same three stages, and they borrow each other’s
      words. One has an <em>{om.seriesName}</em> made of {article(om.stages.qualifying.name)} and{' '}
      {article(om.stages.final.name)}, with {om.stages.medal.name} on top. The other —
      the 2026 ILCA wording — has a <em>{qf.seriesName}</em> made of{' '}
      {article(qf.stages.qualifying.name)} and {article(qf.stages.final.name)}, then{' '}
      {article(qf.stages.medal.name)}. So “the {om.stages.final.name}” means the second stage
      in one and the last stage in the other. A championship picks one when it is created,
      and the tab, its dialogs,
      the standings columns and the published pages all follow it — as does this section,
      through the control above.
    </p>
  );
}

export function SplitFleetsSection() {
  const { key, vocab } = useHelpVocabulary();
  const w = words(vocab);
  const q = w.qualifying;
  const f = w.final;
  const m = w.medal;
  const qAdj = stageAdjective(q.name);
  const shotCaption = `The Split Fleets tab of a championship: a card for each stage, the ${qAdj} and ${stageAdjective(f.name)} rounds, and the tiered standings.`;
  return (
    <Section id="split-fleets" title="Split-fleet championships">
      <VocabularyControl />
      <VocabulariesCompared />
      <HelpShot src={SHOTS[key]} alt={shotCaption} caption={shotCaption} />
      <p>
        Big one-design championships split the entry into{' '}
        <strong className="text-foreground">{q.fleetNoun}s</strong> (Yellow, Blue, …) that are
        reassigned by series rank after each day of racing, then into{' '}
        <strong className="text-foreground">{f.fleetNoun}s</strong> (Gold, Silver, …) for the
        closing races — the format behind ILCA and Optimist worlds and nationals. Smaller
        events keep one fleet throughout and send the top boats to a deciding race. A series is a
        split-fleet championship from the start: the setup wizard asks what kind of series you
        are creating before anything else, and which words your sailing instructions use. The{' '}
        <strong className="text-foreground">Split Fleets</strong> tab then leads the series and
        everything about the event runs from it. A series that has already raced cannot become
        one; create a new series and import the entry list again.
      </p>
      <p>
        The tab has a card for each stage, and a new championship starts as the simplest one
        there is: one fleet sails the {w.series} and the top ten sail the {m.name} at double
        points. Each card’s <strong className="text-foreground">Settings</strong> hold only that
        stage’s choices, with the rules it follows written out beneath them — the {w.series}
        card holds the discards, the {w.title('medal')} card the size of the {m.fleetNoun}, its
        points, the score carried in and how ties are broken. Where the entry is big enough to
        divide, <strong className="text-foreground">Divide into …</strong> on the {w.series}{' '}
        card gives it its two parts, the {q.name} and the {f.name}, each with a card and fleets
        of its own; it can be undone until the split is committed. Each change is settled by
        what has been sailed: the words once a race exists, a stage’s fleet count once its fleets
        are dealt, and the division once the split is committed. A stage’s settings sit at the
        top of its card and open by themselves when the event reaches that stage — the{' '}
        {w.title('medal')} card’s once the fleet it is selected from is racing, since its size
        sets both the provisional cut line and the selection.{' '}
        <strong className="text-foreground">Sailing instructions</strong> opens the whole
        configuration, restated as sailing instructions, in a drawer beside the cards: read it
        against the scoring section of your own, and as you reach a setting the sentences it
        writes are marked. Where a sentence disagrees, change the setting. A championship that
        nobody is cut from ends with the stage before the {m.name}: answer{' '}
        <strong className="text-foreground">No</strong> when the setup wizard asks whether the
        top boats go on to it, or choose{' '}
        <strong className="text-foreground">No {m.name}</strong> on its card.{' '}
        <strong className="text-foreground">Add {m.name}</strong> puts it back, and it can be
        removed until its fleet is selected.
      </p>
      <p>
        <strong className="text-foreground">Round 1</strong> makes the initial assignment —
        normally from the seeding committee’s ranking, or by sail number — with an editable
        preview, so a hand-move is a click, not a spreadsheet edit. Each following morning,{' '}
        <strong className="text-foreground">Assign Round N</strong> reassigns from the ranking
        over the races every fleet has completed, in the standard rank pattern (down the fleet
        list and back). The assignment is frozen when you commit it: a protest decided that
        evening re-scores the standings but never re-deals fleets already racing. An
        assignment deals fleets and nothing else — each race is added from the round with{' '}
        <strong className="text-foreground">Add race</strong> as it is sailed. The ceremony
        offers to create the day’s races up front as well, off unless you ask for it: a race
        that exists before it is sailed stands in the standings as a DNC against every boat.
      </p>
      <p>
        Often the committee hands over the assignment already made rather than an order to deal
        from — each boat down as Yellow, Blue or Red on the entry list. Import that list with
        the fleet column on it and Round 1 offers{' '}
        <strong className="text-foreground">the entry list’s initial fleet</strong> as the
        source, taking the fleets exactly as given. On a split-fleet championship the importer
        creates no fleets of its own — the rounds own them — so a fleet column there is read as
        the assignment, and a seeding column of ranks still lands on{' '}
        <strong className="text-foreground">Seeding rank</strong> as before; whichever kind of
        column it is, the import tells them apart by what is in the cells. Anyone the list
        places nowhere, or places in a fleet the championship doesn’t have, is listed with no
        fleet and named in the dialog — the round won’t commit until you have put them
        somewhere. Where the fleets were drawn and nothing came with the entry list, choose{' '}
        <strong className="text-foreground">By hand</strong>: every boat starts in no fleet
        and you pick each one’s, with nothing dealt for you and nothing marked as moved. And where the series carries fleets from before it became a championship —
        the “Default” an earlier import left behind, say — each assignment offers to remove
        them, memberships and all, since the rounds own a championship’s fleets and those would
        only sit unused. A fleet any race has actually used is never offered.
      </p>
      <p>
        {capitaliseStage(article(q.raceNoun))}{' '}
        <strong className="text-foreground">counts only once every fleet has completed it</strong>{' '}
        — until then its column is greyed in the standings, matching the abandon-and-cancel
        rule in championship sailing instructions. The fleets start in sequence and finish onto{' '}
        <strong className="text-foreground">one combined sheet</strong>: enter it exactly as it
        comes off the water, interleaved, and each boat scores her place within her own fleet.
        Where each fleet’s finishes come back separately instead — as electronic timing records
        them — choose <strong className="text-foreground">A sheet per fleet</strong> beside{' '}
        <strong className="text-foreground">Add race</strong>, and the race is laid out as one
        race per fleet. The choice starts from whatever the races before used, and one stage can
        hold both. It changes the layout, not the scoring. If one fleet’s race is abandoned,
        abandon just that fleet’s start from the race
        row — the rest of the sheet stands — and add its{' '}
        <strong className="text-foreground">catch-up race</strong> (its own sheet, usually
        sailed first the next day) from the same row.
      </p>
      <p>
        <strong className="text-foreground">End the {q.name} → split fleets</strong> deals the{' '}
        {f.fleetNoun}s from the {qAdj} ranking — adjust the top-fleet size if the SIs fix one,
        and the dialog flags rank ties sitting on a boundary. {capitaliseStage(f.fleetNoun)}s
        race independently (they need not sail the same number of races). The {f.name} card’s{' '}
        <strong className="text-foreground">Score carried in</strong> says what each boat takes
        into it, and the {w.title('medal')} card has the same choice: her{' '}
        <strong className="text-foreground">net score</strong>, the stages scoring as one
        continuous series; her net score <strong className="text-foreground">halved</strong>,
        0.5 rounded up, as the 2026 ILCA Worlds did before their last two races;{' '}
        <strong className="text-foreground">nothing</strong>, the stage scored on its own races
        alone; or her <strong className="text-foreground">rank</strong> at the cut. Anything but
        the net score replaces her earlier races with the one carried score, once her fleet has
        sailed a race of the stage, and from then on none of the stage’s races is excluded. The{' '}
        {f.name} card also says how a tie within a fleet is broken: by rule A8, or on the last
        race alone. Where the sailing instructions instead score particular races double, or say
        they may not be excluded, set that on each race through its{' '}
        <strong className="text-foreground">Scoring</strong> options, as in any series: a race that
        must count is also left out of the count the discard ladder is read from, since the
        ladder can never reach it. If the event carries{' '}
        {article(m.raceNoun)}, select the {m.fleetNoun} when racing closes (
        <strong className="text-foreground">Select {m.fleetNoun}…</strong>): the top boats sail
        it, never discardable, at whatever points multiplier the sailing instructions set —
        that is the {w.title('medal')} card’s setting, and a {m.raceNoun}’s own scoring options
        do not multiply it again.
        Selecting them moves nobody else: everyone outside the {m.fleetNoun} stays where they
        are and sails one more race with their own fleet, which you add from{' '}
        <strong className="text-foreground">Add companion race</strong> on the {f.name} card. The boats who
        qualified have left that fleet’s racing, so they are simply absent from that race rather
        than scored for missing it. It scores from just below the boats who went up, in the
        fleet they left — the ILCA wording in both eras — so that where ten boats went to the{' '}
        {m.raceNoun} its first finisher scores eleven. Only that
        fleet is offset. The others are a boat short of nobody and score from 1. A redress
        decision that promotes a boat across the split is the{' '}
        <strong className="text-foreground">Promote (redress)</strong> action on the split
        round.
      </p>
      <p>
        Some events never divide the fleet at all: one fleet sails the whole {q.name} and the
        only division ever made is into the {m.fleetNoun}. That is how a championship starts,
        and with one fleet there is nothing to deal: the first{' '}
        <strong className="text-foreground">Add race</strong> creates the round along with the
        race. The standings
        draw the {m.fleetNoun} cut where it would fall if racing ended now, and{' '}
        <strong className="text-foreground">Select {m.fleetNoun}…</strong> is offered from the{' '}
        {w.title('medal')} section rather than from a stage the event does not sail. The boats
        who miss the cut have no score for the {m.raceNoun} at all; where the sailing
        instructions give them one more race, the {w.series} card’s next race is{' '}
        <strong className="text-foreground">Add companion race</strong>, scored from just below
        the boats who went up. Nothing is
        needed to hold them below the qualified boats — those rank highest in the event
        whatever the points say — so the two groups are scored over different numbers of
        races, and the standings and the published page show them as two tables rather than
        one ladder.
      </p>
      <p>
        An event that is never divided can still draw its boats into two or more fleets, once,
        for the whole {q.name} — the Irish Sailing Champions’ Cups sail two flights of six. Set{' '}
        <strong className="text-foreground">Fleets ranked</strong> on the {w.series} card to
        say how they are ranked. <strong className="text-foreground">All together</strong> is
        one list across the fleets, a race counting once every fleet has sailed it.{' '}
        <strong className="text-foreground">Each on its own</strong> is for fleets that are
        separate selection pools (“helms ranked 1st and 2nd from each flight”): each
        boat is ranked within her fleet, a race counts for a fleet as soon as that fleet has
        sailed it, and a boat that does not finish scores her own fleet plus one. The{' '}
        {w.title('medal')} card then asks how many competitors go through from each fleet in
        place of a fleet size, and the standings show one table per fleet with its own cut line.
        Selecting the {m.fleetNoun} takes the top of each fleet; the scorer then promotes as many
        more as the sailing instructions say (see the repêchage, below).
      </p>
      <p>
        A boat that doesn’t finish is scored by the stage she is in: the largest fleet plus one
        in the first stage, her own fleet plus one after it — RRS A5.2 as championship
        sailing instructions adapt it. Where they say instead that{' '}
        <strong className="text-foreground">Rule A5.3 applies</strong>, set{' '}
        <strong className="text-foreground">Non-finishers</strong> on the {w.series} card: a
        boat that came to the starting area then scores the boats that came to it in that race,
        plus one, and a boat that didn’t come scores the number of entries, plus one. The count
        is the start check-in where the sheet records it, and otherwise every boat on the sheet
        but a DNC. It is the series’ own A5.2/A5.3 setting, which an ordinary series makes on
        its settings page.
      </p>
      <p>
        Race labels follow the words the championship uses: Q, F and M under the first set,
        and QP, QE and F under the ILCA wording, with each stage numbering its races from 1.
        A championship that is never divided numbers its first races Q1, Q2 and so on under
        either. The standings columns, the race rows, the races list and the published pages
        all use them. It is worth checking against your notice board: the race label is what a
        competitor writes on a scoring enquiry.
      </p>
      <p>
        <strong className="text-foreground">Compressing the score</strong> before the {m.name}{' '}
        is also supported: ILCA from 2026 halves each qualified boat’s series score before the{' '}
        {m.name}, rounding 0.5 up, which pulls the leaders together so the last races can still
        decide the title. Choose it in the {w.title('medal')} card’s settings; the halved number
        appears in a <strong className="text-foreground">Carried</strong> column and replaces
        the boat’s earlier race scores in her total once a {m.raceNoun} is completed. Rounding
        to whole numbers makes ties, so choose how ties between the qualified boats are broken:
        on the {m.raceNoun} first and then by rule A8, or on the last race alone in place of
        rule A8. Which one your event uses is a sentence in its sailing instructions, and the
        wrong one decides the title differently.
      </p>
      <p>
        The published output is a{' '}
        <strong className="text-foreground">championship standings</strong> page — combined
        with a provisional cut line during the {q.name}, tiered Gold/Silver tables after the
        split — plus a <strong className="text-foreground">race results</strong> page with
        every race as its own tables, one per fleet, ranked the way the racing actually happened
        (the standings page’s race column headings link straight into it), and a rolling{' '}
        <strong className="text-foreground">fleet assignments</strong> page, newest round first,
        so competitors always know which start they’re in, and a{' '}
        <strong className="text-foreground">Scoring notes</strong> page. Preview and publish sit
        in the series header as for any series, and{' '}
        <strong className="text-foreground">Mark as final</strong> lives on the Split Fleets
        tab (the regular Standings tab is hidden for these series).
      </p>
      <p>
        The Scoring notes page carries the same SI prose you checked your settings against,
        under <strong className="text-foreground">How this championship is scored</strong>,
        with the links to open the series in Sail Scoring and to its data file — so a
        competitor can see how the event is scored without being handed the sailing
        instructions again, and the standings page, which links to it beside the results
        stamp, stays to the tables. The prose follows the settings, so it is right by
        construction: there is nothing to keep in step by hand. A preview or a download,
        which has no notes page beside it, keeps the prose folded away at the foot of the
        standings instead.
      </p>
      <p>
        A race cell is marked with its fleet only where the page cannot otherwise say which
        fleet the race was sailed in: a column holding boats of several fleets with no Fleet
        column to name them — the {q.raceNoun}s on a Gold fleet table after the split, say.
        The marker spells the fleet’s initials on its colour, so it reads without the colour.
        Where boats are drawn for each fleet, the standings show no entry numbers: the boat
        a helm sailed is the number she is known by, and it is on the race results page.
      </p>
    </Section>
  );
}

/** Boats drawn for each fleet: the supplied-boat championship. */
export function SplitFleetBoatsSection() {
  const { vocab } = useHelpVocabulary();
  const w = words(vocab);
  const caption =
    'A fleet’s boats, opened from its chip on the round: the boat each entry sails in that fleet.';
  return (
    <Section id="split-fleet-boats" title="Boats drawn for each fleet">
      <p>
        Some championships supply the boats. The Irish Sailing Champions’ Cups share a handful of
        boats between two fleets — one fleet races, then the other takes the same boats out — and
        draw the boats again every time the entries are reassigned. A helm’s sail number then
        changes with her fleet, and two helms carry the same number in different fleets. For
        these, set <strong className="text-foreground">Boats</strong> in the {w.series} card’s
        settings to <strong className="text-foreground">Boats are supplied and drawn for each fleet</strong>.
      </p>
      <p>
        Every assignment then has a <strong className="text-foreground">Boat</strong> column
        beside the fleet each entry is dealt. Type the draw straight down it (Enter moves to the
        next row), or paste a column of numbers into the first box and it fills the rows below.
        A boat can appear once in each fleet; the same boat in two fleets of a round is the shared
        boat, and that is expected. The draw often comes after the fleets are decided — the
        Champions’ Cup redraws its boats at dinner, after the finalists are known — so the boats
        can be left blank and the round says how many are not yet drawn.
      </p>
      <HelpShot src="/help/shots/split-fleet-boats.webp" alt={caption} caption={caption} />
      <p>
        To enter or change boats later, click a fleet’s chip on its round. That is also how a
        spare goes in for a broken boat: change the number for the helm who holds the boat in
        each fleet. Each entry keeps her own number too — shown as{' '}
        <strong className="text-foreground">Entry</strong> — and it is what the standings list
        her under.
      </p>
      <p>
        On a race, the numbers are the boats: type the number the race committee hails and it
        finds the helm sailing that boat in that race, and a RaceSense sheet matches the same
        way, since each unit is fixed to a boat. Fleets that share boats always get a race each,
        never one sheet between them. The published race results show the boat each helm
        sailed, and the fleet assignments page lists each fleet’s boats, which is where
        competitors look up the boat to go to.
      </p>
    </Section>
  );
}

/** The repêchage: a second chance for the boats who missed the medal cut. */
export function SplitFleetRepechageSection() {
  const { vocab } = useHelpVocabulary();
  const w = words(vocab);
  const caption =
    'Adding a repêchage: the boats who missed the cut, in the order of the ranking they were cut from, picked by hand.';
  return (
    <Section id="split-fleet-repechage" title="A repêchage for the last seats">
      <p>
        Some championships give the boats who missed the cut a second chance: a short series of
        their own, whose leaders take the last seats in the {w.medal.fleetNoun}. The Irish
        Sailing Champions’ Cups sail one after their two flights, for the last seats in the
        deciding races; another event might sail one after Gold and Silver. The sailing instructions that call for
        one rarely agree on who may sail it, in how many flights, or how many seats it fills, so
        all of that is yours to decide as the committee directs.
      </p>
      <p>
        Select the {w.medal.fleetNoun} first, with the boats that go through directly. The card
        they were cut from then has a <strong className="text-foreground">Repêchage</strong>{' '}
        section, saying how many seats are still open. <strong className="text-foreground">Add a
        repêchage</strong> lists the boats outside the {w.medal.fleetNoun} in the order of the
        ranking they were cut from; tick the ones the sailing instructions name, and choose one
        fleet or several — two flights of four is one repêchage in two fleets, each ranked on its
        own.
      </p>
      <HelpShot src="/help/shots/split-fleet-repechage.webp" alt={caption} caption={caption} />
      <p>
        Its races are numbered R1, R2 and so on, and entered like any other. It is ranked on those
        races alone: every boat starts on zero, nothing is excluded, and a boat that does not
        finish scores the boats in her repêchage fleet plus one. Nothing it scores counts in the
        championship.
      </p>
      <p>
        <strong className="text-foreground">Promote from the repêchage</strong> ticks its leaders
        up to the seats open; promote whom the sailing instructions say. A promoted boat takes
        into the {w.medal.name} exactly what the boats selected directly take — nothing, where
        nothing is carried, or her own score where one is — and nothing from the repêchage goes
        with her. Where there is no time to sail it, promote from the ranking the boats were cut
        from instead: that is the usual fallback (“invite the 3rd-placed sailors from each
        flight”), and it needs no repêchage at all. Where each fleet is ranked on its own, the{' '}
        {w.medal.fleetNoun} has no fixed size, so nothing is ticked for you: promote as many as the
        sailing instructions say. The boats are listed fleet by fleet with their rank in it. A
        promotion can be withdrawn.
      </p>
      <p>
        Where the {w.medal.name} carry a score in, only boats of the fleet the{' '}
        {w.medal.fleetNoun} is selected from can sail the repêchage or be promoted: a Silver score
        carried into races against Gold’s would set two fleets’ points against each other. Where
        nothing is carried, any boat outside the {w.medal.fleetNoun} can.
      </p>
      <p>
        The standings list every score once: the {w.medal.fleetNoun}, then the repêchage — every
        boat that sailed it, promoted or not — then the ranking the boats were cut from. Where
        nothing is carried into the {w.medal.name}, that last table lists every boat, the{' '}
        {w.medal.fleetNoun} included, on its own. The published pages follow the same order, and
        the race results page lists the repêchage races with the rest.
      </p>
    </Section>
  );
}
