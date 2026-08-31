/**
 * @file use-speech-synth.ts
 * @description Custom hook providing a simple wrapper around the Web Speech API
 * for Text-to-Speech (TTS) output.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechSynthReturn {
  /** True if the browser supports the SpeechSynthesis API. */
  supported: boolean;
  /** True if the browser is currently speaking. */
  speaking: boolean;
  /** Triggers the browser to speak the provided text. */
  speak: (text: string) => void;
  /** Immediately cancels any active speech. */
  cancel: () => void;
}

/**
 * Hook for managing text-to-speech output.
 * Attempts to use an en-IN (English India) voice for a natural local feel.
 */
export function useSpeechSynth(): UseSpeechSynthReturn {
  const [supported, setSupported] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSupported("speechSynthesis" in window);
  }, []);

  /** Stops any active speech immediately. */
  const cancel = useCallback(() => {
    if (typeof window === "undefined") return;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
    setSpeaking(false);
  }, []);

  /**
   * Converts text to speech.
   * Cancels any currently playing audio before starting a new utterance.
   * @param text The string to be spoken.
 */
  const speak = useCallback((text: string) => {
    if (typeof window === "undefined") return;
    const trimmed = text.trim();
    if (!trimmed || !("speechSynthesis" in window)) return;

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
    // Prioritize Indian English voices for a consistent regional feel.
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
