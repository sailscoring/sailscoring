'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mic, Play } from 'lucide-react';

import { useFeatures } from '@/components/features-provider';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatRelativeTime } from '@/lib/relative-time';
import type { Competitor, FinishSubmission } from '@/lib/types';
import { deleteRecording, fetchSegment, listRaceRecordings, type RecordingInfo } from '@/lib/voice/client/api';
import { callsFile, fileStem, playLine, recordingWav, saveFile, type ReadPiece } from '@/lib/voice/client/playback';
import { clockTime } from '@/lib/voice/sheet';
import { SEGMENT_SAMPLES, type VoiceLine } from '@/lib/voice/types';

/**
 * A race's voice recordings, as the scorer meets them (ADR-017): in the
 * review of a finish sheet submission, where each line plays the call it
 * came from, and beside the race afterwards, for as long as a recording is
 * kept. Whoever made a recording and anyone who can score can hear it.
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
 *  fetched: playing a line twice fetches it once. */
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

/** What the app wasn't sure of on a line, and nobody has confirmed since. */
function doubts(line: VoiceLine): string[] {
  const heard = line.words.join(' ');
  const out: string[] = [];
  if (line.how === 'sounds' && !line.boatSettled) out.push(`sounded like · heard “${heard}”`);
  if (line.how === 'ambiguous') out.push(line.boatSettled ? `chosen from ${line.couldBe.length} boats` : `fits ${line.couldBe.length} boats · heard “${heard}”`);
  if (line.how === 'unknown') out.push(`heard “${heard}”`);
  if (line.how === 'tap' && line.competitorId === null) out.push('Now was pressed, and no boat was called');
  if (line.how !== 'tap' && line.timeFrom === 'called' && !line.timeSettled) out.push('no “now” heard: the time is when she was called');
  return out;
}

function PlayButton({ recording, line, read, label }: { recording: RecordingInfo; line: VoiceLine; read: ReadPiece; label: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'silent'>('idle');
  return (
    <button
      type="button"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-foreground hover:bg-muted disabled:opacity-40"
      aria-label={`Play the call for ${label}`}
      title={state === 'silent' ? 'The recording’s sound for this line hasn’t arrived' : 'Play the call'}
      disabled={state === 'loading'}
      onClick={() => {
        setState('loading');
        playLine(recording.document, line, read).then(
          (played) => setState(played ? 'idle' : 'silent'),
          () => setState('silent'),
        );
      }}
    >
      <Play className="h-3.5 w-3.5" />
    </button>
  );
}

/**
 * The voice recording that came with a finish sheet submission, for the
 * review: a line above the table, and for each row the call it came from.
 * Everything is null or empty where the submission wasn't taken by voice.
 */
export function useSubmissionVoice(submission: FinishSubmission, competitors: readonly Competitor[]) {
  const { data } = useRaceRecordings(submission.raceId);
  const recording = data?.find((r) => r.submissionId === submission.id) ?? null;
  const read = useSound(recording?.id);
  const lineByKey = useMemo(() => {
    const out = new Map<string, VoiceLine>();
    if (!recording) return out;
    const lines = new Map(recording.document.lines.filter((l) => !l.removed).map((l) => [l.id, l]));
    for (const f of submission.finishes) {
      const line = lines.get(f.id);
      if (!line) continue;
      if (f.competitorId) out.set(f.competitorId, line);
      else if (f.sailNumber) out.set(`?${f.sailNumber.toUpperCase()}`, line);
    }
    return out;
  }, [recording, submission.finishes]);
  const sailNumbers = useMemo(() => new Map(competitors.map((c) => [c.id, c.sailNumber])), [competitors]);

  /** The call behind a row of the review, where it was taken by voice. A
   *  number the review has since matched to an entry is found by that number. */
  const lineFor = (row: { competitorId: string | null; unknownSailNumber: string | null }): VoiceLine | undefined => {
    if (row.competitorId) {
      return lineByKey.get(row.competitorId) ?? lineByKey.get(`?${(sailNumbers.get(row.competitorId) ?? '').toUpperCase()}`);
    }
    return lineByKey.get(`?${(row.unknownSailNumber ?? '').toUpperCase()}`);
  };

  return {
    recording,
    /** A cell for the row: ▶, and what the app wasn't sure of. */
    cell(row: { competitorId: string | null; unknownSailNumber: string | null }, label: string) {
      if (!recording) return null;
      const line = lineFor(row);
      if (!line) return null;
      const notes = doubts(line);
      return (
        <span className="flex items-center gap-2" data-testid="voice-call">
          {line.heardAt !== null && <PlayButton recording={recording} line={line} read={read} label={label} />}
          {notes.length > 0 && <span className="text-xs text-amber-700 dark:text-amber-400">{notes.join(' · ')}</span>}
        </span>
      );
    },
  };
}

/** The line above a review's table: this sheet was taken by voice. */
export function VoiceReviewNote({ recording }: { recording: RecordingInfo }) {
  const part = arrived(recording);
  const { gaps } = recording.document;
  return (
    <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm" data-testid="voice-review-note">
      <p className="flex items-center gap-2">
        <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span>
          Taken by voice. ▶ plays the call each line came from.
          {part < 1 && ` The recording is still arriving (${Math.round(part * 100)}%).`}
        </span>
      </p>
      {gaps.map((g) => (
        <p key={g.from} className="text-amber-700 dark:text-amber-400">
          The phone wasn’t listening from {clockTime(g.from)} to {clockTime(g.to)}: boats called then were not heard.
        </p>
      ))}
      <p className="text-muted-foreground">The recording is kept until {day(recording.expiresAt)}, then deleted.</p>
    </div>
  );
}

function RecordingDialog({
  recording,
  competitors,
  onClose,
}: {
  recording: RecordingInfo;
  competitors: readonly Competitor[];
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const read = useSound(recording.id);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const byId = useMemo(() => new Map(competitors.map((c) => [c.id, c])), [competitors]);
  const remove = useMutation({
    mutationFn: () => deleteRecording(recording.id),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: recordingsKey(recording.raceId) });
      onClose();
    },
  });
  const doc = recording.document;
  const lines = doc.lines.filter((l) => !l.removed).sort((a, b) => a.at - b.at);
  const name = (competitorId: string) => {
    const c = byId.get(competitorId);
    return c ? [c.sailNumber, c.boatName].filter(Boolean).join(' ') : undefined;
  };

  async function saveSound() {
    setSaving(true);
    try {
      saveFile(`${fileStem(doc)}.wav`, await recordingWav(doc, read));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-xl sm:max-w-xl" data-testid="voice-recording-dialog">
        <DialogHeader>
          <DialogTitle>Recording from {recording.recordedBy.name ?? 'the recorder'}</DialogTitle>
          <DialogDescription>
            Finishes taken by voice, {formatRelativeTime(recording.createdAt)}. Kept until {day(recording.expiresAt)}, then deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {doc.gaps.map((g) => (
            <p key={g.from} className="text-sm text-amber-700 dark:text-amber-400">
              The phone wasn’t listening from {clockTime(g.from)} to {clockTime(g.to)}.
            </p>
          ))}
          <ul className="divide-y text-sm">
            {lines.map((line) => {
              const label = line.competitorId ? (name(line.competitorId) ?? '?') : line.digits || '?';
              const notes = doubts(line);
              return (
                <li key={line.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  {line.heardAt !== null ? <PlayButton recording={recording} line={line} read={read} label={label} /> : <span className="w-8" />}
                  <span className="w-20 shrink-0 font-mono text-muted-foreground">{clockTime(line.at)}</span>
                  <span className="min-w-0 flex-1 basis-32 font-medium">{label}</span>
                  {notes.length > 0 && <span className="basis-full pl-11 text-xs text-amber-700 dark:text-amber-400">{notes.join(' · ')}</span>}
                </li>
              );
            })}
          </ul>
          {lines.length === 0 && <p className="text-sm text-muted-foreground">No boats were taken down.</p>}
          {confirming && (
            <p className="text-sm">
              Delete this recording? The finish sheet keeps its lines; the sound and the list of calls go for good.
            </p>
          )}
          {remove.isError && <p className="text-sm text-destructive">Couldn’t delete the recording. It is still here; try again.</p>}
        </DialogBody>
        <DialogFooter className="gap-2">
          {confirming ? (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)}>Keep it</Button>
              <Button variant="destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>Delete the recording</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setConfirming(true)}>Delete…</Button>
              <Button variant="outline" onClick={() => saveFile(`${fileStem(doc)}.json`, callsFile(doc, name))}>Save the list of calls</Button>
              <Button variant="outline" onClick={() => void saveSound()} disabled={saving}>
                {saving ? 'Fetching the recording…' : 'Save the recording'}
              </Button>
              <Button onClick={onClose}>Close</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The race's voice recordings, beside its finish sheet: something to listen
 * to after the sheet is applied, for as long as each is kept. Renders
 * nothing where there are none.
 */
export function RaceVoiceRecordings({ raceId, competitors }: { raceId: string; competitors: readonly Competitor[] }) {
  const { data } = useRaceRecordings(raceId);
  const [open, setOpen] = useState<string | null>(null);
  if (!data || data.length === 0) return null;
  const opened = data.find((r) => r.id === open);
  return (
    <section className="space-y-2 rounded-lg border p-4" data-testid="voice-recordings">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Mic className="h-4 w-4 text-muted-foreground" />
        {data.length === 1 ? 'A recording of the finish' : `${data.length} recordings of the finish`}
      </h3>
      <ul className="space-y-2">
        {data.map((r) => {
          const calls = r.document.lines.filter((l) => !l.removed).length;
          return (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="min-w-0">
                <span className="font-medium">{r.recordedBy.name ?? 'A recorder'}</span>
                <span className="text-muted-foreground">
                  {' '}· {calls} line{calls === 1 ? '' : 's'} · {formatRelativeTime(r.createdAt)} · kept until {day(r.expiresAt)}
                </span>
              </span>
              <Button size="sm" variant="outline" onClick={() => setOpen(r.id)}>Listen</Button>
            </li>
          );
        })}
      </ul>
      {opened && <RecordingDialog recording={opened} competitors={competitors} onClose={() => setOpen(null)} />}
    </section>
  );
}
