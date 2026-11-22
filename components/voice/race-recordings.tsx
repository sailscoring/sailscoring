'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mic, Play } from 'lucide-react';

import { useFeatures } from '@/components/features-provider';
import { Button } from '@/components/ui/button';
import { formatRelativeTime } from '@/lib/relative-time';
import type { Competitor, FinishSubmission, SubmittedFinish } from '@/lib/types';
import { deleteRecording, fetchSegment, listRaceRecordings, type RecordingInfo } from '@/lib/voice/client/api';
import { fileStem, playSpan, recordingWav, saveFile, timelineFile, type ReadPiece } from '@/lib/voice/client/playback';
import { clockTime } from '@/lib/voice/sheet';
import { readTimeline, suggestFinishes, type Suggestion } from '@/lib/voice/timeline';
import type { DismissTarget, FinishEdit, Nameable } from '@/lib/voice/timeline-rows';
import { DEFAULT_LAG_SECONDS, SEGMENT_SAMPLES, type VoiceDismissal, type VoiceFinish } from '@/lib/voice/types';

import { TimelineView, type TimelineEditing, type TimelineSource } from './timeline-view';

/**
 * A race's voice recordings, as the scorer meets them (ADR-017): in the
 * review of a finish sheet submission, where the scorer has the same
 * timeline the recorder had and can accept the suggestions the recorder
 * left, and beside the race afterwards, for a scoring inquiry, for as long
 * as a recording is kept. Whoever made a recording and anyone who can score
 * can hear it.
 */

const recordingsKey = (raceId: string) => ['voiceRecordings', raceId] as const;

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** The race's recordings this user may hear. Nothing is asked for where the
 *  workspace doesn't have finishes by voice. */
export function useRaceRecordings(raceId: string) {
  const enabled = useFeatures().has('voice-recording');
  return useQuery({
    queryKey: recordingsKey(raceId),
    queryFn: () => listRaceRecordings(raceId),
    enabled,
    // The sound follows the sheet by a few seconds: look again while a
    // review is open.
    refetchInterval: 30_000,
  });
}

/** Reads a stored recording's sound a piece at a time, keeping what it has
 *  fetched: playing a stretch twice fetches it once. */
function useSound(recordingId: string | undefined): ReadPiece {
  const pieces = useRef(new Map<string, Promise<Int16Array | undefined>>());
  return useMemo<ReadPiece>(
    () => (take, index) => {
      if (!recordingId) return Promise.resolve(undefined);
      const key = `${recordingId}:${take}:${index}`;
      let piece = pieces.current.get(key);
      if (!piece) {
        piece = fetchSegment(recordingId, take, index);
        pieces.current.set(key, piece);
        // A piece that failed, or hasn't arrived yet, is asked for again.
        piece.then((p) => { if (!p) pieces.current.delete(key); }, () => pieces.current.delete(key));
      }
      return piece;
    },
    [recordingId],
  );
}

/** How much of a recording's sound has reached the server, 0 to 1. */
function arrived(recording: RecordingInfo): number {
  const expected = recording.document.takes.reduce((n, t) => n + Math.ceil(t.samples / SEGMENT_SAMPLES), 0);
  const stored = recording.stored.reduce((n, s) => n + s.indexes.length, 0);
  return expected === 0 ? 1 : Math.min(1, stored / expected);
}

function nameablesOf(competitors: readonly Competitor[]): Nameable[] {
  return competitors.map((c) => ({ id: c.id, sailNumber: c.sailNumber, name: c.boatName || c.names.join(' & ') }));
}

/** A recording's timeline, read here, with finishes and dismissals of the
 *  scorer's own on top of the recorder's. */
function useRecordingSource(
  recording: RecordingInfo | null,
  competitors: readonly Competitor[],
  takesTime: (competitorId: string | null) => boolean,
  extra: { finishes: readonly VoiceFinish[]; dismissals: readonly VoiceDismissal[]; removed: ReadonlySet<string> } | null,
): TimelineSource | null {
  const read = useSound(recording?.id);
  const entries = useMemo(() => competitors.map((c) => ({ id: c.id, sailNumber: c.sailNumber })), [competitors]);
  const doc = recording?.document;
  const lagSeconds = doc?.engine?.lagSeconds ?? DEFAULT_LAG_SECONDS;
  const timeline = useMemo(() => (doc ? readTimeline(doc, entries, { lagSeconds }) : null), [doc, entries, lagSeconds]);
  const finishes = useMemo(
    () =>
      doc
        ? [
            ...doc.finishes.map((f) => (extra?.removed.has(f.id) ? { ...f, removed: true } : extra?.finishes.find((x) => x.id === f.id) ?? f)),
            ...(extra?.finishes.filter((x) => !doc.finishes.some((f) => f.id === x.id)) ?? []),
          ]
        : [],
    [doc, extra],
  );
  const dismissals = useMemo(() => [...(doc?.dismissals ?? []), ...(extra?.dismissals ?? [])], [doc, extra]);
  const suggested = useMemo(
    () => (timeline ? suggestFinishes(timeline, { finishes, dismissals, takesTime }) : { suggestions: [], offers: {} }),
    [timeline, finishes, dismissals, takesTime],
  );
  const play = useCallback((from: number, to: number) => (doc ? playSpan(doc, from, to, read) : Promise.resolve(null)), [doc, read]);
  return useMemo(
    () => (doc && timeline ? { takes: doc.takes, timeline, suggested, finishes, dismissals, lagSeconds, read, play } : null),
    [doc, timeline, suggested, finishes, dismissals, lagSeconds, read, play],
  );
}

/**
 * The submitted rows, with what the scorer decided from the recording put
 * among them in the order they finished: a recorder's finish changed or
 * taken back, and suggestions the recorder left, accepted.
 */
function withDecisions(
  rows: readonly SubmittedFinish[],
  recorded: readonly VoiceFinish[],
  scorer: readonly VoiceFinish[],
  removed: ReadonlySet<string>,
  takesTime: (competitorId: string | null) => boolean,
): SubmittedFinish[] {
  if (scorer.length === 0 && removed.size === 0) return [...rows];
  const atOf = new Map(recorded.map((f) => [f.id, f.at]));
  const row = (f: VoiceFinish): SubmittedFinish => ({
    id: f.id,
    competitorId: f.competitorId,
    sailNumber: f.competitorId ? null : f.sailNumber,
    finishTime: takesTime(f.competitorId) ? clockTime(f.at) : null,
    elapsedSecs: null,
    resultCode: null,
  });
  const changed = new Map(scorer.map((f) => [f.id, f]));
  const placed: { row: SubmittedFinish; at: number | null }[] = [];
  const coded: SubmittedFinish[] = [];
  for (const r of rows) {
    if (removed.has(r.id)) continue;
    if (r.resultCode) coded.push(r);
    else {
      const f = changed.get(r.id);
      placed.push(f ? { row: { ...r, ...row(f) }, at: f.at } : { row: r, at: atOf.get(r.id) ?? null });
    }
  }
  for (const f of scorer) if (!rows.some((r) => r.id === f.id)) placed.push({ row: row(f), at: f.at });
  // Rows with a time from the recording are put in time order among the
  // places they hold; any without one keep theirs.
  const slots = placed.map((p, i) => (p.at === null ? -1 : i)).filter((i) => i >= 0);
  const timed = slots.map((i) => placed[i]).sort((a, b) => a.at! - b.at!);
  slots.forEach((slot, j) => {
    placed[slot] = timed[j];
  });
  return [...placed.map((p) => p.row), ...coded];
}

/**
 * The voice recording that came with a finish sheet submission, for the
 * review: a line above the table with the way into the timeline, ▶ on each
 * row taken from it, and what the scorer accepts from it added to what is
 * applied. Everything is null or empty where the submission wasn't
 * recorded by voice.
 */
export function useSubmissionVoice(
  submission: FinishSubmission,
  competitors: readonly Competitor[],
  takesTime: (competitorId: string | null) => boolean,
) {
  const { data } = useRaceRecordings(submission.raceId);
  const recording = data?.find((r) => r.submissionId === submission.id) ?? null;
  const [scorer, setScorer] = useState<{ finishes: VoiceFinish[]; dismissals: VoiceDismissal[]; removed: Set<string> }>(() => ({
    finishes: [],
    dismissals: [],
    removed: new Set(),
  }));
  const [open, setOpen] = useState(false);
  const source = useRecordingSource(recording, competitors, takesTime, scorer);
  const recorded = useMemo(() => recording?.document.finishes ?? [], [recording]);
  const finishes = useMemo(
    () => withDecisions(submission.finishes, recorded, scorer.finishes, scorer.removed, takesTime),
    [submission.finishes, recorded, scorer, takesTime],
  );

  const editing = useMemo<TimelineEditing>(() => {
    const finishOf = (s: Suggestion): VoiceFinish => ({
      id: crypto.randomUUID(),
      competitorId: s.competitorId,
      sailNumber: s.competitorId ? null : s.sailNumber,
      at: s.at,
      timeFrom: s.timeFrom,
      pressId: s.pressId,
      calledAt: s.calledAt,
      removed: false,
    });
    const add = (f: VoiceFinish) => setScorer((x) => ({ ...x, finishes: [...x.finishes.filter((y) => y.id !== f.id), f] }));
    return {
      accept: (s) => {
        if (s.competitorId || s.sailNumber) add(finishOf(s));
      },
      acceptAll: () => {
        const clear = source?.suggested.suggestions.filter((s) => !s.check && s.competitorId) ?? [];
        setScorer((x) => ({ ...x, finishes: [...x.finishes, ...clear.map(finishOf)] }));
      },
      save: (edit: FinishEdit) =>
        add({
          id: edit.finishId ?? crypto.randomUUID(),
          competitorId: edit.competitorId,
          sailNumber: edit.competitorId ? null : edit.sailNumber,
          at: edit.at,
          timeFrom: edit.timeFrom,
          pressId: edit.pressId,
          calledAt: edit.calledAt,
          removed: false,
        }),
      dismiss: (target: DismissTarget) => {
        if (target.finishId) {
          const id = target.finishId;
          setScorer((x) => ({ ...x, finishes: x.finishes.filter((f) => f.id !== id), removed: new Set([...x.removed, id]) }));
        } else if (target.dismissal) {
          const d = target.dismissal;
          setScorer((x) => ({ ...x, dismissals: [...x.dismissals, d] }));
        }
      },
      conflict: (competitorId, finishId) =>
        finishes.some((r) => r.competitorId === competitorId && !r.resultCode && r.id !== finishId)
          ? 'They already have a finish on this sheet. Change that one first.'
          : null,
    };
  }, [source, finishes]);

  const byId = useMemo(() => new Map(competitors.map((c) => [c.id, c])), [competitors]);
  const atOf = useMemo(() => {
    const out = new Map<string, number>();
    for (const f of source?.finishes ?? []) {
      if (f.removed) continue;
      if (f.competitorId) out.set(f.competitorId, f.at);
      else if (f.sailNumber) out.set(`?${f.sailNumber.toUpperCase()}`, f.at);
    }
    return out;
  }, [source]);

  return {
    recording,
    source,
    /** The rows to apply: the submission's, with the scorer's decisions. */
    finishes,
    /** How many finishes the scorer has added or changed from the recording. */
    decided: scorer.finishes.length + scorer.removed.size,
    editing,
    open,
    setOpen,
    /** ▶ for a row of the review, where it was recorded by voice. */
    cell(row: { competitorId: string | null; unknownSailNumber: string | null }, label: string) {
      if (!source) return null;
      const key = row.competitorId ?? `?${(row.unknownSailNumber ?? '').toUpperCase()}`;
      const sail = row.competitorId ? byId.get(row.competitorId)?.sailNumber : undefined;
      const at = atOf.get(key) ?? (sail ? atOf.get(`?${sail.toUpperCase()}`) : undefined);
      if (at === undefined) return null;
      return (
        <button
          type="button"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-foreground hover:bg-muted"
          aria-label={`Play the finish of ${label}`}
          title="Play the recording around this finish"
          data-testid="voice-call"
          onClick={() => void source.play(at - 4000, at + 2000)}
        >
          <Play className="h-3.5 w-3.5" />
        </button>
      );
    },
  };
}

/** The line above a review's table: this sheet was recorded by voice. */
export function VoiceReviewNote({ voice }: { voice: ReturnType<typeof useSubmissionVoice> }) {
  const { recording, source } = voice;
  if (!recording || !source) return null;
  const part = arrived(recording);
  const left = source.suggested.suggestions.length;
  return (
    <div className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm" data-testid="voice-review-note">
      <p className="flex items-center gap-2">
        <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          Recorded by voice. ▶ plays the recording around each finish.
          {part < 1 && ` The recording is still arriving (${Math.round(part * 100)}%).`}
        </span>
      </p>
      {left > 0 && (
        <p data-testid="voice-review-left">
          {left} suggested finish{left === 1 ? ' wasn’t' : 'es weren’t'} accepted on the water. Accept them from the recording to
          add them to what is applied.
        </p>
      )}
      {voice.decided > 0 && <p className="text-muted-foreground">{voice.decided} change{voice.decided === 1 ? '' : 's'} from the recording are in the table below.</p>}
      {recording.document.gaps.map((g) => (
        <p key={g.from} className="text-amber-700 dark:text-amber-400">
          Nothing was recorded from {clockTime(g.from)} to {clockTime(g.to)}.
        </p>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => voice.setOpen(true)} data-testid="voice-review-open">Open the recording</Button>
        <span className="text-muted-foreground">Kept until {day(recording.expiresAt)}, then deleted.</span>
      </div>
    </div>
  );
}

/**
 * The review's recording, opened: the timeline, where what the scorer
 * accepts is added to what is applied. Shown in place of the review dialog,
 * which would otherwise keep the focus and the pointer to itself.
 */
export function SubmissionTimeline({
  voice,
  competitors,
}: {
  voice: ReturnType<typeof useSubmissionVoice>;
  competitors: readonly Competitor[];
}) {
  const nameables = useMemo(() => nameablesOf(competitors), [competitors]);
  const name = useCallback((id: string) => nameables.find((c) => c.id === id), [nameables]);
  if (!voice.open || !voice.recording || !voice.source) return null;
  return (
    <TimelineView
      source={voice.source}
      editing={voice.editing}
      competitors={nameables}
      name={name}
      title={`Recording from ${voice.recording.recordedBy.name ?? 'the recorder'}`}
      subtitle="What you accept here is added to what is applied. Close to go back to the review."
      target={null}
      onClose={() => voice.setOpen(false)}
    />
  );
}

function RecordingRow({ recording, competitors }: { recording: RecordingInfo; competitors: readonly Competitor[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const takesTime = useCallback(() => true, []);
  const source = useRecordingSource(recording, competitors, takesTime, null);
  const nameables = useMemo(() => nameablesOf(competitors), [competitors]);
  const name = useCallback((id: string) => nameables.find((c) => c.id === id), [nameables]);
  const remove = useMutation({
    mutationFn: () => deleteRecording(recording.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: recordingsKey(recording.raceId) }),
  });
  const doc = recording.document;
  const finishes = doc.finishes.filter((f) => !f.removed).length;
  const names = (id: string) => {
    const c = name(id);
    return c ? `${c.sailNumber} ${c.name}`.trim() : undefined;
  };

  async function saveSound() {
    if (!source) return;
    setSaving(true);
    try {
      saveFile(`${fileStem(doc)}.wav`, await recordingWav(doc, source.read));
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="space-y-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="font-medium">{recording.recordedBy.name ?? 'A recorder'}</span>
          <span className="text-muted-foreground">
            {' '}· {finishes} finish{finishes === 1 ? '' : 'es'} · {formatRelativeTime(recording.createdAt)} · kept until {day(recording.expiresAt)}
          </span>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!source} data-testid="voice-recording-open">Open</Button>
          <Button size="sm" variant="outline" onClick={() => saveFile(`${fileStem(doc)}.json`, timelineFile(doc, names))}>Save the timeline</Button>
          <Button size="sm" variant="outline" onClick={() => void saveSound()} disabled={saving}>
            {saving ? 'Fetching the recording…' : 'Save the recording'}
          </Button>
          {confirming ? (
            <>
              <Button size="sm" variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>Delete the recording</Button>
              <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Keep it</Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>Delete…</Button>
          )}
        </span>
      </div>
      {confirming && <p>Delete this recording? The finish sheet keeps its finishes; the sound and the timeline go for good.</p>}
      {remove.isError && <p className="text-destructive">Couldn’t delete the recording. It is still here; try again.</p>}
      {open && source && (
        <TimelineView
          source={source}
          editing={null}
          competitors={nameables}
          name={name}
          title={`Recording from ${recording.recordedBy.name ?? 'the recorder'}`}
          subtitle={`Recorded ${formatRelativeTime(recording.createdAt)}. Kept until ${day(recording.expiresAt)}.`}
          target={null}
          onClose={() => setOpen(false)}
        />
      )}
    </li>
  );
}

/**
 * The race's voice recordings, beside its finish sheet: something to listen
 * to after the sheet is applied, to check a finish or answer a scoring
 * inquiry, for as long as each is kept. Renders nothing where there are none.
 */
export function RaceVoiceRecordings({ raceId, competitors }: { raceId: string; competitors: readonly Competitor[] }) {
  const { data } = useRaceRecordings(raceId);
  if (!data || data.length === 0) return null;
  return (
    <section className="space-y-2 rounded-lg border p-4" data-testid="voice-recordings">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Mic className="h-4 w-4 text-muted-foreground" />
        {data.length === 1 ? 'A recording of the finish' : `${data.length} recordings of the finish`}
      </h3>
      <ul className="space-y-3">
        {data.map((r) => (
          <RecordingRow key={r.id} recording={r} competitors={competitors} />
        ))}
      </ul>
    </section>
  );
}
