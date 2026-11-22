'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, ForbiddenApiError } from '@/lib/api-client';
import type { Finish } from '@/lib/types';
import type { CallEntry } from '@/lib/voice/calls';
import { deleteRecording, sendRecording } from '@/lib/voice/client/api';
import { download, getListener, isDownloaded, readManifest, type EngineManifest, type Listener } from '@/lib/voice/client/engine';
import {
  documentOf,
  forgetExpired,
  forgetRecording,
  newRecording,
  readSegment,
  recordingFor,
  saveRecording,
  type LocalRecording,
} from '@/lib/voice/client/local-store';
import type { Microphone } from '@/lib/voice/client/microphone';
import { fileStem, playSpan, recordingWav, saveFile, timelineFile } from '@/lib/voice/client/playback';
import { recogniseRecording, startRecorder, type Recorder } from '@/lib/voice/client/recorder';
import {
  atOfClockTime,
  clockTime,
  handChanges,
  placeFinish,
  removeRow,
  suggestionRowId,
  syncSuggestions,
  type RowSignature,
  type SheetContext,
} from '@/lib/voice/sheet';
import { readTimeline, suggestFinishes, type Suggestion } from '@/lib/voice/timeline';
import { DEFAULT_LAG_SECONDS, type VoiceDismissal, type VoiceFinish } from '@/lib/voice/types';

import type { DismissTarget, FinishEdit, TimelineTarget } from '@/lib/voice/timeline-rows';

/** Where the recogniser stands on this phone. */
export type EngineState =
  | { kind: 'checking' }
  /** This server has no recogniser to offer. */
  | { kind: 'unavailable' }
  | { kind: 'absent'; manifest: EngineManifest }
  | { kind: 'downloading'; manifest: EngineManifest; got: number }
  | { kind: 'ready'; manifest: EngineManifest }
  | { kind: 'failed'; manifest: EngineManifest; message: string };

/** How sending the recording to the scorer is going. */
export type SendState =
  | { kind: 'idle' }
  | { kind: 'sending'; sent: number; total: number }
  | { kind: 'sent'; expiresAt: number }
  /** No signal: it will go when there is one. */
  | { kind: 'waiting' }
  | { kind: 'refused'; message: string };

export interface VoiceRecordingArgs {
  /** The `voice-recording` feature is on for this workspace. */
  enabled: boolean;
  raceId: string;
  userId: string;
  /** The competitors in the race, under the sail numbers they sail in it. */
  entries: readonly CallEntry[];
  /** The sheet's rows, and the way to change them. */
  finishes: readonly Finish[];
  patch: (updater: (rows: Finish[]) => Finish[]) => void;
  /** Whether a competitor's finish needs a time (null: one not on the entry list). */
  takesTime: (competitorId: string | null) => boolean;
  /** The recorder's own submission for the race, once the sheet is sent. */
  submissionId: string | null;
}

export type VoiceRecording = ReturnType<typeof useVoiceRecording>;

/** The finish a suggestion becomes when it is accepted as it stands. */
function finishOf(s: Suggestion): VoiceFinish {
  return {
    id: crypto.randomUUID(),
    competitorId: s.competitorId,
    sailNumber: s.competitorId ? null : s.sailNumber,
    at: s.at,
    timeFrom: s.timeFrom,
    pressId: s.pressId,
    calledAt: s.calledAt,
    removed: false,
  };
}

/** What saying a suggestion isn't a finish says about its evidence. */
function dismissalOf(s: Suggestion): VoiceDismissal {
  return { pressId: s.pressId, spokenAt: s.timeFrom === 'spoken' ? s.at : null, calledAt: s.calledAt };
}

/**
 * A race's recording on this phone, and everything done with it: the
 * recogniser's download, a spell of recording, the timeline read from it,
 * accepting the finishes it suggests, keeping the sheet's rows in step,
 * playing it back, saving it, and sending it with the sheet. The Record
 * finishes page holds one of these and hands it to the voice components;
 * nothing here renders.
 */
export function useVoiceRecording(args: VoiceRecordingArgs) {
  const { enabled, raceId, userId, entries, finishes, patch, takesTime, submissionId } = args;
  const [recording, setRecording] = useState<LocalRecording | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [engine, setEngine] = useState<EngineState>({ kind: 'checking' });
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [online, setOnline] = useState(true);
  const [finding, setFinding] = useState<{ done: number; total: number } | null>(null);
  /** The timeline on screen, and where it opened. */
  const [view, setView] = useState<{ target: TimelineTarget | null } | null>(null);
  const [, setTick] = useState(0);

  // The timeline, read again whenever the recording changes.
  const lagSeconds = recording?.engine?.lagSeconds ?? DEFAULT_LAG_SECONDS;
  const timeline = useMemo(
    () => (recording ? readTimeline(recording, entries, { lagSeconds }) : null),
    [recording, entries, lagSeconds],
  );
  const suggested = useMemo(
    () =>
      timeline && recording
        ? suggestFinishes(timeline, { finishes: recording.finishes, dismissals: recording.dismissals, takesTime })
        : { suggestions: [], offers: {} },
    [timeline, recording, takesTime],
  );

  // What the callbacks read when they run.
  const latest = useRef({ finishes, takesTime, patch, recording, raceId, suggestions: suggested.suggestions });
  useEffect(() => {
    latest.current = { finishes, takesTime, patch, recording, raceId, suggestions: suggested.suggestions };
  });

  // The phone's copy, and what the server offers to recognise with.
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    void (async () => {
      try {
        await forgetExpired();
        const found = await recordingFor(raceId, userId);
        if (!gone) setRecording(found ?? null);
      } catch {
        // No storage on this phone: recording still works, for this visit.
      }
      if (!gone) setLoaded(true);
    })();
    void (async () => {
      const manifest = await readManifest();
      if (gone) return;
      if (!manifest) setEngine({ kind: 'unavailable' });
      else setEngine({ kind: (await isDownloaded(manifest)) ? 'ready' : 'absent', manifest });
    })();
    return () => {
      gone = true;
    };
  }, [enabled, raceId, userId]);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const downloadEngine = useCallback(async () => {
    if (engine.kind !== 'absent' && engine.kind !== 'failed') return;
    const { manifest } = engine;
    setEngine({ kind: 'downloading', manifest, got: 0 });
    try {
      await download(manifest, (got) => setEngine({ kind: 'downloading', manifest, got }));
      setEngine({ kind: 'ready', manifest });
    } catch (err) {
      setEngine({ kind: 'failed', manifest, message: err instanceof Error ? err.message : 'The download failed.' });
    }
  }, [engine]);

  /** Start the recogniser: quick once it is on the phone. */
  const startEngine = useCallback((): Promise<Listener> => {
    if (engine.kind !== 'ready') return Promise.reject(new Error('The recogniser isn’t on this phone yet.'));
    return getListener(engine.manifest);
  }, [engine]);

  /** Where each row from the recording finished, for the sheet's order. */
  const contextFor = useCallback((rec: LocalRecording | null, suggestions: readonly Suggestion[]): SheetContext => {
    const at = new Map<string, number>();
    for (const f of rec?.finishes ?? []) if (!f.removed) at.set(f.id, f.at);
    for (const s of suggestions) at.set(suggestionRowId(s.key), s.at);
    return {
      raceId: latest.current.raceId,
      takesTime: (competitorId) => latest.current.takesTime(competitorId),
      crossedAt: (rowId) => at.get(rowId),
    };
  }, []);

  // The recorder running now, if one is: what a person decides while it
  // records goes into its copy of the recording too.
  const recorderRef = useRef<Recorder | null>(null);
  useEffect(() => {
    recorderRef.current = recorder;
  }, [recorder]);

  /** Keep a change to the recording, on the screen and on the phone. */
  const keep = useCallback((next: LocalRecording) => {
    latest.current.recording = next;
    recorderRef.current?.setDecisions(next.finishes, next.dismissals);
    setRecording(next);
    void saveRecording(next).catch(() => undefined);
  }, []);

  // The sheet in step with the recording. What a person did by hand to a
  // suggested row comes first: changing it accepts it as changed, deleting
  // it says it is not a finish. Then an accepted finish whose row was
  // deleted is a finish no more, and one whose row the sheet has lost (a
  // draft that didn't survive) is put back. Then the suggested rows follow
  // the suggestions.
  const written = useRef<Map<string, RowSignature>>(new Map());
  const rowIdsBefore = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!enabled || !loaded) return;
    const rec = recording;
    const ids = new Set(finishes.map((r) => r.id));
    const before = rowIdsBefore.current;
    rowIdsBefore.current = ids;
    if (!rec) return;
    const pending = new Map(suggested.suggestions.map((s) => [s.key, s]));

    const byHand = handChanges(finishes, written.current);
    const deleted = byHand.deleted.filter((key) => pending.has(key));
    const changed = byHand.changed.filter((c) => pending.has(c.key));
    let next = rec;
    const renames: { from: string; to: string }[] = [];
    for (const key of deleted) {
      next = { ...next, dismissals: [...next.dismissals, dismissalOf(pending.get(key)!)] };
      written.current.delete(suggestionRowId(key));
    }
    for (const { key, row } of changed) {
      const s = pending.get(key)!;
      const timeChanged = row.finishTime != null && row.finishTime !== clockTime(s.at);
      const at = timeChanged ? (atOfClockTime(row.finishTime!, s.at) ?? s.at) : s.at;
      const finish: VoiceFinish = {
        ...finishOf(s),
        competitorId: row.competitorId,
        sailNumber: row.competitorId ? null : (row.unknownSailNumber && row.unknownSailNumber !== '?' ? row.unknownSailNumber : null),
        at,
        timeFrom: timeChanged ? 'hand' : s.timeFrom,
      };
      next = { ...next, finishes: [...next.finishes, finish] };
      renames.push({ from: suggestionRowId(key), to: finish.id });
      written.current.delete(suggestionRowId(key));
    }
    let lost: VoiceFinish[] = [];
    for (const f of next.finishes) {
      if (f.removed || ids.has(f.id) || renames.some((r) => r.to === f.id)) continue;
      if (before?.has(f.id)) next = { ...next, finishes: next.finishes.map((x) => (x.id === f.id ? { ...x, removed: true } : x)) };
      else lost = [...lost, f];
    }
    // The sheet is another component's state, and reaches this hook only as
    // new rows: what a person did to it is taken into the recording here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next !== rec) keep(next);
    if (renames.length > 0) {
      patch((rows) => rows.map((r) => {
        const rename = renames.find((x) => x.from === r.id);
        return rename ? { ...r, id: rename.to } : r;
      }));
      return;
    }
    if (lost.length > 0) {
      const ctx = contextFor(next, suggested.suggestions);
      const placed = lost.reduce<Finish[]>((rows, f) => placeFinish(rows, f, ctx), [...finishes]);
      if (placed.some((r, i) => r !== finishes[i]) || placed.length !== finishes.length) patch(() => placed);
      return;
    }
    if (next !== rec) return;
    const ctx = contextFor(rec, suggested.suggestions);
    const { rows: synced, written: w } = syncSuggestions(finishes, suggested.suggestions, ctx);
    written.current = w;
    if (synced !== finishes) patch(() => [...synced]);
  }, [enabled, loaded, recording, finishes, suggested, keep, contextFor, patch]);

  /** Record, with a microphone already open, and the recogniser where it is
   *  on the phone. Without it, the sound and the NOWs are recorded alone. */
  const record = useCallback(
    (microphone: Microphone, listener: Listener | null, onLevel?: (level: number) => void) => {
      const started = startRecorder({
        recording: latest.current.recording ?? newRecording(raceId, userId),
        entries,
        microphone,
        listener,
        engine: listener && engine.kind === 'ready' ? { model: engine.manifest.model, version: engine.manifest.version } : null,
        onChange: () => {
          setRecording(started.recording());
          // What it is hearing can change while the recording doesn't.
          setTick((n) => n + 1);
        },
        onLevel,
      });
      setRecording(started.recording());
      setRecorder(started);
    },
    [engine, entries, raceId, userId],
  );

  // Leaving the page stops recording: the microphone is let go, and what
  // was recorded is kept.
  useEffect(() => {
    // Whichever recorder is running when the page goes, not the one (none)
    // there was when it came.
    const running = recorderRef;
    return () => void running.current?.stop();
  }, []);

  const stop = useCallback(async () => {
    if (!recorder) return;
    const finished = await recorder.stop();
    setRecorder(null);
    latest.current.recording = finished;
    setRecording(finished);
  }, [recorder]);

  /** Add finishes to the recording and to the sheet, each in place of the
   *  suggestion it came from where it came from one. */
  const commit = useCallback(
    (added: { finish: VoiceFinish; replacing: string | null }[]) => {
      const rec = recorder?.recording() ?? latest.current.recording;
      if (!rec || added.length === 0) return;
      const ids = new Set(added.map((a) => a.finish.id));
      const next = { ...rec, finishes: [...rec.finishes.filter((f) => !ids.has(f.id)), ...added.map((a) => a.finish)] };
      keep(next);
      const ctx = contextFor(next, latest.current.suggestions);
      latest.current.patch((rows) =>
        added.reduce<Finish[]>((r, a) => placeFinish(r, a.finish, ctx, a.replacing ? suggestionRowId(a.replacing) : undefined), rows),
      );
    },
    [recorder, keep, contextFor],
  );

  /** Accept a suggestion as it stands. One with nobody named can't be. */
  const accept = useCallback(
    (s: Suggestion) => {
      if (!s.competitorId && !s.sailNumber) return;
      commit([{ finish: finishOf(s), replacing: s.key }]);
    },
    [commit],
  );

  /** Accept every clear suggestion: a recognised competitor with one NOW. */
  const acceptAll = useCallback(() => {
    const clear = latest.current.suggestions.filter((s) => !s.check && s.competitorId);
    commit(clear.map((s) => ({ finish: finishOf(s), replacing: s.key })));
  }, [commit]);

  /** Save a finish from the editor: a new one, a changed one, or a
   *  suggestion accepted as changed. */
  const save = useCallback(
    (edit: FinishEdit) => {
      const rec = recorder?.recording() ?? latest.current.recording;
      const was = edit.finishId ? rec?.finishes.find((f) => f.id === edit.finishId) : undefined;
      const finish: VoiceFinish = {
        id: was?.id ?? crypto.randomUUID(),
        competitorId: edit.competitorId,
        sailNumber: edit.competitorId ? null : edit.sailNumber,
        at: edit.at,
        timeFrom: edit.timeFrom,
        pressId: edit.pressId,
        calledAt: edit.calledAt,
        removed: false,
      };
      commit([{ finish, replacing: edit.suggestionKey }]);
    },
    [recorder, commit],
  );

  /** Not a finish: a finish taken back, or evidence that isn't one. */
  const dismiss = useCallback(
    (target: DismissTarget) => {
      const rec = recorder?.recording() ?? latest.current.recording;
      if (!rec) return;
      let next = rec;
      if (target.finishId) {
        next = { ...next, finishes: next.finishes.map((f) => (f.id === target.finishId ? { ...f, removed: true } : f)) };
        latest.current.patch((rows) => removeRow(rows, target.finishId!));
      } else if (target.dismissal) {
        next = { ...next, dismissals: [...next.dismissals, target.dismissal] };
      }
      keep(next);
    },
    [recorder, keep],
  );

  const read = useCallback((take: number, index: number) => {
    const id = latest.current.recording?.id;
    return id ? readSegment(id, take, index) : Promise.resolve(undefined);
  }, []);

  /** Play the recording from `from` to `to`. Null where there is no sound. */
  const play = useCallback(
    (from: number, to: number) => {
      const rec = latest.current.recording;
      return rec ? playSpan(rec, from, to, read) : Promise.resolve(null);
    },
    [read],
  );

  /** Find the sail numbers in a recording made without the recogniser. */
  const findWords = useCallback(async () => {
    const rec = latest.current.recording;
    if (!rec || engine.kind !== 'ready') return;
    setFinding({ done: 0, total: 1 });
    try {
      const listener = await getListener(engine.manifest);
      const next = await recogniseRecording(rec, listener, { model: engine.manifest.model, version: engine.manifest.version }, (done, total) =>
        setFinding({ done, total }),
      );
      // Decisions made meanwhile stand.
      const now = latest.current.recording ?? next;
      keep({ ...now, words: next.words, engine: next.engine, cost: next.cost, span: next.span });
    } finally {
      setFinding(null);
    }
  }, [engine, keep]);

  const saveSound = useCallback(async () => {
    const rec = latest.current.recording;
    if (rec) saveFile(`${fileStem(rec)}.wav`, await recordingWav(rec, read));
  }, [read]);

  const saveTimeline = useCallback((names: (competitorId: string) => string | undefined) => {
    const rec = latest.current.recording;
    if (rec) saveFile(`${fileStem(rec)}.json`, timelineFile(documentOf(rec), names));
  }, []);

  /** Whether the recording goes to the scorer with the sheet. Switching it
   *  off takes back a copy already sent. */
  const setSending = useCallback(
    (on: boolean) => {
      const rec = latest.current.recording;
      if (!rec) return;
      keep({ ...rec, send: on });
      if (!on) {
        setSend({ kind: 'idle' });
        void deleteRecording(rec.id).catch(() => undefined);
      }
    },
    [keep],
  );

  /** Delete the recording: from the phone, and the scorer's copy with it.
   *  The finishes it made stay on the sheet. */
  const forget = useCallback(async () => {
    const rec = latest.current.recording;
    if (!rec) return;
    await forgetRecording(rec.id).catch(() => undefined);
    void deleteRecording(rec.id).catch(() => undefined);
    latest.current.recording = null;
    setRecording(null);
    setSend({ kind: 'idle' });
    setView(null);
  }, []);

  // Send the recording with the sheet: once the sheet has been submitted,
  // and again whenever the recording has changed since. With no signal it
  // waits for one.
  const sentRef = useRef<LocalRecording | null>(null);
  const listening = recorder !== null;
  useEffect(() => {
    if (!enabled || !submissionId || !recording || !recording.send || listening) return;
    if (recording.takes.length === 0 || sentRef.current === recording) return;
    let gone = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = async () => {
      if (gone) return;
      if (!navigator.onLine) {
        setSend({ kind: 'waiting' });
        return;
      }
      try {
        setSend((s) => (s.kind === 'sending' ? s : { kind: 'sending', sent: 0, total: 0 }));
        const info = await sendRecording(recording, submissionId, (sent, total) => {
          if (!gone) setSend({ kind: 'sending', sent, total });
        });
        if (gone) return;
        sentRef.current = recording;
        setSend({ kind: 'sent', expiresAt: info.expiresAt });
      } catch (err) {
        if (gone) return;
        // The server said no: trying again won't change its mind.
        if (err instanceof ApiError && err.status < 500) {
          sentRef.current = recording;
          const deleted = err instanceof ForbiddenApiError && err.reason === 'recording-deleted';
          setSend({ kind: 'refused', message: deleted ? 'a scorer deleted it' : err.message });
        } else {
          setSend({ kind: 'waiting' });
          retry = setTimeout(attempt, 30_000);
        }
      }
    };
    // A moment's grace, so accepting three finishes in a row is one upload.
    const start = setTimeout(attempt, 1500);
    return () => {
      gone = true;
      clearTimeout(start);
      clearTimeout(retry);
    };
  }, [enabled, submissionId, recording, listening, online]);

  const finishById = useMemo(() => new Map((recording?.finishes ?? []).map((f) => [f.id, f])), [recording]);
  const suggestionByRow = useMemo(
    () => new Map(suggested.suggestions.map((s) => [suggestionRowId(s.key), s])),
    [suggested],
  );

  return {
    enabled,
    /** The phone's copy has been looked for. */
    loaded,
    recording,
    timeline,
    suggested,
    lagSeconds,
    finishById,
    suggestionByRow,
    engine,
    downloadEngine,
    startEngine,
    recorder,
    record,
    stop,
    accept,
    acceptAll,
    save,
    dismiss,
    play,
    read,
    finding,
    findWords,
    saveSound,
    saveTimeline,
    send,
    setSending,
    forget,
    view,
    openTimeline: (target: TimelineTarget | null = null) => setView({ target }),
    closeTimeline: () => setView(null),
  };
}
