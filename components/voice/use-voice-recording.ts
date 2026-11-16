'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError } from '@/lib/api-client';
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
import { callsFile, fileStem, playLine, recordingWav, saveFile } from '@/lib/voice/client/playback';
import { startRecorder, type Recorder } from '@/lib/voice/client/recorder';
import type { SessionEvent } from '@/lib/voice/session';
import { placeLine, removeLine, type SheetContext } from '@/lib/voice/sheet';
import type { VoiceLine } from '@/lib/voice/types';

/** Where the listening engine stands on this phone. */
export type EngineState =
  | { kind: 'checking' }
  /** This server has no engine to offer. */
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
  /** The boats in the race, under the numbers they sail in it. */
  entries: readonly CallEntry[];
  /** The sheet's rows, and the way to change them. */
  finishes: readonly Finish[];
  patch: (updater: (rows: Finish[]) => Finish[]) => void;
  /** Whether a boat's row carries a time of day (null: an unknown boat). */
  takesTime: (competitorId: string | null) => boolean;
  /** The recorder's own submission for the race, once the sheet is sent. */
  submissionId: string | null;
}

export type VoiceRecording = ReturnType<typeof useVoiceRecording>;

/**
 * A race's voice recording on this phone, and everything done with it: the
 * engine's download, a spell of listening, settling the lines it wasn't sure
 * of, playing calls back, saving it, and sending it with the sheet. The
 * Record finishes page holds one of these and hands it to the voice
 * components; nothing here renders.
 */
export function useVoiceRecording(args: VoiceRecordingArgs) {
  const { enabled, raceId, userId, entries, finishes, patch, takesTime, submissionId } = args;
  const [recording, setRecording] = useState<LocalRecording | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [engine, setEngine] = useState<EngineState>({ kind: 'checking' });
  const [recorder, setRecorder] = useState<Recorder | null>(null);
  const [send, setSend] = useState<SendState>({ kind: 'idle' });
  const [online, setOnline] = useState(true);
  const [, setTick] = useState(0);

  // What the session's events are applied with, read when they arrive.
  const latest = useRef({ finishes, takesTime, patch, recording, raceId });
  useEffect(() => {
    latest.current = { finishes, takesTime, patch, recording, raceId };
  });

  // The phone's copy, and what the server offers to listen with.
  useEffect(() => {
    if (!enabled) return;
    let gone = false;
    void (async () => {
      try {
        await forgetExpired();
        const found = await recordingFor(raceId, userId);
        if (!gone) setRecording(found ?? null);
      } catch {
        // No storage on this phone: listening still works, for this visit.
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
    update();
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
      setEngine({
        kind: 'failed',
        manifest,
        message: err instanceof Error ? err.message : 'The download failed.',
      });
    }
  }, [engine]);

  /** Start the engine: quick once it is on the phone. */
  const startEngine = useCallback((): Promise<Listener> => {
    if (engine.kind !== 'ready') return Promise.reject(new Error('The listening engine isn’t on this phone yet.'));
    return getListener(engine.manifest);
  }, [engine]);

  const sheetContext = useCallback((lines: readonly VoiceLine[]): SheetContext => {
    const at = new Map(lines.filter((l) => !l.removed).map((l) => [l.id, l.at]));
    return {
      raceId: latest.current.raceId,
      takesTime: (competitorId) => latest.current.takesTime(competitorId),
      crossedAt: (rowId) => at.get(rowId),
    };
  }, []);

  /** Keep a change to the recording, on the screen and on the phone. */
  const keep = useCallback((next: LocalRecording) => {
    setRecording(next);
    void saveRecording(next).catch(() => undefined);
  }, []);

  /** Listen, with a microphone already open and the engine already started. */
  const listen = useCallback(
    (microphone: Microphone, listener: Listener, onLevel?: (level: number) => void) => {
      if (engine.kind !== 'ready') return;
      const started = startRecorder({
        recording: latest.current.recording ?? newRecording(raceId, userId),
        entries,
        onSheet: (competitorId) =>
          latest.current.finishes.some((r) => r.competitorId === competitorId && r.sortOrder !== null),
        microphone,
        listener,
        engine: { model: engine.manifest.model, version: engine.manifest.version },
        onEvent: (event: SessionEvent) => {
          if (event.type === 'again') return;
          const lines = started.recording().lines;
          const line = event.line;
          latest.current.patch((rows) =>
            event.type === 'removed' ? removeLine(rows, line.id) : placeLine(rows, line, sheetContext(lines)),
          );
        },
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
    [engine, entries, raceId, userId, sheetContext],
  );

  const stop = useCallback(async () => {
    if (!recorder) return;
    const finished = await recorder.stop();
    setRecorder(null);
    setRecording(finished);
  }, [recorder]);

  const changeLine = useCallback(
    (lineId: string, change: Partial<VoiceLine>) => {
      const current = latest.current.recording;
      if (!current) return null;
      const lines = current.lines.map((l) => (l.id === lineId ? { ...l, ...change } : l));
      keep({ ...current, lines });
      return lines;
    },
    [keep],
  );

  /** A person has listened: the boat is right, or the time stands. */
  const settle = useCallback(
    (line: VoiceLine, what: 'boat' | 'time') => {
      changeLine(line.id, what === 'boat' ? { boatSettled: true } : { timeSettled: true });
    },
    [changeLine],
  );

  /** A call that fitted several boats was this one. */
  const choose = useCallback(
    (line: VoiceLine, competitorId: string) => {
      const lines = changeLine(line.id, { competitorId, boatSettled: true });
      if (!lines) return;
      const chosen = lines.find((l) => l.id === line.id)!;
      latest.current.patch((rows) => placeLine(rows, chosen, sheetContext(lines)));
    },
    [changeLine, sheetContext],
  );

  /** Take a line off the sheet after the event: a press nobody named. */
  const remove = useCallback(
    (line: VoiceLine) => {
      changeLine(line.id, { removed: true });
      latest.current.patch((rows) => removeLine(rows, line.id));
    },
    [changeLine],
  );

  const read = useCallback(
    (take: number, index: number) => {
      const id = latest.current.recording?.id;
      return id ? readSegment(id, take, index) : Promise.resolve(undefined);
    },
    [],
  );

  /** Play the call a line came from. False where there is no sound for it. */
  const play = useCallback(
    (line: VoiceLine) => {
      const current = latest.current.recording;
      return current ? playLine(current, line, read) : Promise.resolve(false);
    },
    [read],
  );

  const saveSound = useCallback(async () => {
    const current = latest.current.recording;
    if (current) saveFile(`${fileStem(current)}.wav`, await recordingWav(current, read));
  }, [read]);

  const saveCalls = useCallback(
    (names: (competitorId: string) => string | undefined) => {
      const current = latest.current.recording;
      if (current) saveFile(`${fileStem(current)}.json`, callsFile(documentOf(current), names));
    },
    [],
  );

  /** Whether the recording goes to the scorer with the sheet. Switching it
   *  off takes back a copy already sent. */
  const setSending = useCallback(
    (on: boolean) => {
      const current = latest.current.recording;
      if (!current) return;
      keep({ ...current, send: on });
      if (!on) {
        setSend({ kind: 'idle' });
        void deleteRecording(current.id).catch(() => undefined);
      }
    },
    [keep],
  );

  /** Delete the recording: from the phone, and the scorer's copy with it.
   *  The lines it made stay on the sheet. */
  const forget = useCallback(async () => {
    const current = latest.current.recording;
    if (!current) return;
    await forgetRecording(current.id).catch(() => undefined);
    void deleteRecording(current.id).catch(() => undefined);
    setRecording(null);
    setSend({ kind: 'idle' });
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
          setSend({ kind: 'refused', message: err.message });
        } else {
          setSend({ kind: 'waiting' });
          retry = setTimeout(attempt, 30_000);
        }
      }
    };
    let retry: ReturnType<typeof setTimeout> | undefined;
    // A moment's grace, so settling three lines in a row is one upload.
    const start = setTimeout(attempt, 1500);
    return () => {
      gone = true;
      clearTimeout(start);
      clearTimeout(retry);
    };
  }, [enabled, submissionId, recording, listening, online]);

  const lineById = useMemo(() => new Map((recording?.lines ?? []).map((l) => [l.id, l])), [recording]);

  return {
    enabled,
    /** The phone's copy has been looked for. */
    loaded,
    recording,
    lineById,
    engine,
    downloadEngine,
    startEngine,
    recorder,
    listen,
    stop,
    settle,
    choose,
    remove,
    play,
    saveSound,
    saveCalls,
    send,
    setSending,
    forget,
  };
}
