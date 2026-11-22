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
import type { TimelineCall } from '@/lib/voice/timeline';

import type { NameOf } from './timeline-view';
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
 * Getting ready to record finishes by voice, done ashore while there is a
 * signal: the recogniser's one download, the microphone, the entry list,
 * and a trial call that is the microphone check and the calling lesson in
 * one. Record hands the open microphone and the running recogniser straight
 * on, so the caller's first tap is also the only one. Without the
 * recogniser, Record still records the sound and the NOWs.
 */
export function VoiceSetupDialog({
  voice,
  entries,
  name,
  onRecord,
  onClose,
}: {
  voice: VoiceRecording;
  entries: readonly CallEntry[];
  name: NameOf;
  onRecord: (microphone: Microphone, listener: Listener | null) => void;
  onClose: () => void;
}) {
  const { engine } = voice;
  const [microphone, setMicrophone] = useState<Microphone | null>(null);
  const [choices, setChoices] = useState<MicrophoneChoice[]>([]);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [listener, setListener] = useState<Listener | null>(null);
  const [heard, setHeard] = useState<{ words: string; call: TimelineCall | null } | null>(null);
  const level = useRef<HTMLSpanElement | null>(null);
  // Whatever is open when the dialog goes, unless Record took it on.
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
        if (!gone) setProblem(err instanceof Error ? `The recogniser didn’t start (${err.message}). Record still records the sound; reload the page to try again.` : 'The recogniser didn’t start.');
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

  function record() {
    if (!microphone) return;
    held.current.trial?.stop();
    held.current.trial = null;
    held.current.handedOn = true;
    onRecord(microphone, listener);
  }

  const heardCompetitor = heard?.call?.competitorId ? name(heard.call.competitorId) : undefined;
  const size = 'manifest' in engine ? megabytes(engine.manifest.bytes) : 0;

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="w-[95vw] max-w-md sm:max-w-md" data-testid="voice-setup">
        <DialogHeader>
          <DialogTitle>Record finishes by voice</DialogTitle>
          <DialogDescription>
            Set up while you have a signal. Once it is recording, it needs none.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ol className="space-y-4 text-sm">
            <Step done={engineReady} title="Recognising sail numbers on this phone">
              {engine.kind === 'checking' && <p className="text-muted-foreground">Checking…</p>}
              {engine.kind === 'unavailable' && (
                <p className="text-muted-foreground">
                  The recogniser isn’t available on this server. Record still records the sound and the NOWs.
                </p>
              )}
              {engine.kind === 'absent' && (
                <>
                  <p className="text-muted-foreground">
                    Downloaded once ({size} MB). Sail numbers are recognised on the phone; no sound is sent anywhere to be
                    recognised. Without it, the sound and the NOWs are still recorded, and the sail numbers can be found later.
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
                <p className="text-muted-foreground">Downloaded. Sail numbers are recognised on the phone; no sound is sent anywhere to be recognised.</p>
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

            <Step done={entries.length > 0} title={`Entry list: ${entries.length} competitor${entries.length === 1 ? '' : 's'} in this race`}>
              {entries.length === 0 && (
                <p className="text-muted-foreground">With no entry list, every sail number is shown as not on the entry list.</p>
              )}
            </Step>

            <Step done={heard?.call != null} title="Try it: call out any competitor’s sail number">
              {!microphone || !engineReady ? (
                <p className="text-muted-foreground">Once the microphone is on.</p>
              ) : !listener ? (
                <p className="text-muted-foreground" role="status">Getting the recogniser ready…</p>
              ) : heard ? (
                <div data-testid="voice-trial-heard">
                  <p className="text-muted-foreground">Heard “{heard.words}”</p>
                  {heardCompetitor ? (
                    <p className="font-medium">
                      <span className="font-mono">{heardCompetitor.sailNumber}</span> {heardCompetitor.name}
                      {heard.call?.how === 'sounds' && <span className="font-normal text-muted-foreground"> (a close match)</span>}
                    </p>
                  ) : (
                    <p>{heard.call?.how === 'ambiguous' ? 'It could be more than one competitor.' : 'Not on the entry list.'}</p>
                  )}
                </div>
              ) : (
                <p className="text-muted-foreground">
                  Call out a sail number as you would read it off the sail: “sixteen thirteen”, “one six one three”.
                </p>
              )}
            </Step>
          </ol>

          <div className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
            <p className="font-medium">Calling finishers</p>
            <p>
              Call out each sail number, then “now” as they finish, or press NOW. Leave a pause between competitors. Everything
              said near the phone is recorded, and the recording goes to the scorer with the finish sheet.
            </p>
            <p className="text-muted-foreground">
              One tone: a sail number was recognised. Two low tones: a sail number not on the entry list. A click: a time was
              marked.
            </p>
          </div>

          <p className="mt-4 text-sm">
            This phone’s time is <PhoneClock />. It should agree with the committee boat’s clock.
          </p>
          {problem && <p className="mt-3 text-sm text-destructive" role="alert">{problem}</p>}
        </DialogBody>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Not now</Button>
          <Button onClick={record} disabled={!microphone || (engineReady && !listener && !problem)} data-testid="voice-setup-record">Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
