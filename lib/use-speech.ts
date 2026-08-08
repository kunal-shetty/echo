"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  start: () => void;
  stop: () => void;
  abort: () => void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

interface UseSpeechOptions {
  onFinal?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  lang?: string;
}

interface UseSpeechReturn {
  supported: boolean;
  listening: boolean;
  transcript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

function getSpeechRecognitionCtor():
  | (new () => SpeechRecognitionLike)
  | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function useSpeech(options: UseSpeechOptions = {}): UseSpeechReturn {
  const { onFinal, onInterim, lang = "en-IN" } = options;
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);

  useEffect(() => {
    onFinalRef.current = onFinal;
    onInterimRef.current = onInterim;
  }, [onFinal, onInterim]);

  useEffect(() => {
    const Ctor = getSpeechRecognitionCtor();
    setSupported(!!Ctor);
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = true;
    rec.lang = lang;

    rec.onresult = (event) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        const t = r[0].transcript;
        if (r.isFinal) final += t;
        else interim += t;
      }
      const merged = (final + interim).trim();
      setTranscript(merged);
      if (interim) onInterimRef.current?.(interim.trim());
      if (final) onFinalRef.current?.(final.trim());
    };

    rec.onerror = (e) => {
      setError(e.error);
      setListening(false);
    };

    rec.onend = () => {
      setListening(false);
    };

    recRef.current = rec;
    return () => {
      try {
        rec.abort();
      } catch {
        /* noop */
      }
      recRef.current = null;
    };
  }, [lang]);

  const start = useCallback(() => {
    setError(null);
    setTranscript("");
    if (!recRef.current) return;
    try {
      recRef.current.start();
      setListening(true);
    } catch (e) {
      // Some browsers throw if start() is called while already started.
      setError(e instanceof Error ? e.message : "Could not start");
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    if (!recRef.current) return;
    try {
      recRef.current.stop();
    } catch {
      /* noop */
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  return { supported, listening, transcript, error, start, stop, reset };
}
