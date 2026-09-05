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
      {article(om.stages.final.name)}, with {om.stages.medal.name} on top, and numbers its
      races {om.prefixes.qualifying}, {om.prefixes.final} and {om.prefixes.medal}. The other —
      the 2026 ILCA wording — has a <em>{qf.seriesName}</em> made of{' '}
      {article(qf.stages.qualifying.name)} and {article(qf.stages.final.name)}, then{' '}
      {article(qf.stages.medal.name)}, and runs {qf.prefixes.qualifying}1–{qf.prefixes.final}12
      straight through the first two before restarting at {qf.prefixes.medal}. So “the{' '}
      {om.stages.final.name}” means the second stage in one and the last stage in the other,
      and a race the notice board calls {qf.prefixes.final}6 is {om.prefixes.final}1 in the
      other scheme. A championship picks one in its{' '}
      <strong className="text-foreground">Format</strong> settings, and the tab, its dialogs,
      the standings columns and the published pages all follow it — as does this section,
      through the control above. Race prefixes and numbering come with the choice rather than
      being set separately.
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
  const shotCaption = `The Split Fleets tab of a championship: format, the ${qAdj} and ${stageAdjective(f.name)} rounds, and the tiered standings.`;
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
        closing races — the format behind ILCA and Optimist worlds and nationals. A series is a
        split-fleet championship from the start: the setup wizard asks what kind of series you
        are creating before anything else, and the{' '}
        <strong className="text-foreground">Split Fleets</strong> tab then leads the series and
        everything about the event runs from it. A series that has already raced cannot become
        one; create a new series and import the entry list again.
      </p>
      <p>
        <strong className="text-foreground">Round 1</strong> makes the initial assignment —
        normally from the seeding committee’s ranking, or by sail number — with an editable
        preview, so a hand-move is a click, not a spreadsheet edit. Each following morning,{' '}
        <strong className="text-foreground">Assign Round N</strong> reassigns from the ranking
        over the races every fleet has completed, in the standard rank pattern (down the fleet
        list and back). The assignment is frozen when you commit it: a protest decided that
        evening re-scores the standings but never re-deals fleets already racing.
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
        somewhere. And where the series carries fleets from before it became a championship —
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
        them — set <strong className="text-foreground">Finish sheets</strong> to one per fleet
        in the championship settings, and every stage race is laid out as a race per fleet,
        whether the ceremony creates it or you add it later. It changes the layout, not the
        scoring. If one fleet’s race is abandoned, abandon just that fleet’s start from the race
        row — the rest of the sheet stands — and add its{' '}
        <strong className="text-foreground">catch-up race</strong> (its own sheet, usually
        sailed first the next day) from the same row.
      </p>
      <p>
        <strong className="text-foreground">End the {q.name} → split fleets</strong> deals the{' '}
        {f.fleetNoun}s from the {qAdj} ranking — adjust the top-fleet size if the SIs fix one,
        and the dialog flags rank ties sitting on a boundary. {capitaliseStage(f.fleetNoun)}s
        race independently (they need not sail the same number of races). If the event carries{' '}
        {article(m.raceNoun)}, select the {m.fleetNoun} when racing closes (
        <strong className="text-foreground">Select {m.fleetNoun}…</strong>): the top boats sail
        it, never discardable, at whatever points multiplier the sailing instructions set.
        Selecting them moves nobody else: everyone outside the {m.fleetNoun} stays where they
        are and sails one more race with their own fleet, which you add from{' '}
        <strong className="text-foreground">Add next race</strong> as usual. The boats who
        qualified have left that fleet’s racing, so they are simply absent from that race rather
        than scored for missing it. What differs by class is how it scores, and the{' '}
        {w.title('medal')} settings ask which: from 1 like any other race, or — the ILCA wording
        in both eras — from just below the boats who went up, in the fleet they left, so that
        where ten boats went to the {m.raceNoun} its first finisher scores eleven. Only that
        fleet is offset. The others are a boat short of nobody and score from 1. A redress
        decision that promotes a boat across the split is the{' '}
        <strong className="text-foreground">Promote (redress)</strong> action on the split
        round.
      </p>
      <p>
        Choosing a split-fleet championship in the setup wizard writes an initial format and
        shortens setup to the entry list — the fleets are created by the assignment ceremonies
        and the scoring rules live in the tab’s{' '}
        <strong className="text-foreground">Format</strong> section, which is open until the
        first round is assigned and holds the whole configuration from then on. Start from a
        class format —
        ILCA, IODA, and the two-series and carried-position models, with ILCA offered per era
        since the class rewrote its format for 2026 — which fills every setting; then read{' '}
        <strong className="text-foreground">How this configuration translates to sailing
        instructions</strong>, which restates your settings as SI prose, against the scoring
        section of the sailing instructions you were given. Where a sentence disagrees, change
        the setting.
      </p>
      <p>
        Three ways of carrying {qAdj} results into the {f.name} are supported:{' '}
        <strong className="text-foreground">one continuous series</strong> (ILCA, Optimist —
        every race totals together), <strong className="text-foreground">two series added
        together</strong> (each with its own discards), and{' '}
        <strong className="text-foreground">the {q.name} position carried forward</strong> as
        one score that can never be discarded, replacing the {q.raceNoun} scores (470, Topper).
        The standings show a carried position in a{' '}
        <strong className="text-foreground">QS</strong> column.
      </p>
      <p>
        <strong className="text-foreground">Compressing the score</strong> before the {m.name}{' '}
        is also supported: some classes divide each qualified boat’s series score before the{' '}
        {m.name}, which pulls the leaders together so the last races can still decide the
        title. Switch it on under the {w.title('medal')} settings, with the divisor and how it
        rounds; the compressed number appears in a{' '}
        <strong className="text-foreground">Carried</strong> column and replaces the boat’s
        earlier race scores in her total. Rounding to whole numbers makes ties, so the same
        settings offer the tie-breaks those classes pair it with. One keeps rule A8 and adds
        steps behind it: a tie the racing rules can’t break goes to the boat who ranked higher
        in the {f.name}, then the {q.name}. The other replaces A8 outright — the boats are
        ranked on their scores in the last race, and nothing else. Which one your event uses is
        a sentence in its sailing instructions, and the wrong one decides the title differently.
      </p>
      <p>
        One more setting is worth a look if the fleets can come out of the first stage having
        sailed different numbers of races. A race counts for nobody until every fleet has
        sailed it, which on its own levels the fleets and is what most sailing instructions
        say; leave the setting alone unless yours also carries the clause for what might be
        left over after that, where a boat still holding more scores than the rest drops her
        most recent.
      </p>
      <p>
        The published output is a{' '}
        <strong className="text-foreground">championship standings</strong> page — combined
        with a provisional cut line during the {q.name}, tiered Gold/Silver tables after the
        split — plus a <strong className="text-foreground">race results</strong> page with
        every race as its own tables, one per fleet, ranked the way the racing actually happened
        (the standings page’s race column headings link straight into it), and a rolling{' '}
        <strong className="text-foreground">fleet assignments</strong> page, newest round first,
        so competitors always know which start they’re in. Preview, publish, and{' '}
        <strong className="text-foreground">Mark as final</strong> all live on the Split Fleets
        tab (the regular Standings tab is hidden for these series).
      </p>
      <p>
        The standings page also carries the same SI prose you checked your settings against,
        folded away under{' '}
        <strong className="text-foreground">How this championship is scored</strong> — so a
        competitor reading the results can see how the event is scored without being handed
        the sailing instructions again. It follows the settings, so it is right by
        construction: there is nothing to keep in step by hand.
      </p>
    </Section>
  );
}
