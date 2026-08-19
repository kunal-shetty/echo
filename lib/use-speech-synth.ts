"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechSynthReturn {
  supported: boolean;
  speaking: boolean;
  speak: (text: string) => void;
  cancel: () => void;
}

/** Tiny TTS wrapper around the Web Speech API. Picks an en-IN voice if one
 *  is installed; otherwise falls back to the user's default voice. SSR-safe
 *  — the SpeechSynthesis object is only read inside useEffect. */
export function useSpeechSynth(): UseSpeechSynthReturn {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported("speechSynthesis" in window);
  }, []);

  const cancel = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
    setSpeaking(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (typeof window === "undefined") return;
    const trimmed = text.trim();
    if (!trimmed || !("speechSynthesis" in window)) return;

    // Cancel any in-flight utterance first so we don't queue.
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }

    const u = new SpeechSynthesisUtterance(trimmed);
    u.rate = 1;
    u.pitch = 1;
    u.volume = 1;

    const voices = window.speechSynthesis.getVoices();
    const preferred =
      voices.find((v) => /en[-_]IN/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null;
    if (preferred) u.voice = preferred;
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    utteranceRef.current = u;
    setSpeaking(true);
    window.speechSynthesis.speak(u);
  }, []);

  // Cancel any pending speech when the component unmounts.
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined") {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* noop */
        }
      }
    };
  }, []);

  return { supported, speaking, speak, cancel };
}
