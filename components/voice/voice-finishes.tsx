'use client';

import { useRef, useState } from 'react';
import { Mic, Play } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import type { Finish } from '@/lib/types';
import type { CallEntry } from '@/lib/voice/calls';
import type { Listener } from '@/lib/voice/client/engine';
import { phoneKeepsUntil } from '@/lib/voice/client/local-store';
import { microphoneProblem, openMicrophone, rememberedMicrophone, type Microphone } from '@/lib/voice/client/microphone';
import { clockTime, lineLabel, lineTime, linesToSettle, marksOf } from '@/lib/voice/sheet';
import { SERVER_KEEPS_DAYS, type VoiceLine, type VoiceMark } from '@/lib/voice/types';

import { ListeningBar, ListeningScreen, type BoatLabel } from './listening-screen';
import { VoiceSetupDialog } from './setup-dialog';
import type { VoiceRecording } from './use-voice-recording';

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

/** ▶: play the call a line came from. */
export function PlayCall({ voice, line, label }: { voice: VoiceRecording; line: VoiceLine; label: string }) {
  const [silent, setSilent] = useState(false);
  return (
    <button
      type="button"
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-foreground hover:bg-muted disabled:opacity-40"
      aria-label={`Play the call for ${label}`}
      title={silent ? 'The recording has no sound for this line' : 'Play the call'}
      disabled={silent}
      onClick={() => void voice.play(line).then((played) => setSilent(!played))}
    >
      <Play className="h-4 w-4" />
    </button>
  );
}

/**
 * What the finishing order shows on a row that was taken by voice: ▶ to
 * hear the call, and a mark while the app's reading of it hasn't been
 * confirmed. For the finish sheet's `rowExtra`.
 */
export function VoiceRowMark({
  voice,
  finish,
  takesTime,
}: {
  voice: VoiceRecording;
  finish: Finish;
  takesTime: (competitorId: string | null) => boolean;
}) {
  const line = voice.lineById.get(finish.id);
  if (!line || line.removed) return null;
  const marks = marksOf(line, finish, takesTime);
  return (
    <span className="flex shrink-0 items-center gap-1.5" data-testid={`voice-row-${finish.id}`}>
      {marks.includes('check') && <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">check</Badge>}
      {marks.includes('time') && <Badge variant="outline" className="border-amber-400 text-amber-700 dark:text-amber-400">called</Badge>}
      {line.heardAt !== null && voice.recording && <PlayCall voice={voice} line={line} label={finish.unknownSailNumber ?? 'this boat'} />}
    </span>
  );
}

const WHY: Record<VoiceMark, (heard: string) => string> = {
  check: (heard) => `sounded like · heard “${heard}”`,
  choose: (heard) => (heard ? `heard “${heard}”` : 'more than one boat it could be'),
  unknown: (heard) => `heard “${heard}”, a number on no entry`,
  'no-boat': () => 'Now was pressed, and no boat was called',
  time: () => 'no “now” was heard: the time is when she was called',
};

/**
 * Finishes by voice on the Record finishes page: the line that starts it,
 * the listening screen, and afterwards what is left to do. Everything it
 * takes down lands in the page's own finishing order; this only shows where
 * the lines came from and what the app wasn't sure of.
 */
export function VoiceFinishes({
  voice,
  entries,
  finishes,
  boat,
  takesTime,
  reveal,
}: {
  voice: VoiceRecording;
  /** The boats in the race, under the numbers they sail in it. */
  entries: readonly CallEntry[];
  finishes: readonly Finish[];
  boat: (competitorId: string) => BoatLabel | undefined;
  takesTime: (competitorId: string | null) => boolean;
  /** Bring a row of the finishing order into view, to change it there. */
  reveal: (finish: Finish) => void;
}) {
  const [settingUp, setSettingUp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [behindSheet, setBehindSheet] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const level = useRef<HTMLSpanElement | null>(null);
  const { engine, recorder, recording } = voice;

  if (!voice.enabled) return null;

  const begin = (microphone: Microphone, listener: Listener) => {
    setSettingUp(false);
    setBehindSheet(false);
    setProblem(null);
    voice.listen(microphone, listener, (loudness) => {
      if (level.current) level.current.style.width = `${Math.round(loudness * 100)}%`;
    });
  };

  /** Listen straight away: the engine is on the phone already. */
  async function listenNow() {
    setStarting(true);
    setProblem(null);
    let microphone: Microphone | null = null;
    try {
      // The microphone first: a phone's browser only opens it from the tap.
      microphone = await openMicrophone(rememberedMicrophone());
      begin(microphone, await voice.startEngine());
    } catch (err) {
      microphone?.close();
      setProblem(
        microphone
          ? `The listening engine didn’t start (${err instanceof Error ? err.message : 'no reason given'}). Reload the page, then try again.`
          : microphoneProblem(err),
      );
    } finally {
      setStarting(false);
    }
  }

  const lines = recording?.lines ?? [];
  const live = lines.filter((l) => !l.removed);
  const rowById = new Map(finishes.map((r) => [r.id, r]));
  const boats = live.filter((l) => rowById.get(l.id)?.competitorId).length;
  const open = linesToSettle(lines, finishes, takesTime);
  const gaps = recording?.gaps ?? [];
  const names = (competitorId: string) => {
    const b = boat(competitorId);
    return b ? `${b.sailNumber} ${b.name}`.trim() : undefined;
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="voice-finishes">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 basis-40 text-sm font-medium">Take finishes by voice</h3>
        {engine.kind === 'ready' && (
          <Button size="sm" onClick={() => void listenNow()} disabled={starting || recorder !== null} data-testid="voice-listen">
            {starting ? 'Getting ready…' : live.length > 0 ? 'Listen again' : 'Listen'}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setSettingUp(true)} disabled={recorder !== null} data-testid="voice-set-up">
          Set up
        </Button>
      </div>
      {engine.kind === 'unavailable' && (
        <p className="text-sm text-muted-foreground">The listening engine isn’t available on this server.</p>
      )}
      {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}

      {recording && live.length > 0 && !recorder && (
        <div className="space-y-3" data-testid="voice-taken">
          <p className="text-sm">
            Taken by voice: {boats} boat{boats === 1 ? '' : 's'} · {open.length} line{open.length === 1 ? '' : 's'} to check
          </p>
          {gaps.length > 0 && (
            <ul className="space-y-0.5 text-sm text-amber-700 dark:text-amber-400" data-testid="voice-gaps">
              {gaps.map((g) => (
                <li key={g.from}>
                  Not listening from {clockTime(g.from)} to {clockTime(g.to)}: check those boats against the paper sheet.
                </li>
              ))}
            </ul>
          )}
          {open.length > 0 && (
            <ul className="space-y-2" data-testid="voice-to-settle">
              {open.map(({ line, row, marks }) => {
                const label = lineLabel(line, row, boat);
                const heard = line.words.join(' ');
                return (
                  <li key={line.id} className="space-y-2 rounded-md border bg-card p-3" data-testid={`voice-settle-${line.id}`}>
                    <div className="flex items-start gap-3">
                      {line.heardAt !== null && <PlayCall voice={voice} line={line} label={label.number} />}
                      <div className="min-w-0 flex-1 text-sm">
                        <p>
                          <span className="font-mono font-medium">{label.number}</span> {label.who}
                        </p>
                        <p className="text-muted-foreground">
                          {takesTime(row.competitorId) ? `${lineTime(line)} · ` : ''}
                          {marks.map((m) => WHY[m](heard)).join(' · ')}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {marks.includes('check') && (
                        <Button size="sm" onClick={() => voice.settle(line, 'boat')}>Yes, {label.number}</Button>
                      )}
                      {marks.includes('choose') &&
                        line.couldBe.map((id) => (
                          <Button key={id} size="sm" onClick={() => voice.choose(line, id)}>
                            {boat(id)?.sailNumber ?? '?'}
                          </Button>
                        ))}
                      {marks.includes('time') && (
                        <Button size="sm" onClick={() => voice.settle(line, 'time')}>Keep {clockTime(line.at)}</Button>
                      )}
                      {marks.includes('no-boat') && (
                        <Button size="sm" variant="outline" onClick={() => voice.remove(line)}>Remove</Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => reveal(row)}>Change</Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="space-y-2 border-t pt-3 text-sm">
            <p className="text-muted-foreground">
              The recording is on this phone until {day(phoneKeepsUntil(recording))}, then it is removed.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void voice.saveSound()}>Save the recording</Button>
              <Button size="sm" variant="outline" onClick={() => voice.saveCalls(names)}>Save the list of calls</Button>
              {confirmingDelete ? (
                <>
                  <Button size="sm" variant="destructive" onClick={() => { setConfirmingDelete(false); void voice.forget(); }}>
                    Delete it
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)}>Keep it</Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmingDelete(true)}>Delete the recording</Button>
              )}
            </div>
            {confirmingDelete && (
              <p className="text-muted-foreground">
                The lines stay on the sheet. The recording goes from this phone, and the scorer’s copy with it.
              </p>
            )}
            <label className="flex items-start gap-2">
              <Switch
                className="mt-0.5"
                checked={recording.send}
                onCheckedChange={voice.setSending}
                aria-label="Send the recording to the scorer with the sheet"
              />
              <span>
                Send the recording to the scorer with the sheet
                <span className="block text-muted-foreground">
                  Scorers can play each call. It is deleted {SERVER_KEEPS_DAYS} days after it is sent, or when you
                  withdraw the sheet.
                </span>
              </span>
            </label>
            {recording.send && (
              <p className="text-muted-foreground" role="status" data-testid="voice-send-status">
                {voice.send.kind === 'idle' && 'It goes when you submit the sheet.'}
                {voice.send.kind === 'sending' &&
                  (voice.send.total > 0
                    ? `Sending the recording: ${Math.round((100 * voice.send.sent) / voice.send.total)}%`
                    : 'Sending the recording…')}
                {voice.send.kind === 'sent' && `The scorer has the recording, until ${day(voice.send.expiresAt)}.`}
                {voice.send.kind === 'waiting' && 'No signal: the recording goes when there is one. Keep this page open.'}
                {voice.send.kind === 'refused' && `The recording couldn’t be sent (${voice.send.message}). It is still on this phone.`}
              </p>
            )}
          </div>
        </div>
      )}

      {settingUp && (
        <VoiceSetupDialog voice={voice} entries={entries} boat={boat} onListen={begin} onClose={() => setSettingUp(false)} />
      )}
      {recorder && !behindSheet && (
        <ListeningScreen
          recorder={recorder}
          lines={lines}
          finishes={finishes}
          boat={boat}
          takesTime={takesTime}
          level={level}
          onStop={() => void voice.stop()}
          onShowSheet={() => setBehindSheet(true)}
        />
      )}
      {recorder && behindSheet && (
        <ListeningBar recorder={recorder} lines={lines} boat={boat} onBack={() => setBehindSheet(false)} />
      )}
    </section>
  );
}
