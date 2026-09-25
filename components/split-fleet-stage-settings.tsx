'use client';

// The settings of each stage card on the Split Fleets tab. A setting sits on
// the card of the stage it governs, next to that stage's actions, and only
// where two real events have needed different answers; everything else is
// shown beneath it as the rule the championship follows, in the words the
// sailing-instructions view uses. See docs/design/ux/flows/split-fleets-setup.md.
//
// Reaching a setting, by pointer or by keyboard, marks the sentences it writes
// in the sailing-instructions panel below the cards, so which clause a control
// governs doesn't have to be discovered by changing it.

import { createContext, useContext, useEffect, useState } from 'react';
import { ChevronRight, ScrollText, X } from 'lucide-react';

import { SiTranslation } from '@/components/split-fleet-si';
import { Button } from '@/components/ui/button';
import { useSaveSplitFleetConfig } from '@/hooks/use-split-fleets';
import { SENTENCES_BY_SETTING, type SplitFleetSentenceId } from '@/lib/split-fleets-si';
import {
  capitaliseStage,
  FINAL_FLEET_SET,
  QUALIFYING_COLOR_SETS,
  resizeFleets,
  resolveVocabulary,
  stageAdjective,
  stageRaceLabel,
  VOCABULARY_OPTIONS,
  type SplitFleetConfig,
  type VocabularyKey,
} from '@/lib/split-fleets';

// ─── Marking the sentences a setting writes ─────────────────────────────────

type Setting = keyof typeof SENTENCES_BY_SETTING;

const MarkContext = createContext<{
  marked: readonly SplitFleetSentenceId[] | null;
  setHovered: (ids: readonly SplitFleetSentenceId[] | null) => void;
  setFocused: (ids: readonly SplitFleetSentenceId[] | null) => void;
  /** The sailing-instructions drawer beside the cards. */
  siOpen: boolean;
  setSiOpen: (open: boolean) => void;
}>({
  marked: null,
  setHovered: () => {},
  setFocused: () => {},
  siOpen: false,
  setSiOpen: () => {},
});

/** Where the drawer's open state is remembered between visits: a per-viewer
 *  convenience, so a scorer who reads with it open finds it open again. */
const SI_OPEN_KEY = 'sailscoring.split-fleets.si-drawer';

/** Holds which sentences the setting the scorer has reached writes, and
 *  whether the sailing instructions are open beside the cards. Hover and
 *  focus are held apart so that focus wins: someone tabbing through the
 *  settings should see the one they are on, not wherever the pointer came to
 *  rest. */
export function SettingMarkProvider({ children }: { children: React.ReactNode }) {
  const [hovered, setHovered] = useState<readonly SplitFleetSentenceId[] | null>(null);
  const [focused, setFocused] = useState<readonly SplitFleetSentenceId[] | null>(null);
  const [siOpen, setSiOpenState] = useState(false);
  // Storage is unreadable during server rendering, so the remembered state
  // can only be restored after hydration.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (localStorage.getItem(SI_OPEN_KEY) === 'open') setSiOpenState(true);
    } catch {
      // Storage blocked: the drawer starts closed.
    }
  }, []);
  const setSiOpen = (open: boolean) => {
    setSiOpenState(open);
    try {
      localStorage.setItem(SI_OPEN_KEY, open ? 'open' : 'closed');
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };
  return (
    <MarkContext.Provider
      value={{ marked: focused ?? hovered, setHovered, setFocused, siOpen, setSiOpen }}
    >
      {children}
    </MarkContext.Provider>
  );
}

export function useSailingInstructionsOpen(): boolean {
  return useContext(MarkContext).siOpen;
}

/** Opens the sailing instructions beside the cards. */
export function SailingInstructionsToggle() {
  const { siOpen, setSiOpen } = useContext(MarkContext);
  return (
    <Button
      variant="outline"
      size="sm"
      aria-expanded={siOpen}
      onClick={() => setSiOpen(!siOpen)}
    >
      <ScrollText className="h-4 w-4" />
      Sailing instructions
    </Button>
  );
}

/**
 * The configuration restated as sailing instructions, in a drawer on the
 * right. Not modal: it is read beside the settings, and reaching a setting
 * marks the sentences it writes, so the cards stay usable while it is open.
 */
export function SailingInstructionsDrawer({ config }: { config: SplitFleetConfig }) {
  const { marked, siOpen, setSiOpen } = useContext(MarkContext);
  if (!siOpen) return null;
  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l bg-card shadow-xl sm:w-[26rem]"
      aria-label="Sailing instructions"
      onKeyDown={(e) => {
        if (e.key === 'Escape') setSiOpen(false);
      }}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">
          How this configuration translates to sailing instructions
        </h2>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Close sailing instructions"
          onClick={() => setSiOpen(false)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 px-4 py-3 text-sm">
        <SiTranslation config={config} marked={marked} alwaysOpen fill />
      </div>
    </aside>
  );
}

const rowClass = 'grid gap-1.5 sm:grid-cols-[11rem_1fr] sm:items-baseline sm:gap-3';
const hint = 'text-xs text-muted-foreground';
const selectClass = 'rounded-md border bg-background px-2 py-1 text-sm';

/** A settings row that marks the sentences its settings write while the
 *  scorer is on it. React's onFocus and onBlur bubble, so the controls inside
 *  report through the row without wiring each one. */
function Row({
  settings,
  label,
  htmlFor,
  children,
}: {
  settings: Setting[];
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  const { setHovered, setFocused } = useContext(MarkContext);
  const ids = settings.flatMap((k) => SENTENCES_BY_SETTING[k] as SplitFleetSentenceId[]);
  return (
    <div
      className={rowClass}
      onMouseEnter={() => setHovered(ids)}
      onMouseLeave={() => setHovered(null)}
      onFocus={() => setFocused(ids)}
      onBlur={() => setFocused(null)}
    >
      {htmlFor ? (
        <label className="font-medium" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="font-medium">{label}</span>
      )}
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

// ─── The expander ───────────────────────────────────────────────────────────

/** A stage card's settings, at the top of the card: open while the stage is
 *  the one being set up, so they are settled before its fleets are dealt,
 *  and closed otherwise, with the values that differ between real events
 *  summarised on the closed line. Controls above the rule, the rules the
 *  stage follows below it. */
export function StageSettings({
  title,
  summary,
  controls,
  rules,
  actions,
  current = false,
}: {
  title: string;
  summary: string;
  controls?: React.ReactNode;
  rules: string[];
  actions?: React.ReactNode;
  /** The stage is the one the scorer is about to start: open until they
   *  close it. */
  current?: boolean;
}) {
  // Follows `current` — so a stage's settings open as the event reaches it —
  // until the scorer toggles them, which takes over from then on.
  const [userOpen, setUserOpen] = useState<boolean | null>(null);
  const open = userOpen ?? current;
  const setOpen = (v: boolean) => setUserOpen(v);
  return (
    <div className="rounded-md border bg-background/60">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
        aria-expanded={open}
        aria-label={`${title} settings`}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight className={`h-4 w-4 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="font-medium">Settings</span>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t px-3 py-3 text-sm" data-testid={`${title} settings`}>
          {controls && <div className="space-y-3">{controls}</div>}
          <ul className="space-y-1 border-t pt-3 text-xs text-muted-foreground">
            {rules.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            <ReadAlongside />
          </div>
        </div>
      )}
    </div>
  );
}

/** From inside a card's settings: open the sailing instructions beside them,
 *  which is where they are read. */
function ReadAlongside() {
  const { siOpen, setSiOpen } = useContext(MarkContext);
  if (siOpen) return null;
  return (
    <Button variant="ghost" size="sm" onClick={() => setSiOpen(true)}>
      <ScrollText className="h-4 w-4" />
      Read alongside the sailing instructions
    </Button>
  );
}

// ─── Shared controls ────────────────────────────────────────────────────────

/** What the settings may still change, given what has been sailed. */
export interface StageLocks {
  /** A race exists: its label is on the notice board. */
  words: boolean;
  /** Stage 1's first round is committed. */
  qualifyingFleets: boolean;
  /** The split is committed: boats hold second-stage scores. */
  division: boolean;
}

function useSave(seriesId: string, config: SplitFleetConfig) {
  const save = useSaveSplitFleetConfig(seriesId);
  return {
    patch: (p: Partial<SplitFleetConfig>) => save.mutate({ ...config, ...p }),
    error: save.isError ? String(save.error) : null,
  };
}

/** Fleet count, then a name and colour for each fleet. */
function FleetsControl({
  id,
  fleets,
  palette,
  min,
  locked,
  canEdit,
  onChange,
}: {
  id: string;
  fleets: { label: string; color: string }[];
  palette: { label: string; color: string }[];
  min: number;
  locked: boolean;
  canEdit: boolean;
  onChange: (fleets: { label: string; color: string }[]) => void;
}) {
  const counts = [1, 2, 3, 4].filter((n) => n >= min);
  return (
    <>
      <select
        id={id}
        className={selectClass}
        disabled={!canEdit || locked}
        value={fleets.length}
        onChange={(e) => onChange(resizeFleets(fleets, Number(e.target.value), palette))}
      >
        {counts.map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </select>
      {fleets.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {fleets.map((f, i) => (
            <span key={`${i}:${f.label}`} className="inline-flex items-center gap-1">
              <input
                type="color"
                aria-label={`Colour of fleet ${i + 1}`}
                className="h-6 w-6 cursor-pointer rounded border bg-background p-0"
                disabled={!canEdit}
                value={f.color}
                onChange={(e) =>
                  onChange(fleets.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))
                }
              />
              <input
                aria-label={`Name of fleet ${i + 1}`}
                className="w-24 rounded-md border bg-background px-2 py-1 text-sm"
                disabled={!canEdit}
                defaultValue={f.label}
                onBlur={(e) => {
                  const label = e.target.value.trim();
                  if (label && label !== f.label) {
                    onChange(fleets.map((x, j) => (j === i ? { ...x, label } : x)));
                  }
                }}
              />
            </span>
          ))}
        </div>
      )}
      {locked && (
        <p className={hint}>Settled now that the first round has dealt these fleets.</p>
      )}
    </>
  );
}

function DiscardsControl({
  config,
  canEdit,
  patch,
}: {
  config: SplitFleetConfig;
  canEdit: boolean;
  patch: (p: Partial<SplitFleetConfig>) => void;
}) {
  const ladder = config.discardThresholds;
  const set = (i: number, field: 'minRaces' | 'discardCount', n: number) =>
    patch({
      discardThresholds: ladder.map((t, j) => (j === i ? { ...t, [field]: Math.max(1, n) } : t)),
    });
  const add = () => {
    const last = [...ladder].sort((a, b) => a.minRaces - b.minRaces).at(-1);
    patch({
      discardThresholds: [
        ...ladder,
        { minRaces: (last?.minRaces ?? 3) + 1, discardCount: (last?.discardCount ?? 0) + 1 },
      ],
    });
  };
  return (
    <>
      {ladder.length === 0 && <p>No scores are excluded.</p>}
      {ladder.map((t, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <span>Exclude</span>
          <input
            type="number"
            aria-label="Scores excluded"
            min={1}
            className="w-14 rounded-md border bg-background px-2 py-1 text-sm"
            disabled={!canEdit}
            value={t.discardCount}
            onChange={(e) => set(i, 'discardCount', Number(e.target.value))}
          />
          <span>score{t.discardCount === 1 ? '' : 's'} from</span>
          <input
            type="number"
            aria-label="Races completed"
            min={1}
            className="w-14 rounded-md border bg-background px-2 py-1 text-sm"
            disabled={!canEdit}
            value={t.minRaces}
            onChange={(e) => set(i, 'minRaces', Number(e.target.value))}
          />
          <span>races</span>
          {canEdit && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-muted-foreground"
              aria-label="Remove discard rule"
              onClick={() => patch({ discardThresholds: ladder.filter((_, j) => j !== i) })}
            >
              ×
            </Button>
          )}
        </div>
      ))}
      {canEdit && (
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add a rule
        </Button>
      )}
    </>
  );
}

function discardSummary(config: SplitFleetConfig): string {
  const ladder = [...config.discardThresholds].sort((a, b) => a.minRaces - b.minRaces);
  if (ladder.length === 0) return 'no discards';
  return ladder.map((t) => `${t.discardCount} from ${t.minRaces} races`).join(', ');
}

function labels(config: SplitFleetConfig, stage: 'qualifying' | 'final' | 'medal'): string {
  return `${stageRaceLabel(config, stage, 1)}, ${stageRaceLabel(config, stage, 2)} and so on`;
}

// ─── Opening series ─────────────────────────────────────────────────────────

/** The opening series: undivided, the whole of stage 1; divided, the parent of
 *  its two parts, holding what runs over both — the words and the discards. */
export function OpeningSettings({
  seriesId,
  config,
  locks,
  canEdit,
  medalSelected = false,
  current,
}: {
  seriesId: string;
  config: SplitFleetConfig;
  locks: StageLocks;
  canEdit: boolean;
  /** The medal fleet is selected, so an undivided series' next race is the
   *  companion race. */
  medalSelected?: boolean;
  current?: boolean;
}) {
  const { patch, error } = useSave(seriesId, config);
  const vocab = resolveVocabulary(config);
  const divided = config.split.kind !== 'none';
  const q = vocab.stages.qualifying;
  const f = vocab.stages.final;
  const oneFleet = config.qualifyingFleets.length === 1;
  const title = capitaliseStage(divided ? vocab.seriesName : q.name);
  // What dividing would call the two parts: the wording's own names, which
  // the undivided vocabulary folds into one.
  const parts = resolveVocabulary({ ...config, split: { kind: 'equal-blocks' } }).stages;

  const rules = divided
    ? [
        `The discards run over the ${q.name} and the ${f.name} together.`,
        `No ${vocab.stages.medal.raceNoun} counts towards the discards, and none is excluded.`,
      ]
    : [
        `Races are numbered ${labels(config, 'qualifying')}.`,
        oneFleet
          ? `A boat that doesn’t finish scores the number of entries, plus one.`
          : `A boat that doesn’t finish scores the number of boats in the largest fleet, plus one.`,
        ...(oneFleet
          ? []
          : [
              `A race counts only once every fleet has sailed it.`,
              `Boats keep the fleet they are first assigned to.`,
            ]),
        ...(medalSelected
          ? [
              `A race added now is the companion race for the boats outside the ${vocab.stages.medal.fleetNoun}, scored from ${config.medal.size + 1}.`,
            ]
          : []),
      ];

  return (
    <StageSettings
      title={title}
      current={current}
      summary={[
        divided ? null : `${config.qualifyingFleets.length} fleet${oneFleet ? '' : 's'}`,
        discardSummary(config),
      ]
        .filter(Boolean)
        .join(' · ')}
      rules={rules}
      controls={
        <>
          <div className={rowClass}>
            <label className="font-medium" htmlFor="sf-vocabulary">
              Words used
            </label>
            <div className="space-y-1">
              <select
                id="sf-vocabulary"
                className={selectClass}
                disabled={!canEdit || locks.words}
                value={config.vocabulary}
                onChange={(e) => patch({ vocabulary: e.target.value as VocabularyKey })}
              >
                {VOCABULARY_OPTIONS.map((o) => (
                  <option key={o.key} value={o.key}>
                    {o.label}
                  </option>
                ))}
              </select>
              <p className={hint}>
                {locks.words
                  ? 'Settled now that races carry its labels.'
                  : VOCABULARY_OPTIONS.find((o) => o.key === config.vocabulary)?.terms}
              </p>
            </div>
          </div>
          {!divided && (
            <Row settings={['fleetCount']} label="Fleets" htmlFor="sf-fleet-count">
              <FleetsControl
                id="sf-fleet-count"
                fleets={config.qualifyingFleets}
                palette={QUALIFYING_COLOR_SETS}
                min={1}
                locked={locks.qualifyingFleets}
                canEdit={canEdit}
                onChange={(qualifyingFleets) => patch({ qualifyingFleets })}
              />
            </Row>
          )}
          <Row settings={['discards']} label="Discards">
            <DiscardsControl config={config} canEdit={canEdit} patch={patch} />
          </Row>
          {error && <p className="text-destructive">{error}</p>}
        </>
      }
      actions={
        canEdit && !locks.division ? (
          divided ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => patch({ split: { kind: 'none' }, finalFleets: [] })}
            >
              Undivide
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({ split: { kind: 'equal-blocks' }, finalFleets: FINAL_FLEET_SET.slice(0, 2) })
              }
            >
              Divide into {articled(parts.qualifying.name)} and {articled(parts.final.name)}
            </Button>
          )
        ) : undefined
      }
    />
  );
}

function articled(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

// ─── The two parts of a divided opening series ──────────────────────────────

export function Stage1Settings({
  seriesId,
  config,
  locks,
  canEdit,
  current,
}: {
  seriesId: string;
  config: SplitFleetConfig;
  locks: StageLocks;
  canEdit: boolean;
  current?: boolean;
}) {
  const { patch, error } = useSave(seriesId, config);
  const vocab = resolveVocabulary(config);
  const q = vocab.stages.qualifying;
  const fleets = config.qualifyingFleets;
  return (
    <StageSettings
      title={capitaliseStage(q.name)}
      current={current}
      summary={`${fleets.length} fleet${fleets.length === 1 ? '' : 's'} · ${fleets.map((f) => f.label).join(', ')}`}
      rules={[
        `Races are numbered ${labels(config, 'qualifying')}.`,
        `A boat that doesn’t finish scores the number of boats in the largest ${stageAdjective(q.name)} fleet, plus one.`,
        ...(fleets.length > 1
          ? [
              `A race counts only once every fleet of its round has sailed it.`,
              `Boats are reassigned to the fleets by rank between rounds.`,
            ]
          : []),
      ]}
      controls={
        <>
          <Row settings={['fleetCount']} label="Fleets" htmlFor="sf-fleet-count">
            <FleetsControl
              id="sf-fleet-count"
              fleets={fleets}
              palette={QUALIFYING_COLOR_SETS}
              min={1}
              locked={locks.qualifyingFleets}
              canEdit={canEdit}
              onChange={(qualifyingFleets) => patch({ qualifyingFleets })}
            />
          </Row>
          {error && <p className="text-destructive">{error}</p>}
        </>
      }
    />
  );
}

export function Stage2Settings({
  seriesId,
  config,
  locks,
  canEdit,
  medalSelected,
  current,
}: {
  seriesId: string;
  config: SplitFleetConfig;
  locks: StageLocks;
  canEdit: boolean;
  medalSelected: boolean;
  current?: boolean;
}) {
  const { patch, error } = useSave(seriesId, config);
  const vocab = resolveVocabulary(config);
  const q = vocab.stages.qualifying;
  const f = vocab.stages.final;
  const m = vocab.stages.medal;
  const fleets = config.finalFleets;
  return (
    <StageSettings
      title={capitaliseStage(f.name)}
      current={current}
      summary={`${fleets.length} fleets · ${fleets.map((x) => x.label).join(', ')}`}
      rules={[
        `Races are numbered ${labels(config, 'final')}.`,
        `Boats are divided by their ${q.name} rank into near-equal fleets, the top fleet largest.`,
        `A boat that doesn’t finish scores the number of boats in her own fleet, plus one.`,
        `Points carry on from the ${q.name} as one series.`,
        `At most one excluded score may come from the ${f.name}, and never from a lone ${f.raceNoun}.`,
        ...(medalSelected
          ? [
              `The boats outside the ${m.fleetNoun} sail one more race in their own fleets, scored from ${config.medal.size + 1} in the fleet the ${m.fleetNoun} left.`,
            ]
          : []),
      ]}
      controls={
        <>
          <Row settings={['fleetCount']} label="Fleets" htmlFor="sf-final-fleet-count">
            <FleetsControl
              id="sf-final-fleet-count"
              fleets={fleets}
              palette={FINAL_FLEET_SET}
              min={2}
              locked={locks.division}
              canEdit={canEdit}
              onChange={(finalFleets) => patch({ finalFleets })}
            />
          </Row>
          {error && <p className="text-destructive">{error}</p>}
        </>
      }
    />
  );
}

// ─── The deciding stage ─────────────────────────────────────────────────────

export function MedalSettings({
  seriesId,
  config,
  canEdit,
  current,
}: {
  seriesId: string;
  config: SplitFleetConfig;
  canEdit: boolean;
  current?: boolean;
}) {
  const { patch, error } = useSave(seriesId, config);
  const vocab = resolveVocabulary(config);
  const m = vocab.stages.medal;
  const medal = config.medal;
  const divided = config.split.kind !== 'none';
  const from = divided
    ? `the ${config.finalFleets[0]?.label ?? 'top'} fleet`
    : `the ${vocab.stages.qualifying.name}`;
  const setMedal = (p: Partial<SplitFleetConfig['medal']>) => patch({ medal: { ...medal, ...p } });
  const radio = (name: string, checked: boolean, onChange: () => void, label: string) => (
    <label className="flex items-center gap-2">
      <input type="radio" name={name} disabled={!canEdit} checked={checked} onChange={onChange} />
      {label}
    </label>
  );
  return (
    <StageSettings
      title={capitaliseStage(m.name)}
      current={current}
      summary={[
        `${medal.size} boats`,
        medal.multiplier === 2 ? 'double points' : 'single points',
        medal.carryTransform ? 'net score halved' : 'net score carried',
      ].join(' · ')}
      rules={[
        `Races are numbered ${labels(config, 'medal')}.`,
        `No ${m.raceNoun} is excluded, and none counts towards the discards.`,
        `The ${m.fleetNoun} is the top ${medal.size} of ${from}, ties settled by rule A8 and then entry order.`,
        `The ${m.fleetNoun} ranks ahead of every other boat, whatever the points say.`,
        ...(medal.carryTransform
          ? [
              `The halved score applies from the first completed ${m.raceNoun}. If none is completed, the undivided score stands.`,
            ]
          : []),
      ]}
      controls={
        <>
          <Row settings={['medal']} label="Boats" htmlFor="sf-medal-size-setting">
            <input
              id="sf-medal-size-setting"
              type="number"
              aria-label={`${capitaliseStage(m.fleetNoun)} size`}
              min={2}
              className="w-16 rounded-md border bg-background px-2 py-1 text-sm"
              disabled={!canEdit}
              value={medal.size}
              onChange={(e) => setMedal({ size: Math.max(2, Number(e.target.value)) })}
            />
            <p className={hint}>Also where the provisional cut line is drawn before selection.</p>
          </Row>
          <Row settings={['medal']} label="Points">
            <div className="flex flex-wrap gap-4" role="radiogroup" aria-label={`${capitaliseStage(m.name)} points`}>
              {radio('sf-medal-points', medal.multiplier === 1, () => setMedal({ multiplier: 1 }), 'Single')}
              {radio('sf-medal-points', medal.multiplier === 2, () => setMedal({ multiplier: 2 }), 'Double')}
            </div>
          </Row>
          <Row settings={['medalCarryTransform']} label="Score carried in">
            <div className="flex flex-wrap gap-4" role="radiogroup" aria-label="Score carried in">
              {radio('sf-medal-carry', !medal.carryTransform, () => setMedal({ carryTransform: undefined }), 'Net score')}
              {radio(
                'sf-medal-carry',
                !!medal.carryTransform,
                () => setMedal({ carryTransform: { kind: 'divide', by: 2, rounding: 'half-up' } }),
                'Net score halved, 0.5 rounded up',
              )}
            </div>
          </Row>
          <Row settings={['medalTieBreak']} label="Ties">
            <div className="space-y-1" role="radiogroup" aria-label="How ties between the top boats are broken">
              {radio(
                'sf-medal-ties',
                medal.tieBreak === 'medal-race-then-a8',
                () => setMedal({ tieBreak: 'medal-race-then-a8' }),
                `The ${m.raceNoun} first, then rule A8`,
              )}
              {radio(
                'sf-medal-ties',
                medal.tieBreak === 'last-race',
                () => setMedal({ tieBreak: 'last-race' }),
                'The last race alone',
              )}
            </div>
          </Row>
          {error && <p className="text-destructive">{error}</p>}
        </>
      }
    />
  );
}
