"use client";

// Audio player pinned to the bottom of the meeting view. Exposes an imperative
// seek(ms) handle so transcript timestamp clicks can jump the playhead; seeking
// also starts playback.
//
// Purpose-built rather than the browser default, for two reasons:
//   1. The native control is ~30px tall with a hair-thin scrubber. These are
//      three-hour meetings read by people with poor eyesight; the target sizes
//      here are deliberate, not decoration.
//   2. Meetings need skip and speed. Scrubbing to "that bit about the budget"
//      in a native bar is guesswork; +/- 15s and a speed control are what make
//      a long recording usable at all.

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

export interface AudioPlayerHandle {
  /** Jump the playhead to the given offset (milliseconds) and play. */
  seek(ms: number): void;
}

interface AudioPlayerProps {
  /** Browser-facing audio URL, e.g. /api/audio/meetings/<id>/audio.wav */
  src: string;
  meetingTitle: string;
}

const SKIP_SECONDS = 15;
const SPEEDS = [1, 1.25, 1.5, 2] as const;

/** m:ss, or h:mm:ss once past an hour. Meetings routinely run past an hour, so
 *  a fixed mm:ss would read "187:04" and mean nothing. */
function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const AudioPlayer = forwardRef<AudioPlayerHandle, AudioPlayerProps>(
  function AudioPlayer({ src, meetingTitle }, ref) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);
    const [speed, setSpeed] = useState<number>(1);
    // While the user drags, the thumb follows the pointer rather than the
    // playhead - otherwise timeupdate fights the drag and the thumb snaps back.
    const [scrubbing, setScrubbing] = useState(false);
    const [scrubValue, setScrubValue] = useState(0);

    useImperativeHandle(
      ref,
      () => ({
        seek(ms: number) {
          const el = audioRef.current;
          if (!el) return;
          el.currentTime = Math.max(0, ms / 1000);
          setCurrent(el.currentTime);
          void el.play().catch(() => {
            // Autoplay can be blocked before any user gesture on the element;
            // the playhead is still moved, so a manual press of Play resumes
            // from the right spot.
          });
        },
      }),
      [],
    );

    useEffect(() => {
      const el = audioRef.current;
      if (!el) return;
      const onTime = () => {
        if (!scrubbing) setCurrent(el.currentTime);
      };
      const onMeta = () => setDuration(el.duration);
      const onPlay = () => setPlaying(true);
      const onPause = () => setPlaying(false);
      el.addEventListener("timeupdate", onTime);
      el.addEventListener("loadedmetadata", onMeta);
      el.addEventListener("durationchange", onMeta);
      el.addEventListener("play", onPlay);
      el.addEventListener("pause", onPause);
      el.addEventListener("ended", onPause);
      return () => {
        el.removeEventListener("timeupdate", onTime);
        el.removeEventListener("loadedmetadata", onMeta);
        el.removeEventListener("durationchange", onMeta);
        el.removeEventListener("play", onPlay);
        el.removeEventListener("pause", onPause);
        el.removeEventListener("ended", onPause);
      };
    }, [scrubbing]);

    const toggle = useCallback(() => {
      const el = audioRef.current;
      if (!el) return;
      if (el.paused) void el.play().catch(() => {});
      else el.pause();
    }, []);

    const skip = useCallback((by: number) => {
      const el = audioRef.current;
      if (!el) return;
      const next = Math.min(
        Math.max(0, el.currentTime + by),
        el.duration || Number.MAX_SAFE_INTEGER,
      );
      el.currentTime = next;
      setCurrent(next);
    }, []);

    const cycleSpeed = useCallback(() => {
      const el = audioRef.current;
      if (!el) return;
      const next = SPEEDS[(SPEEDS.indexOf(speed as 1) + 1) % SPEEDS.length];
      el.playbackRate = next;
      setSpeed(next);
    }, [speed]);

    const shown = scrubbing ? scrubValue : current;
    const max = duration || 0;

    const btn =
      "inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg text-ink hover:bg-tint";

    return (
      <div className="border-t border-line bg-white/95 px-4 py-3 shadow-[0_-4px_12px_rgba(10,12,11,0.07)] backdrop-blur">
        <audio ref={audioRef} preload="metadata" src={src} className="hidden">
          Your browser does not support the audio element.
        </audio>

        <div
          role="group"
          aria-label={`Audio recording of ${meetingTitle}`}
          className="mx-auto flex w-full max-w-5xl items-center gap-3"
        >
          <button type="button" onClick={() => skip(-SKIP_SECONDS)} className={btn}>
            <span className="sr-only">Go back {SKIP_SECONDS} seconds</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 8L7 12l4 4" />
              <path d="M7 12h6a4 4 0 110 8h-1" />
            </svg>
          </button>

          <button
            type="button"
            onClick={toggle}
            aria-pressed={playing}
            className="inline-flex min-h-14 min-w-14 items-center justify-center rounded-full bg-accent text-white hover:bg-accent-strong"
          >
            <span className="sr-only">{playing ? "Pause" : "Play"}</span>
            {playing ? (
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-7 w-7" fill="currentColor">
                <path d="M8 5.5v13a1 1 0 001.5.87l11-6.5a1 1 0 000-1.74l-11-6.5A1 1 0 008 5.5z" />
              </svg>
            )}
          </button>

          <button type="button" onClick={() => skip(SKIP_SECONDS)} className={btn}>
            <span className="sr-only">Go forward {SKIP_SECONDS} seconds</span>
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13 8l4 4-4 4" />
              <path d="M17 12h-6a4 4 0 100 8h1" />
            </svg>
          </button>

          <time className="tabular-nums text-sm text-ink-soft" dateTime={`PT${Math.floor(shown)}S`}>
            {clock(shown)}
          </time>

          <input
            type="range"
            min={0}
            max={max || 100}
            step={1}
            value={Math.min(shown, max || 100)}
            aria-label="Seek through the recording"
            aria-valuetext={`${clock(shown)} of ${clock(max)}`}
            onPointerDown={() => setScrubbing(true)}
            onChange={(e) => setScrubValue(Number(e.target.value))}
            onPointerUp={(e) => {
              const el = audioRef.current;
              const v = Number((e.target as HTMLInputElement).value);
              if (el) {
                el.currentTime = v;
                setCurrent(v);
              }
              setScrubbing(false);
            }}
            onKeyUp={(e) => {
              const el = audioRef.current;
              const v = Number((e.target as HTMLInputElement).value);
              if (el) {
                el.currentTime = v;
                setCurrent(v);
              }
            }}
            className="audio-scrub min-h-12 flex-1"
          />

          <time className="tabular-nums text-sm text-ink-soft" dateTime={`PT${Math.floor(max)}S`}>
            {clock(max)}
          </time>

          <button
            type="button"
            onClick={cycleSpeed}
            className="inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg px-3 text-sm font-semibold tabular-nums text-ink hover:bg-tint"
          >
            <span className="sr-only">
              Playback speed, currently {speed} times. Press to change.
            </span>
            <span aria-hidden="true">{speed}x</span>
          </button>
        </div>
      </div>
    );
  },
);
