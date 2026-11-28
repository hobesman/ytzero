import { useEffect, useRef, useState } from "react";

/** The parts of the Web Speech API this uses; browsers ship it prefixed or not, and Android's WebView not at all. */
type Recognition = {
  lang: string; interimResults: boolean; maxAlternatives: number; continuous: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void; abort: () => void;
};
type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const global = window as unknown as { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };
  return global.SpeechRecognition ?? global.webkitSpeechRecognition ?? null;
}

export type VoiceSearchState = "idle" | "listening" | "failed";

/**
 * Search by voice with the browser's speech recognition, where it has one
 * (Chrome does; Android's WebView, which kiosk browsers use, does not, and
 * then `supported` is false and no button should show). One phrase, in the
 * page's language; `onHeard` gets what was said.
 */
export function useVoiceSearch(language: string, onHeard: (text: string) => void) {
  const [state, setState] = useState<VoiceSearchState>("idle");
  const recognition = useRef<Recognition | null>(null);
  const heard = useRef(onHeard);
  heard.current = onHeard;
  const Constructor = recognitionConstructor();
  useEffect(() => () => recognition.current?.abort(), []);

  const start = () => {
    if (!Constructor) return;
    if (recognition.current) { recognition.current.abort(); return; }
    const listener = new Constructor();
    listener.lang = language;
    listener.interimResults = false;
    listener.maxAlternatives = 1;
    listener.continuous = false;
    let got = false;
    listener.onresult = (event) => {
      const text = event.results[0]?.[0]?.transcript?.trim();
      if (text) { got = true; heard.current(text); }
    };
    // "aborted" is a second tap stopping it; anything else (no speech, no microphone) is worth saying.
    listener.onerror = (event) => { if (event.error !== "aborted") setState("failed"); };
    listener.onend = () => {
      recognition.current = null;
      setState((current) => (got ? "idle" : current === "failed" ? "failed" : "idle"));
    };
    recognition.current = listener;
    setState("listening");
    try { listener.start(); } catch { recognition.current = null; setState("failed"); }
  };
  return { supported: Boolean(Constructor), state, start };
}
