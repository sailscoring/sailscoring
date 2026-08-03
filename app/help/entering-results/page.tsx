import type { Metadata } from 'next';

import { getEffectiveFeatures } from '@/lib/auth/require-workspace';
import type { FeatureKey } from '@/lib/features';

import { HelpShell, Section } from '../shell';

export const metadata: Metadata = {
  title: 'Entering results — Help — Sail Scoring',
};

// Per-user dynamic (#155): gated sections only render for viewers whose
// workspace has the feature enabled.
export const dynamic = 'force-dynamic';

export default async function Page() {
  const features = await getEffectiveFeatures();
  const has = (key: FeatureKey) => features.includes(key);
  return (
    <HelpShell slug="entering-results" features={features}>
      <Section id="entering-results" title="Entering results">
        <p>
          The result entry screen is a digital transcription of the handwritten finish sheet.
          Each row is a crossing of the finish line; row order is crossing order. Search for
          a competitor by sail number using the input at the top and they are added to the
          next slot in the list. Pressing <strong className="text-foreground">Enter</strong>{' '}
          adds the boat as soon as what you have typed can only mean one boat — you need not
          finish the whole number. For boats in a fleet with a recorded start, the app prompts
          for a finish time before adding the row.
        </p>
        <p>
          When a series has more than one race, a switcher at the top of the entry screen moves
          you straight to another race without going back to the Races tab — the arrows step to
          the previous or next race (or press <strong className="text-foreground">[</strong> and{' '}
          <strong className="text-foreground">]</strong>), and the dropdown jumps to any race in
          the series.
        </p>
        <p>
          If a sail number is not yet registered in the series, the app will offer to{' '}
          <strong className="text-foreground">Record as unknown</strong>. When the number you
          have typed is also the start of a registered boat&rsquo;s sail number — an unknown{' '}
          <span className="font-mono">12</span> while <span className="font-mono">12345</span>{' '}
          is registered — press <strong className="text-foreground">Shift+Enter</strong> (or
          pick <strong className="text-foreground">Record as unknown</strong> from the
          suggestions) to file it as unknown rather than completing to the registered boat. The
          row is kept in crossing order; click <strong className="text-foreground">Resolve</strong>{' '}
          next to the entry to link it to a registered competitor once you know who it was.
          Unresolved unknown finishes are excluded from standings until resolved.
        </p>
        <p>
          If you’ve enabled the <em>Bow number</em> competitor field, finish
          entry matches on the bow number as well as the sail number. This helps
          when a boat’s bow number differs from its registered sail number and
          the recorders wrote the bow number on the sheet. Sail numbers take
          precedence: a typed value that is one boat’s sail number always
          resolves to that boat, and only falls through to bow-number matching
          when no sail number matches. Because the row then shows the boat’s
          registered <em>sail</em> number — not the bow number you typed — a{' '}
          <strong className="text-foreground">matched on bow</strong> marker
          appears in the suggestion list, and the committed row is tagged{' '}
          <strong className="text-foreground">entered by bow</strong> so it’s
          clear why the displayed sail number differs from what was keyed.
        </p>
        <p>
          Rows for fleets without a start time (scratch scoring) show a{' '}
          <strong className="text-foreground">grip handle</strong> you can drag to reorder a
          boat in the list (or, with the keyboard, focus the handle, press Space, use the arrow
          keys, and press Space to drop). Rows for timed fleets have no handle — their position
          is determined automatically by the finish time. If you edit a time and it no longer
          matches the crossing order, the row slides to its correct slot.
        </p>
        <p>
          When two scratch-fleet boats cross together, tick{' '}
          <strong className="text-foreground">tie</strong> on the second row to mark them as
          tied with the previous row. Tied boats share averaged ranks per RRS A8.1.
        </p>
        <p>
          For competitors who did not finish normally, use the result code dropdown next to their
          name. Boats that simply did not compete (an automatic{' '}
          <strong className="text-foreground">DNC</strong>) sink to a{' '}
          <strong className="text-foreground">Did not compete</strong> group at the foot of the
          panel, so the boats you have actually recorded a result for stay together at the top and
          it is easy to see who is still to account for. In a big fleet, the filter box at the top
          of the panel (shortcut <strong className="text-foreground">/</strong>) narrows the list
          by sail number, boat, helm or class;{' '}
          <strong className="text-foreground">Esc</strong> clears it. Codes are grouped by how
          they arise:
        </p>
        <p className="font-medium text-sm mt-2">Operational codes (assigned during or after the race)</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li><strong className="text-foreground">DNS</strong> — Did Not Start (came to start area but did not start)</li>
          <li><strong className="text-foreground">DNF</strong> — Did Not Finish</li>
          <li><strong className="text-foreground">OCS</strong> — On Course Side at start (premature starter)</li>
          <li><strong className="text-foreground">NSC</strong> — Did Not Sail the Course (finished but missed a mark)</li>
          <li><strong className="text-foreground">RET</strong> — Retired after starting</li>
          <li><strong className="text-foreground">DNC</strong> — Did Not Compete (did not come to the start area)</li>
        </ul>
        <p className="font-medium text-sm mt-2">Protest committee codes (entered after a hearing or RC decision)</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li><strong className="text-foreground">DSQ</strong> — Disqualified</li>
          <li><strong className="text-foreground">DNE</strong> — Disqualification Not Excludable (cannot be discarded)</li>
          <li><strong className="text-foreground">UFD</strong> — U Flag Disqualification, rule 30.3 (discardable)</li>
          <li><strong className="text-foreground">BFD</strong> — Black Flag Disqualification, rule 30.4 (discardable)</li>
        </ul>
        <p>
          By default (RRS A5.2), all penalty codes score{' '}
          <em>series entries + 1</em> points. If you enable{' '}
          <strong className="text-foreground">A5.3 starting-area scoring</strong> in
          Settings, most codes instead score{' '}
          <em>starting-area entries + 1</em> for that race — a smaller penalty when
          turnout is low. DNC still scores series entries + 1 regardless. A third
          option, <strong className="text-foreground">starting area including DNC</strong>{' '}
          (RRS A5.3 as changed by DBSC Sailing Instruction A13.2), scores DNC from the
          boats that came to the start + 1 as well.
        </p>
        <p>
          <strong className="text-foreground">DNE cannot be discarded.</strong>{' '}
          In the standings table it is shown in red. Even if a DNE is a
          competitor’s worst score, the discard falls on their next-worst result
          instead. A plain BFD, by contrast, is an ordinary disqualification and{' '}
          <em>can</em> be discarded like any other score.
        </p>
        <p id="penalty-codes" className="font-medium text-sm mt-2">Additive penalty codes (applied to finishers)</p>
        <p>
          A boat that finishes but is penalised by the protest committee may be assigned an
          additive penalty code from the{' '}
          <strong className="text-foreground">row actions menu</strong> (the{' '}
          <strong className="text-foreground">⋯</strong> button on its row in the finisher
          list). Open the menu and choose <em>Set scoring penalty</em>.
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">ZFP</strong> — Z Flag Penalty (rule 30.2):
            automatically applied (no hearing) to a boat in the triangle zone during the
            last minute before the start. Adds 20% of the DNF score, rounded to the
            nearest whole number (formula per rule 44.3(c)).
          </li>
          <li>
            <strong className="text-foreground">SCP</strong> — Scoring Penalty (PC-imposed):
            adds a specified percentage of the DNF score (default 20%; enter a different value
            to override).
          </li>
          <li>
            <strong className="text-foreground">DPI</strong> — Discretionary Points Increase:
            adds a stated number of points (enter the amount in the penalty editor).
          </li>
        </ul>
        <p>
          Per RRS A6.2, additive penalties do not change other competitors’ scores —
          two boats may legitimately share the same score. The penalised score is capped at
          the DNF score for that race. Penalty codes are shown in amber in the standings table,
          e.g. <em>4 (ZFP)</em>.
        </p>
      </Section>
      {has('csv-finish-import') && (
      <Section id="importing-finish-sheet" title="Importing a finish sheet from a spreadsheet">
        <p>
          On a race’s result entry screen, click{' '}
          <strong className="text-foreground">Import sheet</strong> (or press{' '}
          <strong className="text-foreground">i</strong>) to import a whole finish
          sheet in one go — useful when results are captured on a tablet or in a
          spreadsheet on the RC boat and you want to transcribe the lot at once.
          Both CSV and Excel (.xlsx) files work; Excel time cells import as the
          time shown in the spreadsheet.
        </p>
        <p>The importer reads three columns:</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Sail number</strong> — required; matched
            against registered competitors. Unregistered sail numbers import as unresolved
            crossings that you can resolve later.
          </li>
          <li>
            <strong className="text-foreground">Finish time</strong> — optional; accepts{' '}
            <code className="text-foreground text-sm">HH:MM:SS</code>,{' '}
            <code className="text-foreground text-sm">H:MM:SS</code>, or bare digits like{' '}
            <code className="text-foreground text-sm">143210</code>.
          </li>
          <li>
            <strong className="text-foreground">Result code</strong> — optional; any standard
            RRS code (DNF, DSQ, OCS, RET, DNE, UFD, BFD, DNS, NSC, DNC). Rows with a code are
            recorded as non-finishers and the finish time is ignored.
          </li>
        </ul>
        <p>
          Row order in the sheet is the crossing order — the importer assigns finish positions
          in the order rows appear. A preview dialog shows how many finishers and coded
          entries will be imported and how many existing finishes will be replaced.
        </p>
        <p>
          The import is <strong className="text-foreground">replace-all</strong>: confirming
          replaces the race’s finishing order entirely and clears any penalties, redress,
          and tied-finish markers — the importer only covers the basic sheet, so re-apply
          those in the editor after import if needed. Existing start check-ins are preserved.
          Click <strong className="text-foreground">Save results</strong> after importing to
          persist the change.
        </p>
      </Section>
      )}
      <Section id="redress" title="Redress (RDG)">
        <p>
          When the protest committee grants a competitor redress under RRS Rule 62,
          their score for a race is replaced by an average calculated from their
          other scores. Assign redress from a competitor&rsquo;s controls in the
          race entry screen — the exact control depends on whether they finished
          (see below).
        </p>
        <p>
          There are two entry paths depending on whether the competitor finished:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Finisher granted redress</strong> — the
            boat completed the course and recorded a position, but later received redress to
            improve their score. Open the row actions menu (the <strong className="text-foreground">⋯</strong>{' '}
            button) on its row in the finishing order list and choose <em>Set redress (RDG)</em>. The
            finish position is preserved in the record but replaced by the redress score
            for standings.
          </li>
          <li>
            <strong className="text-foreground">Non-finisher granted redress</strong> — the
            boat did not finish (e.g. retired, RET). Select{' '}
            <strong className="text-foreground">RDG (redress)</strong> from the code
            dropdown in the non-finisher list. A dialog will open to configure the
            redress details.
          </li>
        </ul>
        <p className="font-medium text-sm mt-2">Redress methods (RRS A9)</p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">A9(a) — all races</strong>: average of
            the competitor’s scores in all other races in the series.
          </li>
          <li>
            <strong className="text-foreground">A9(b) — races before</strong>: average
            of scores in races sailed before the race in which redress is granted.
          </li>
          <li>
            <strong className="text-foreground">A9(c) — stated points</strong>: the PC
            assigns a specific points value directly.
          </li>
        </ul>
        <p className="font-medium text-sm mt-2">Pool restriction</p>
        <p>
          For A9(a) and A9(b) you can optionally restrict which races contribute
          to the average:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">Exclude specific races</strong> — remove
            named races from the default pool (e.g. exclude a race the competitor did not
            start).
          </li>
          <li>
            <strong className="text-foreground">Include specific races</strong> — use
            only the listed races. Check{' '}
            <strong className="text-foreground">Include all later races</strong> to also
            include every race after the highest-numbered race in the list.
          </li>
        </ul>
        <p>
          The average is rounded to the nearest tenth (0.05 rounds up, per RRS A9).
          Redress scores are shown in amber with a superscript{' '}
          <em>r</em> in the standings table.
        </p>
        <p className="font-medium text-sm mt-2">Per-fleet stated points (multi-fleet boats)</p>
        <p>
          When a boat is scored in more than one fleet (e.g. the same start scored
          under IRC and ECHO), the redress dialog defaults to one stated value applied
          to every fleet. If the committee wants a different value per fleet — because
          the boat’s standing at the time of the incident differs by handicap system —
          click <strong className="text-foreground">Set points per fleet</strong> and
          enter each fleet’s value. The averaged methods (A9(a)/(b)) already average
          each fleet’s own scores, so they need no per-fleet entry.
        </p>
        <p>
          If you later add the boat to a new fleet, that fleet has no stated value yet:
          it is scored as the A9(a) average for that fleet, and an amber notice on the
          standings names the boat so you can enter a value. (A per-fleet{' '}
          <strong className="text-foreground">DPI</strong> penalty works the same way,
          except a fleet with no value simply has no penalty applied until you set one.)
        </p>
      </Section>
      <Section id="start-check-in" title="Start check-in">
        <p>
          The{' '}
          <strong className="text-foreground">Start check-in</strong> tab on the race
          entry screen lets you record which competitors came to the starting area before
          the race. This is the data source for A5.3 scoring — if you skip check-in, the
          app infers starting-area attendance from the finish records instead.
        </p>
        <p>
          Open a race, switch to the{' '}
          <strong className="text-foreground">Start check-in</strong> tab (or press{' '}
          <strong className="text-foreground">c</strong>), then tap each boat that appears
          at the start. A running count shows how many are marked present.
        </p>
        <p>
          For fast keyboard entry, type a sail number into the search box and press{' '}
          <strong className="text-foreground">Enter</strong> or{' '}
          <strong className="text-foreground">Tab</strong> to toggle the first matching
          boat — the input clears so you can keep typing the next sail number.
        </p>
        <p>
          Check-in saves immediately — you do not need to click Save. Once boats start
          finishing, switch back to{' '}
          <strong className="text-foreground">Finish entry</strong> (press{' '}
          <strong className="text-foreground">c</strong> again) and enter the finishing
          order as normal. Boats that were checked in but have no finish recorded will
          appear in the non-finisher list as DNF rather than DNC.
        </p>
      </Section>
    </HelpShell>
  );
}
