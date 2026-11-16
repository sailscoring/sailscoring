/**
 * The phone's microphone for recording finishes by voice: opening the one
 * the recorder chose, handing its sound over at 16 kHz, and the sounds that
 * tell the caller what happened. Browser only.
 */

import { level, resampler } from '../audio';
import type { Cue } from '../session';
import { SAMPLE_RATE } from '../types';

export interface MicrophoneChoice {
  deviceId: string;
  label: string;
}

/** The microphones the browser will name. Their names are blank until the
 *  page has been given the microphone once. */
export async function listMicrophones(): Promise<MicrophoneChoice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId)
      .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
  } catch {
    return [];
  }
}

const CHOICE_KEY = 'sailscoring-voice-microphone';

/** The microphone picked last time on this phone. */
export function rememberedMicrophone(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY);
  } catch {
    return null;
  }
}

export function rememberMicrophone(deviceId: string | null): void {
  try {
    if (deviceId) localStorage.setItem(CHOICE_KEY, deviceId);
    else localStorage.removeItem(CHOICE_KEY);
  } catch {
    // Private browsing: the choice lasts for this page.
  }
}

export interface Microphone {
  label: string;
  deviceId: string | null;
  /** Sound as it arrives, at 16 kHz, with the phone's clock at arrival and
   *  how loud it was (0 to 1). Set by whoever is listening. */
  onAudio: ((samples: Float32Array, wall: number, loudness: number) => void) | null;
  /** The microphone stopped, or came back: a call, another app. */
  onRunning: ((running: boolean) => void) | null;
  /** Whether sound is flowing. */
  running(): boolean;
  /** Ask for the sound to flow again, after the page was away. */
  resume(): Promise<void>;
  cue(cue: Cue): void;
  close(): void;
}

/** Why the microphone couldn't be opened, in words for the recorder. */
export function microphoneProblem(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'This page isn’t allowed to use the microphone. Allow it in the browser’s settings for this site, then try again.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect the headset, then try again.';
  if (name === 'NotReadableError') return 'The microphone is in use by something else. Close it, then try again.';
  return 'The microphone couldn’t be opened. Try again.';
}

const TONES: Record<Cue, [number, number][]> = {
  ok: [[880, 0.09]],
  check: [[880, 0.09], [520, 0.12]],
  doubt: [[330, 0.12], [330, 0.12]],
  mark: [[1320, 0.04]],
};

function play(ctx: AudioContext, cue: Cue): void {
  if (ctx.state !== 'running') return;
  let t = ctx.currentTime + 0.01;
  for (const [frequency, seconds] of TONES[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
    t += seconds + 0.05;
  }
}

/**
 * Open a microphone: the one asked for, or the browser's choice. Must be
 * called from a tap, which is what lets a phone's browser start sound.
 */
export async function openMicrophone(deviceId: string | null): Promise<Microphone> {
  const audio: MediaTrackConstraints = {
    channelCount: 1,
    echoCancellation: false,
    noiseSuppression: true,
    autoGainControl: true,
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
  };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio });
  } catch (err) {
    // The remembered microphone has gone: a headset left at home.
    if (!deviceId || !(err instanceof DOMException) || err.name !== 'OverconstrainedError') throw err;
    stream = await navigator.mediaDevices.getUserMedia({ audio: { ...audio, deviceId: undefined } });
  }
  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' });
  } catch {
    ctx = new AudioContext();
  }
  await ctx.resume();
  await ctx.audioWorklet.addModule('/voice/tap-worklet.js');
  const node = new AudioWorkletNode(ctx, 'tap');
  // The tap has to lead somewhere for the browser to run it; a silent
  // destination keeps the microphone out of the headset's earpiece.
  const quiet = ctx.createGain();
  quiet.gain.value = 0;
  node.connect(quiet).connect(ctx.destination);
  let source = ctx.createMediaStreamSource(stream);
  source.connect(node);

  let track: MediaStreamTrack | undefined = stream.getAudioTracks()[0];
  const down = resampler(ctx.sampleRate);
  let closed = false;
  let reopening = false;
  const report = () => microphone.onRunning?.(microphone.running());
  const watch = (t: MediaStreamTrack | undefined) => {
    if (!t) return;
    t.onmute = report;
    t.onunmute = report;
    t.onended = report;
  };
  const microphone: Microphone = {
    label: track?.label ?? '',
    deviceId: track?.getSettings().deviceId ?? deviceId,
    onAudio: null,
    onRunning: null,
    running: () => !closed && ctx.state === 'running' && track?.readyState === 'live' && !track.muted,
    async resume() {
      if (closed) return;
      if (ctx.state !== 'running') await ctx.resume().catch(() => undefined);
      // A phone call, or the phone locking, can end the capture outright:
      // open the same microphone again and carry on.
      if (track?.readyState !== 'ended' || reopening) return;
      reopening = true;
      try {
        const again = await navigator.mediaDevices.getUserMedia({
          audio: { ...audio, ...(microphone.deviceId ? { deviceId: { exact: microphone.deviceId } } : {}) },
        });
        if (closed) {
          again.getTracks().forEach((t) => t.stop());
          return;
        }
        source.disconnect();
        stream = again;
        source = ctx.createMediaStreamSource(again);
        source.connect(node);
        track = again.getAudioTracks()[0];
        watch(track);
      } catch {
        // Still not ours to open: the screen says it isn't listening.
      } finally {
        reopening = false;
        report();
      }
    },
    cue: (cue) => play(ctx, cue),
    close() {
      closed = true;
      node.port.onmessage = null;
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
  node.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (closed) return;
    const samples = down(e.data);
    if (samples.length) microphone.onAudio?.(samples, Date.now(), level(samples));
  };
  ctx.onstatechange = report;
  watch(track);
  return microphone;
}
