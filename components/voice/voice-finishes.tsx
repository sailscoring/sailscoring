'use client';

import { useMemo, useRef, useState } from 'react';
import { AudioLines, Mic } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { Finish } from '@/lib/types';
import type { CallEntry } from '@/lib/voice/calls';
import type { Listener } from '@/lib/voice/client/engine';
import { megabytes } from '@/lib/voice/client/engine';
import { phoneKeepsUntil } from '@/lib/voice/client/local-store';
import { microphoneProblem, openMicrophone, rememberedMicrophone, type Microphone } from '@/lib/voice/client/microphone';
import { clockTime, isSuggestionRow } from '@/lib/voice/sheet';
import { checkText, type Suggestion } from '@/lib/voice/timeline';
import type { Nameable } from '@/lib/voice/timeline-rows';
import { SERVER_KEEPS_DAYS_AFTER_LAST_RACE } from '@/lib/voice/types';

import { RecordingScreen } from './recording-screen';
import { VoiceSetupDialog } from './setup-dialog';
import { TimelineView, type NameOf, type TimelineEditing, type TimelineSource } from './timeline-view';
import type { VoiceRecording } from './use-voice-recording';

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
/** The day a recording is deleted on the server. It goes at the start of
 *  that day, UTC, and may be next year. */
const deletedOn = (at: number) =>
  new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** A suggestion's reason to check, short enough for a row of the sheet. */
function shortWhy(s: Suggestion): string {
  const c = s.check;
  if (!c) return '';
  switch (c.why) {
    case 'close-match':
      return 'close match';
    case 'not-on-list':
      return 'not on the entry list';
    case 'could-be':
      return `could be ${s.couldBe.length}`;
    case 'no-sail-number':
      return 'no sail number';
    case 'counts':
      return `${c.numbers} sail number${c.numbers === 1 ? '' : 's'}, ${c.nows} NOW${c.nows === 1 ? '' : 's'}`;
    case 'called-time':
      return 'time from the call';
  }
}

/** The timeline the voice components show, and what may be done with it. */
export function useVoiceTimeline(voice: VoiceRecording, finishes: readonly Finish[]) {
  const { recording, timeline, suggested, lagSeconds, read, play, accept, acceptAll, save, dismiss } = voice;
  const source = useMemo<TimelineSource | null>(
    () =>
      recording && timeline
        ? {
            takes: recording.takes,
            timeline,
            suggested,
            finishes: recording.finishes,
            dismissals: recording.dismissals,
            lagSeconds,
            read,
            play,
          }
        : null,
    [recording, timeline, suggested, lagSeconds, read, play],
  );
  const editing = useMemo<TimelineEditing>(
    () => ({
      accept,
      acceptAll,
      save,
      dismiss,
      conflict(competitorId, finishId) {
        const theirs = finishes.find((r) => r.competitorId === competitorId && r.sortOrder !== null && r.id !== finishId && !isSuggestionRow(r));
        return theirs ? `They already have a finish on the sheet${theirs.finishTime ? ` at ${theirs.finishTime}` : ''}. Change that one first.` : null;
      },
    }),
    [accept, acceptAll, save, dismiss, finishes],
  );
  return { source, editing };
}

/**
 * What the sheet shows on a row from the recording: on a suggestion, that
 * it is one, why it is to check, and Accept where it is clear; on an
 * accepted finish, the way to it on the timeline. For the finish sheet's
 * `rowExtra`.
 */
export function VoiceRowMark({ voice, finish, name }: { voice: VoiceRecording; finish: Finish; name: NameOf }) {
  const suggestion = voice.suggestionByRow.get(finish.id);
  const accepted = voice.finishById.get(finish.id);
  const open = (target: Parameters<VoiceRecording['openTimeline']>[0]) => voice.openTimeline(target);
  const show = (
    <button
      type="button"
      className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-foreground hover:bg-muted"
      title="Show in the timeline"
      aria-label="Show in the timeline"
      onClick={() => open(suggestion ? { kind: 'suggestion', key: suggestion.key } : { kind: 'finish', finishId: finish.id })}
    >
      <AudioLines className="h-4 w-4" />
    </button>
  );
  if (suggestion) {
    const named = (id: string) => {
      const c = name(id);
      return c ? `${c.sailNumber} ${c.name}`.trim() : '?';
    };
    return (
      <span className="flex shrink-0 items-center gap-1.5" data-testid={`voice-row-${finish.id}`}>
        {suggestion.check ? (
          <span
            className="rounded-full bg-amber-50 px-2 text-xs font-medium leading-5 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            title={checkText(suggestion, named)}
            data-testid="voice-row-check"
          >
            {shortWhy(suggestion)}
          </span>
        ) : (
          <>
            <span className="rounded-full border border-dashed border-muted-foreground px-2 text-xs leading-5 text-muted-foreground">suggested</span>
            {suggestion.competitorId && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => voice.accept(suggestion)} data-testid="voice-row-accept">
                Accept
              </Button>
            )}
          </>
        )}
        {show}
      </span>
    );
  }
  if (accepted && !accepted.removed) return <span className="flex shrink-0 items-center" data-testid={`voice-row-${finish.id}`}>{show}</span>;
  return null;
}

/**
 * Finishes by voice on the Record finishes page: Record, the recording
 * screen, and afterwards what is left to do, with the way into the
 * timeline. Everything accepted lands in the page's own finishing order;
 * suggestions sit there too, marked, until someone accepts them.
 */
export function VoiceFinishes({
  voice,
  entries,
  finishes,
  competitors,
  name,
}: {
  voice: VoiceRecording;
  /** The competitors a call can name, under the sail numbers they sail in this race. */
  entries: readonly CallEntry[];
  finishes: readonly Finish[];
  competitors: readonly Nameable[];
  name: NameOf;
}) {
  const [settingUp, setSettingUp] = useState(false);
  const [starting, setStarting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const level = useRef<HTMLSpanElement | null>(null);
  const { engine, recorder, recording, suggested } = voice;
  const { source, editing } = useVoiceTimeline(voice, finishes);

  if (!voice.enabled) return null;

  const showLevel = (loudness: number) => {
    if (level.current) level.current.style.width = `${Math.round(loudness * 100)}%`;
  };
  const begin = (microphone: Microphone, listener: Listener | null) => {
    setSettingUp(false);
    setProblem(null);
    voice.record(microphone, listener, showLevel);
  };

  /** Record straight away, with the recogniser if it is on the phone. */
  async function recordNow() {
    setStarting(true);
    setProblem(null);
    let microphone: Microphone | null = null;
    try {
      // The microphone first: a phone's browser only opens it from the tap.
      microphone = await openMicrophone(rememberedMicrophone());
      let listener: Listener | null = null;
      if (engine.kind === 'ready') {
        try {
          listener = await voice.startEngine();
        } catch {
          // Record anyway: the sail numbers can be found afterwards.
          listener = null;
        }
      }
      begin(microphone, listener);
    } catch (err) {
      microphone?.close();
      setProblem(microphoneProblem(err));
    } finally {
      setStarting(false);
    }
  }

  const accepted = (recording?.finishes ?? []).filter((f) => !f.removed).length;
  const clear = suggested.suggestions.filter((s) => !s.check && s.competitorId);
  const toCheck = suggested.suggestions.filter((s) => s.check);
  const hasSound = (recording?.takes.length ?? 0) > 0;
  const noWords = hasSound && (recording?.words.length ?? 0) === 0;
  const size = 'manifest' in engine ? megabytes(engine.manifest.bytes) : 0;
  const names = (competitorId: string) => {
    const c = name(competitorId);
    return c ? `${c.sailNumber} ${c.name}`.trim() : undefined;
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" data-testid="voice-finishes">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Mic className="h-4 w-4 shrink-0 text-muted-foreground" />
        <h3 className="min-w-0 flex-1 basis-40 text-sm font-medium">Record finishes by voice</h3>
        <Button size="sm" onClick={() => void recordNow()} disabled={starting || recorder !== null || engine.kind === 'checking'} data-testid="voice-record">
          {starting ? 'Getting ready…' : hasSound ? 'Record again' : 'Record'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setSettingUp(true)} disabled={recorder !== null} data-testid="voice-set-up">
          Set up
        </Button>
      </div>
      {!hasSound && (
        <p className="text-sm text-muted-foreground">
          Call out each sail number, then “now” as they finish, or press NOW. Everything said near the phone is recorded, and the
          recording goes to the scorer with the finish sheet.
          {engine.kind === 'absent' && ` Sail numbers are recognised on this phone once the recogniser is downloaded (${size} MB) in Set up; without it the sound and the NOWs are still recorded.`}
        </p>
      )}
      {problem && <p className="text-sm text-destructive" role="alert">{problem}</p>}

      {recording && hasSound && !recorder && (
        <div className="space-y-3" data-testid="voice-summary">
          <p className="text-sm">
            <b>{accepted}</b> accepted · <b>{clear.length}</b> suggested ·{' '}
            <span className={toCheck.length > 0 ? 'font-semibold text-amber-700 dark:text-amber-400' : undefined}>{toCheck.length} to check</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {clear.length > 0 && (
              <Button size="sm" onClick={() => voice.acceptAll()} data-testid="voice-accept-all">
                Accept {clear.length} suggested finish{clear.length === 1 ? '' : 'es'}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => voice.openTimeline(toCheck[0] ? { kind: 'suggestion', key: toCheck[0].key } : null)}
              data-testid="voice-open-timeline"
            >
              {toCheck.length > 0 ? 'Check them in the timeline' : 'Open the timeline'}
            </Button>
          </div>
          {noWords && (
            <div className="space-y-2 text-sm" data-testid="voice-no-words">
              <p className="text-muted-foreground">
                No sail numbers were recognised while recording. The recording is all here: finishes can be made from its NOWs
                by listening{engine.kind === 'ready' ? ', or the sail numbers can be found in it now' : ''}.
              </p>
              {engine.kind === 'ready' && (
                <Button size="sm" variant="outline" onClick={() => void voice.findWords()} disabled={voice.finding !== null}>
                  {voice.finding ? `Finding sail numbers… ${Math.round((100 * voice.finding.done) / Math.max(1, voice.finding.total))}%` : 'Find the sail numbers'}
                </Button>
              )}
            </div>
          )}
          {recording.gaps.length > 0 && (
            <ul className="space-y-0.5 text-sm text-amber-700 dark:text-amber-400" data-testid="voice-gaps">
              {recording.gaps.map((g) => (
                <li key={g.from}>
                  Not recording from {clockTime(g.from)} to {clockTime(g.to)}. Anything called out then was not recorded.
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2 border-t pt-3 text-sm">
            <p className="text-muted-foreground">
              Voice recordings are stored on this device until {day(phoneKeepsUntil(recording))}, and sent to the scorer with the finish
              sheet unless you turn that off below. The scorer’s copy is deleted {SERVER_KEEPS_DAYS_AFTER_LAST_RACE} days after the series’ last race.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => void voice.saveSound()}>Save the recording</Button>
              <Button size="sm" variant="outline" onClick={() => voice.saveTimeline(names)}>Save the timeline</Button>
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
                The finishes stay on the sheet. The recording goes from this phone, and the scorer’s copy with it.
              </p>
            )}
          </div>
        </div>
      )}

      {settingUp && (
        <VoiceSetupDialog voice={voice} entries={entries} name={name} onRecord={begin} onClose={() => setSettingUp(false)} />
      )}
      {recorder && source && (
        <RecordingScreen
          recorder={recorder}
          source={source}
          editing={editing}
          competitors={competitors}
          name={name}
          level={level}
          onStop={() => void voice.stop()}
        />
      )}
      {voice.view && source && !recorder && (
        <TimelineView
          source={source}
          editing={editing}
          competitors={competitors}
          name={name}
          title="The recording"
          subtitle={`Recorded ${clockTime(Math.min(...recording!.takes.map((t) => t.startedAt)))}`}
          target={voice.view.target}
          onClose={voice.closeTimeline}
        />
      )}
    </section>
  );
}

/**
 * Beside Submit for review: whether the recording goes with the sheet, on
 * unless the recorder turns it off, and how sending it is going.
 */
export function VoiceSending({ voice }: { voice: VoiceRecording }) {
  const { recording, suggested } = voice;
  if (!voice.enabled || !recording || recording.takes.length === 0) return null;
  const left = suggested.suggestions.length;
  return (
    <div className="space-y-1.5 text-sm" data-testid="voice-sending">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          role="switch"
          className="mt-1 h-4 w-4 accent-emerald-600"
          checked={recording.send}
          onChange={(e) => voice.setSending(e.target.checked)}
          aria-label="Send the recording with the finish sheet"
          data-testid="voice-send"
        />
        <span>
          Send the recording with the finish sheet
          <span className="block text-muted-foreground">
            {recording.send
              ? 'The scorer can play any part of it to check a finish or answer a scoring inquiry.'
              : `The recording stays on this device, and is deleted on ${day(phoneKeepsUntil(recording))}.`}
          </span>
        </span>
      </label>
      {left > 0 && (
        <p className="text-muted-foreground" data-testid="voice-not-accepted">
          {left} suggested finish{left === 1 ? ' isn’t' : 'es aren’t'} accepted and won’t be submitted.
          {recording.send ? ' They go with the recording, for the scorer to accept.' : ' Without the recording, the scorer won’t see them.'}
        </p>
      )}
      {recording.send && (
        <p className="text-muted-foreground" role="status" data-testid="voice-send-status">
          {voice.send.kind === 'idle' && 'It goes when you submit the sheet.'}
          {voice.send.kind === 'sending' &&
            (voice.send.total > 0 ? `Sending the recording: ${Math.round((100 * voice.send.sent) / voice.send.total)}%` : 'Sending the recording…')}
          {voice.send.kind === 'sent' && `The scorer has the recording. It is deleted on ${deletedOn(voice.send.expiresAt)}.`}
          {voice.send.kind === 'waiting' && 'No signal: the recording goes when there is one. Keep this page open.'}
          {voice.send.kind === 'refused' && `The recording wasn’t sent (${voice.send.message}). It is still on this device.`}
        </p>
      )}
    </div>
  );
}
