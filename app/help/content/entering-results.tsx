'use client';

import { useFeatures } from '@/components/features-provider';

import { HelpShot, Section } from '../ui';

/** The “Entering results” chapter — rendered by the /help/entering-results route and,
 *  loaded on demand, by the help panel. */
export default function EnteringResults() {
  const { has } = useFeatures();
  return (
    <>
      <Section id="entering-results" title="Entering results">
        <HelpShot
          src="/help/shots/finish-entry.webp"
          alt="The finishing order is the finish sheet: row order is crossing order."
          caption="The finishing order is the finish sheet: row order is crossing order."
        />
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
          Paper finish sheets sometimes record the same boat twice. If you type a number that
          is already in the finishing order, the suggestions show it as a muted{' '}
          <strong className="text-foreground">already entered</strong> row with its position,
          and pressing <strong className="text-foreground">Enter</strong> highlights the
          existing entry and tells you where the boat finished rather than adding it again —
          so you can compare the entry against the sheet and decide which of the recorded
          positions is the right one.
        </p>
        <p>
          If a sail number is not yet registered in the series, the app will offer to{' '}
          <strong className="text-foreground">Record as unknown</strong>. When the number you
          have typed is also the start of a registered boat’s sail number — an unknown{' '}
          <span className="font-mono">12</span> while <span className="font-mono">12345</span>{' '}
          is registered — press <strong className="text-foreground">Shift+Enter</strong> (or
          pick <strong className="text-foreground">Record as unknown</strong> from the
          suggestions) to file it as unknown rather than completing to the registered boat. The
          row is kept in crossing order; click <strong className="text-foreground">Resolve</strong>{' '}
          next to the entry to link it to a registered competitor once you know who it was. The
          resolve dialog opens with the cursor in a filter box — type any part of a sail number,
          boat name or person and the list of boats still to finish narrows as you go, then use
          the arrow keys and <strong className="text-foreground">Enter</strong> to pick one.
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
          The <em>Alternative sail numbers</em> field works the same way, for
          the case where a boat sails under a different number rather than
          carrying a second identifier: a replacement sail, a borrowed one, or a
          charter picked up mid-event. List the numbers the boat may show
          against its entry (see{' '}
          <em>Alternative sail numbers</em> in <em>Running a series</em>) and
          finish entry matches any of them. The registered sail number still
          takes precedence over every alternative, and alternatives are tried
          before bow numbers.
        </p>
        <p>
          A row matched this way is tagged{' '}
          <strong className="text-foreground">sailed as</strong> with the number
          the boat actually showed. That tag is stored with the result, so the
          series keeps a record of which sail a boat raced under in each race
          even though results always display and publish the registered number.
          Resolving an unknown number by hand tags the row the same way, but the
          tag belongs to that one result — it does not change the boat’s entry.
          If the boat is on the borrowed sail for the rest of the event, tick{' '}
          <strong className="text-foreground">Also record … as an alternative
          sail number</strong> in the resolve dialog and later races match it
          without asking. Leave it unticked for a one-off: a number recorded
          against the entry is matched silently from then on, so a mis-called
          number would keep finding that boat.
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
          A <strong className="text-foreground">DPI</strong> can also carry a short note of{' '}
          <em>what it was for</em> — <em>TPO</em> for a missed tally, say, or whatever the
          sailing instructions call it. The published results then show that word in place of{' '}
          <em>DPI</em>, with a line beneath the table saying it is a discretionary points
          penalty, so a reader can tell one penalty from another instead of seeing three
          identical <em>DPI</em>s. Notes you have already used in the series are offered as you
          type, which keeps one reason from acquiring three spellings.
        </p>
        <p>
          The note changes nothing about the score: the points come from the amount you enter,
          and the penalty is discardable and A6.2-compliant either way.
        </p>
        <p>
          Per RRS A6.2, additive penalties do not change other competitors’ scores —
          two boats may legitimately share the same score. The penalised score is capped at
          the DNF score for that race. Penalty codes are shown in amber in the standings table,
          e.g. <em>4 (ZFP)</em>.
        </p>
      </Section>
      {has('csv-finish-import') && (
      <Section id="importing-finish-sheet" title="Importing a finish sheet from a spreadsheet">
        <HelpShot
          src="/help/shots/finish-sheet-import.webp"
          alt="The import confirms what will land before it replaces the race."
          caption="The import confirms what will land before it replaces the race."
        />
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
            <code className="text-foreground text-sm">H:MM:SS</code>, dot-separated{' '}
            <code className="text-foreground text-sm">HH.MM.SS</code>, or bare digits like{' '}
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
          in the order rows appear. Times are entirely optional: a sheet with nothing but sail
          numbers in finishing order imports as untimed finishes, which is all scratch scoring
          needs. A preview dialog shows how many finishers and coded entries will be imported
          and how many existing finishes will be replaced — including how many finishers have
          no time, and a warning if any of those are in a handicap fleet that needs times to
          score.
        </p>
        <p>
          The import is <strong className="text-foreground">replace-all</strong>: confirming
          replaces the race’s finishing order entirely. What the sheet can’t express —
          penalties, redress, tied-finish markers, start check-ins — is carried across from
          the race’s existing finishes wherever it still fits: a penalty or redress stays
          with a boat who is still a finisher, a tie stays while the pair of boats it marks
          is unchanged, a check-in stays as long as the boat appears on the sheet. The
          preview says what carries and, in red, what this import clears — re-enter anything
          from that list in the editor afterwards if it should survive. Click{' '}
          <strong className="text-foreground">Save results</strong> after importing to
          persist the change.
        </p>
      </Section>
      )}
      {has('racesense-import') && (
      <Section id="racesense-import" title="Importing from RaceSense">
        <p>
          <strong className="text-foreground">RaceSense</strong> is Vakaros’ race-committee
          app. It exports a regatta as one Excel workbook with a sheet per race, and the
          app reads that workbook straight into your races: on the{' '}
          <strong className="text-foreground">Races</strong> tab, click{' '}
          <strong className="text-foreground">Import from RaceSense</strong> (or press{' '}
          <strong className="text-foreground">i</strong>).
        </p>
        <p>
          RaceSense records which boats started, which were on the course side, which
          cleared, and the finish times of the boats that finished. It does not record
          retirements, disqualifications, redress or penalties — those reach you as notes
          from the race committee and you enter them yourself.
        </p>
        <p>
          The export always contains the <em>whole</em> regatta, so the file you get on the
          last day still holds the first day’s races. That is why the import asks race by
          race rather than writing everything:
        </p>
        <ul className="list-disc list-inside space-y-1 pl-2">
          <li>
            <strong className="text-foreground">New</strong> — the race has no finishes yet.
            Ticked for you.
          </li>
          <li>
            <strong className="text-foreground">Unchanged</strong> — the race already holds
            exactly what the sheet says. Nothing to do, and a useful confirmation that the
            app and the committee’s device agree.
          </li>
          <li>
            <strong className="text-foreground">Differs</strong> — the race holds something
            else. Left unticked, with the boats it would change listed, so a correction you
            entered by hand is never overwritten by accident.
          </li>
          <li>
            <strong className="text-foreground">No race</strong> — there is nothing in this
            series for that sheet yet.
          </li>
        </ul>
        <p>
          Two things the workbook can’t tell the app sit at the top of the dialog. If the
          series has fleets, say which one this export belongs to. And if a race was
          abandoned and resailed, RaceSense’s numbering will have parted company with your
          series’ — <strong className="text-foreground">Shift by</strong> moves every sheet
          along together, or you can point a single sheet at a race yourself.
        </p>
        <p>
          A boat who was over the line and never cleared appears in RaceSense’s finish list
          as a DNF; only her start status records what really happened. The import scores
          her <strong className="text-foreground">OCS</strong> — or UFD or BFD, following
          the race’s preparatory signal. If the signal isn’t one the app recognises it says
          so and leaves the code to you rather than guessing.
        </p>
        <p>
          Anything else the workbook does that the app didn’t expect is listed before the
          races are — an unfamiliar column, a status it has never seen, a race whose
          Summary and race sheet disagree. Importing a ticked race{' '}
          <strong className="text-foreground">replaces</strong> that race’s finishes; other
          races are left alone. Penalties, redress, ties and start check-ins the workbook
          can’t express are carried across from what the race already holds wherever they
          still fit — a race whose only extra state carries cleanly still reads back{' '}
          <strong className="text-foreground">Unchanged</strong> — and anything that can’t
          carry (a penalty on a boat the sheet now codes DNF, say) puts the race in{' '}
          <strong className="text-foreground">Differs</strong> with the loss spelled out in
          its change list.
        </p>
      </Section>
      )}
      <Section id="redress" title="Redress (RDG)">
        <HelpShot
          src="/help/shots/redress.webp"
          alt="Granting redress: the three RRS A9 methods and the race pool."
          caption="Granting redress: the three RRS A9 methods and the race pool."
        />
        <p>
          When the protest committee grants a competitor redress under RRS Rule 62,
          their score for a race is replaced by an average calculated from their
          other scores. Assign redress from a competitor’s controls in the
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
        <HelpShot
          src="/help/shots/start-check-in.webp"
          alt="Ticking off boats in the starting area as they arrive."
          caption="Ticking off boats in the starting area as they arrive."
        />
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
    </>
  );
}
