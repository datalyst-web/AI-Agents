"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Speak-instead-of-type for the dashboard's chat boxes (the Test Agent tab
 * and the standalone agent page) — the same behaviour as the website
 * widget's mic (apps/widget/src/widget.ts). Uses the browser's own speech
 * recognition, so no audio reaches our servers; words stream into the box
 * and stay there to be checked before sending. Renders nothing where the
 * browser has no speech recognition (e.g. Firefox).
 */

type Recognition = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<{ 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

const SILENCE_MS = 2500;
const MAX_LISTEN_MS = 60_000;
const ERRORS: Record<string, string> = {
  "not-allowed": "Microphone access is blocked — allow it for this site in your browser settings.",
  "service-not-allowed": "Microphone access is blocked — allow it for this site in your browser settings.",
  "no-speech": "Didn't hear anything — tap the mic and try again.",
  "audio-capture": "No microphone was found on this device.",
  network: "Voice typing needs an internet connection.",
  "language-not-supported": "Voice typing isn't available in this language here.",
};

function recognitionCtor(): (new () => Recognition) | undefined {
  if (typeof window === "undefined" || !window.isSecureContext) return undefined;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => Recognition) | undefined;
}

export function VoiceInputButton({
  value,
  onChange,
  disabled,
  onListeningChange,
  onError,
}: {
  value: string;
  onChange: (text: string) => void;
  disabled?: boolean;
  onListeningChange?: (listening: boolean) => void;
  /** Called with a friendly message, or null to clear it. */
  onError?: (message: string | null) => void;
}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recRef = useRef<Recognition | null>(null);
  const timers = useRef<{ silence?: ReturnType<typeof setTimeout>; max?: ReturnType<typeof setTimeout> }>({});
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => setSupported(Boolean(recognitionCtor())), []);
  useEffect(() => () => recRef.current?.abort(), []);
  useEffect(() => onListeningChange?.(listening), [listening, onListeningChange]);
  // The message was sent mid-speech (the box was cleared): stop, and don't
  // let late results refill it.
  const lastEmitted = useRef("");
  useEffect(() => {
    if (recRef.current && value === "" && lastEmitted.current !== "") {
      recRef.current.onresult = null;
      recRef.current.abort();
    }
  }, [value]);

  function stop() {
    clearTimeout(timers.current.silence);
    clearTimeout(timers.current.max);
    recRef.current?.stop();
  }

  function start() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = document.documentElement.lang || navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = true;
    const prefix = valueRef.current.trim() ? `${valueRef.current.trim()} ` : "";
    lastEmitted.current = valueRef.current;
    rec.onresult = (e) => {
      let spoken = "";
      for (let i = 0; i < e.results.length; i++) spoken += e.results[i]![0].transcript;
      const text = spoken.replace(/\s+/g, " ").trimStart();
      lastEmitted.current = prefix + (text ? text.charAt(0).toUpperCase() + text.slice(1) : "");
      onChange(lastEmitted.current);
      clearTimeout(timers.current.silence);
      timers.current.silence = setTimeout(stop, SILENCE_MS);
    };
    rec.onerror = (e) => {
      const message = ERRORS[e.error];
      if (message) onError?.(message);
    };
    rec.onend = () => {
      clearTimeout(timers.current.silence);
      clearTimeout(timers.current.max);
      recRef.current = null;
      setListening(false);
    };
    try {
      onError?.(null);
      rec.start();
      setListening(true);
      timers.current.max = setTimeout(stop, MAX_LISTEN_MS);
    } catch {
      recRef.current = null;
      onError?.("Voice typing couldn't start — please try again.");
    }
  }

  if (!supported) return null;
  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      disabled={disabled && !listening}
      aria-pressed={listening}
      aria-label={listening ? "Stop listening" : "Speak your message"}
      title={listening ? "Stop listening" : "Speak instead of typing"}
      className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-all disabled:opacity-40 ${
        listening
          ? "border-transparent bg-danger text-white ring-4 ring-danger/20"
          : "border-foreground/10 bg-foreground/5 text-foreground/50 hover:border-brand-500/40 hover:text-brand-link"
      }`}
    >
      {listening ? (
        <span className="flex h-4 items-center gap-[2.5px]" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => (
            <span
              key={i}
              className="block w-[3px] rounded-full bg-current motion-safe:animate-[voicewave_0.9s_ease-in-out_infinite]"
              style={{ height: 6, animationDelay: `${i * 0.12}s` }}
            />
          ))}
        </span>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="9" y="2.5" width="6" height="12" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3.5" />
        </svg>
      )}
    </button>
  );
}
