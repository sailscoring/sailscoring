'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Circle } from 'lucide-react';

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
import type { CallEntry } from '@/lib/voice/calls';
import { megabytes, type Listener } from '@/lib/voice/client/engine';
import {
  listMicrophones,
  microphoneProblem,
  openMicrophone,
  rememberMicrophone,
  rememberedMicrophone,
  type Microphone,
  type MicrophoneChoice,
} from '@/lib/voice/client/microphone';
import { startTrial, type Trial } from '@/lib/voice/client/recorder';
import { clockTime } from '@/lib/voice/sheet';
import type { VoiceLine } from '@/lib/voice/types';

import type { BoatLabel } from './listening-screen';
import type { VoiceRecording } from './use-voice-recording';

function Step({ done, title, children }: { done: boolean; title: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      {done ? (
        <Check className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-label="Done" />
      ) : (
        <Circle className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-label="Not yet" />
      )}
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}

function PhoneClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(tick);
  }, []);
  return <span className="font-mono tabular-nums">{clockTime(now)}</span>;
}

/**
 * Getting ready to take finishes by voice, done ashore while there is a
 * signal: the engine's one download, the microphone, the entry list, and a
 * trial call that is the microphone check and the calling lesson in one.
 * Listen hands the open microphone and the running engine straight on, so
 * the caller's first tap is also the only one.
 */
export function VoiceSetupDialog({
  voice,
  entries,
  boat,
  onListen,
  onClose,
}: {
  voice: VoiceRecording;
  entries: readonly CallEntry[];
  boat: (competitorId: string) => BoatLabel | undefined;
  onListen: (microphone: Microphone, listener: Listener) => void;
  onClose: () => void;
}) {
  const { engine } = voice;
  const [microphone, setMicrophone] = useState<Microphone | null>(null);
  const [choices, setChoices] = useState<MicrophoneChoice[]>([]);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [listener, setListener] = useState<Listener | null>(null);
  const [heard, setHeard] = useState<{ words: string; line: VoiceLine | null } | null>(null);
  const level = useRef<HTMLSpanElement | null>(null);
  // Whatever is open when the dialog goes, unless Listen took it on.
  const held = useRef<{ microphone: Microphone | null; trial: Trial | null; handedOn: boolean }>({
    microphone: null,
    trial: null,
    handedOn: false,
  });
  useEffect(() => {
    const h = held.current;
    return () => {
      h.trial?.stop();
      if (!h.handedOn) h.microphone?.close();
    };
  }, []);

  const showLevel = (loudness: number) => {
    if (level.current) level.current.style.width = `${Math.round(loudness * 100)}%`;
  };

  async function turnOn(deviceId: string | null) {
    setOpening(true);
    setProblem(null);
    held.current.trial?.stop();
    held.current.trial = null;
    held.current.microphone?.close();
    try {
      const opened = await openMicrophone(deviceId);
      opened.onAudio = (_samples, _wall, loudness) => showLevel(loudness);
      held.current.microphone = opened;
      setMicrophone(opened);
      setChoices(await listMicrophones());
    } catch (err) {
      held.current.microphone = null;
      setMicrophone(null);
      setProblem(microphoneProblem(err));
    } finally {
      setOpening(false);
    }
  }

  // The engine starts as soon as it is on the phone: by the time the
  // microphone is on, it is usually ready for the trial call.
  const engineReady = engine.kind === 'ready';
  const { startEngine } = voice;
  useEffect(() => {
    if (!engineReady) return;
    let gone = false;
    startEngine().then(
      (started) => {
        if (!gone) setListener(started);
      },
      (err: unknown) => {
        if (!gone) setProblem(err instanceof Error ? `The listening engine didn’t start (${err.message}). Reload the page, then try again.` : 'The listening engine didn’t start.');
      },
    );
    return () => {
      gone = true;
    };
  }, [engineReady, startEngine]);

  // The trial call: with both in hand, say what is heard.
  useEffect(() => {
    if (!microphone || !listener) return;
    const h = held.current;
    const trial = startTrial({ entries, microphone, listener, onHeard: setHeard, onLevel: showLevel });
    h.trial = trial;
    return () => {
      trial.stop();
      if (h.trial === trial) h.trial = null;
    };
  }, [microphone, listener, entries]);

  function listen() {
    if (!microphone || !listener) return;
    held.current.trial?.stop();
    held.current.trial = null;
    held.current.handedOn = true;
    onListen(microphone, listener);
  }

  const heardBoat = heard?.line?.competitorId ? boat(heard.line.competitorId) : undefined;
  const size = 'manifest' in engine ? megabytes(engine.manifest.bytes) : 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-md sm:max-w-md" data-testid="voice-setup">
        <DialogHeader>
          <DialogTitle>Take finishes by voice</DialogTitle>
          <DialogDescription>
            Set up while you have a signal. Once it is listening, it needs none.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ol className="space-y-4 text-sm">
            <Step done={engineReady} title="Listening on this phone">
              {engine.kind === 'checking' && <p className="text-muted-foreground">Checking…</p>}
              {engine.kind === 'unavailable' && (
                <p className="text-destructive">The listening engine isn’t available on this server.</p>
              )}
              {engine.kind === 'absent' && (
                <>
                  <p className="text-muted-foreground">
                    Downloaded once ({size} MB). Nothing you say leaves the phone to be recognised.
                  </p>
                  <Button size="sm" onClick={() => void voice.downloadEngine()}>Download ({size} MB)</Button>
                </>
              )}
              {engine.kind === 'downloading' && (
                <p className="text-muted-foreground" role="status">
                  Downloading: {megabytes(engine.got)} of {size} MB
                </p>
              )}
              {engine.kind === 'failed' && (
                <>
                  <p className="text-destructive">Couldn’t download it ({engine.message}). Check the signal, then try again.</p>
                  <Button size="sm" variant="outline" onClick={() => void voice.downloadEngine()}>Try again</Button>
                </>
              )}
              {engineReady && (
                <p className="text-muted-foreground">Downloaded. Nothing you say leaves the phone to be recognised.</p>
              )}
            </Step>

            <Step done={microphone !== null} title={microphone ? `Microphone: ${microphone.label || 'on'}` : 'Microphone'}>
              {microphone ? (
                <>
                  <span className="block h-2 w-40 max-w-full overflow-hidden rounded bg-muted" aria-hidden>
                    <span ref={level} className="block h-full w-0 bg-emerald-600" />
                  </span>
                  {choices.length > 1 && (
                    <label className="block space-y-1">
                      <span className="text-muted-foreground">Use another</span>
                      <select
                        className="block w-full rounded-md border border-input bg-background px-2 py-1.5"
                        aria-label="Microphone"
                        value={microphone.deviceId ?? ''}
                        disabled={opening}
                        onChange={(e) => {
                          rememberMicrophone(e.target.value);
                          void turnOn(e.target.value);
                        }}
                      >
                        {choices.map((c) => (
                          <option key={c.deviceId} value={c.deviceId}>{c.label}</option>
                        ))}
                      </select>
                    </label>
                  )}
                </>
              ) : (
                <>
                  <p className="text-muted-foreground">Connect the headset first, if you are using one.</p>
                  <Button size="sm" onClick={() => void turnOn(rememberedMicrophone())} disabled={opening}>
                    {opening ? 'Turning on…' : 'Turn on the microphone'}
                  </Button>
                </>
              )}
            </Step>

            <Step done={entries.length > 0} title={`Entry list: ${entries.length} boat${entries.length === 1 ? '' : 's'} in this race`}>
              {entries.length === 0 && (
                <p className="text-muted-foreground">With no entries, every number called goes down as an unknown boat.</p>
              )}
            </Step>

            <Step done={heard?.line != null} title="Try it: call any boat’s number">
              {!microphone || !engineReady ? (
                <p className="text-muted-foreground">Once the microphone is on.</p>
              ) : !listener ? (
                <p className="text-muted-foreground" role="status">Getting ready to listen…</p>
              ) : heard ? (
                <div data-testid="voice-trial-heard">
                  <p className="text-muted-foreground">Heard “{heard.words}”</p>
                  {heardBoat ? (
                    <p className="font-medium">
                      <span className="font-mono">{heardBoat.sailNumber}</span> {heardBoat.name}
                    </p>
                  ) : (
                    <p>{heard.line?.how === 'ambiguous' ? 'More than one boat it could be.' : 'No boat in this race.'}</p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Say her number as you would read it off the sail: “sixteen thirteen”, “one six one three”.
                </p>
              )}
            </Step>
          </ol>

          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Calling finishers</p>
            <p>Say her number, then “now” as she crosses, and leave a breath between boats.</p>
            <p className="text-muted-foreground">
              One tone: she’s down. Two low tones: look when you can. Or press Now as she crosses.
            </p>
          </div>

          <p className="mt-4 text-sm">
            This phone’s time is <PhoneClock />. It should agree with the committee boat’s clock.
          </p>
          {problem && <p className="mt-3 text-sm text-destructive" role="alert">{problem}</p>}
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Not now</Button>
          <Button onClick={listen} disabled={!microphone || !listener} data-testid="voice-setup-listen">Listen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
