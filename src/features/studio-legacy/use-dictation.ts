"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The Web Speech API, wrapped so the composer doesn't have to care about
// vendor prefixes, SSR, or the browser's own error vocabulary. No
// dependency and no backend — this is built into the browser.
//
// Worth knowing: Chrome transcribes by sending audio to a Google speech
// service rather than on-device, which is why the button that calls this
// says so in its tooltip.

interface SpeechAlternative {
  transcript: string;
}
interface SpeechResult {
  readonly length: number;
  isFinal: boolean;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  readonly length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionResultEvent {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionErrorEvent {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionResultEvent) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function messageFor(error: string): string {
  switch (error) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked — allow it in your browser to dictate.";
    case "no-speech":
      return "Didn't catch anything — try again.";
    case "audio-capture":
      return "No microphone found.";
    case "network":
      return "Your browser's speech service is unreachable.";
    default:
      return "Dictation stopped unexpectedly.";
  }
}

export function useDictation(onFinalText: (text: string) => void) {
  // Resolved in an effect, never during render: window doesn't exist during
  // SSR, so checking inline would either crash or hydrate mismatched. The
  // button appears once the client confirms support — and never at all in a
  // browser that lacks the API (Firefox, as of now).
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalTextRef = useRef(onFinalText);

  onFinalTextRef.current = onFinalText;

  useEffect(() => {
    setSupported(getRecognitionCtor() !== null);
    return () => {
      const recognition = recognitionRef.current;
      if (!recognition) return;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    setListening(false);
    setInterim("");
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor();
    if (!Ctor) return;

    const recognition = new Ctor();
    recognitionRef.current = recognition;
    // A brief is a sentence or two — end on a natural pause rather than
    // holding the mic open. No `lang` is set on purpose: it inherits the
    // browser locale, which matters where teachers don't dictate in English.
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onresult = (event) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";
        if (result.isFinal) finalText += transcript;
        else interimText += transcript;
      }
      // Only finals reach the textarea. Appending interim results as they
      // arrive is the classic way to end up with duplicated, half-revised
      // text — they live in their own throwaway line instead.
      setInterim(interimText);
      if (finalText.trim()) {
        onFinalTextRef.current(finalText.trim());
        setInterim("");
      }
    };

    recognition.onerror = (event) => {
      setError(messageFor(event.error));
      setListening(false);
      setInterim("");
    };

    recognition.onend = () => {
      setListening(false);
      setInterim("");
    };

    setError(null);
    setInterim("");
    setListening(true);
    recognition.start();
  }, []);

  const toggle = useCallback(() => {
    if (listening) stop();
    else start();
  }, [listening, start, stop]);

  return { supported, listening, interim, error, toggle };
}
