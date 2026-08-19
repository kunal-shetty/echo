"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechOptions {
  onFinal?: (transcript: string) => void;
  onInterim?: (transcript: string) => void;
  lang?: string;
  silenceMs?: number;
  maxMs?: number;
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

// VAD + MediaRecorder capture. Audio is sent to /api/transcribe (Groq Whisper).
// Auto-stops after `silenceMs` of near-silence, or after `maxMs` total, whichever comes first.
export function useSpeech(options: UseSpeechOptions = {}): UseSpeechReturn {
  const {
    onFinal,
    onInterim,
    lang = "en",
    silenceMs = 1500,
    maxMs = 30_000,
  } = options;

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stoppedRef = useRef(false);
  const startedAtRef = useRef<number>(0);

  const onFinalRef = useRef(onFinal);
  const onInterimRef = useRef(onInterim);
  useEffect(() => {
    onFinalRef.current = onFinal;
    onInterimRef.current = onInterim;
  }, [onFinal, onInterim]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok =
      !!navigator.mediaDevices?.getUserMedia &&
      typeof window.MediaRecorder !== "undefined";
    setSupported(ok);
  }, []);

  const cleanupAnalyser = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (maxTimerRef.current) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {
        /* noop */
      });
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
  };

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  };

  const finalize = useCallback(async () => {
    const rec = mediaRecorderRef.current;
    const chunks = chunksRef.current.slice();
    chunksRef.current = [];
    mediaRecorderRef.current = null;

    if (!rec || chunks.length === 0) {
      setListening(false);
      return;
    }

    // Prefer the mimeType the recorder produced so the file extension matches.
    const mimeType = rec.mimeType || "audio/webm";
    const ext = mimeType.includes("mp4")
      ? "mp4"
      : mimeType.includes("ogg")
        ? "ogg"
        : "webm";
    const blob = new Blob(chunks, { type: mimeType });
    const durationMs = Date.now() - startedAtRef.current;

    setTranscript("");
    setError(null);

    const fd = new FormData();
    fd.append("file", blob, `capture.${ext}`);
    fd.append("language", lang.split("-")[0] ?? "en");

    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        body: fd,
      });
      const data = (await res.json().catch(() => ({}))) as {
        text?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const text = (data.text ?? "").trim();
      if (text) {
        setTranscript(text);
        onFinalRef.current?.(text);
      } else if (durationMs < 600) {
        // Whisper on near-silent audio returns empty. Surface as a soft error.
        setError("Didn't catch that. Try again.");
        onFinalRef.current?.("");
      }
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Transcription failed";
      setError(message);
      onFinalRef.current?.("");
    } finally {
      setListening(false);
    }
  }, [lang]);

  const stop = useCallback(() => {
    const rec = mediaRecorderRef.current;
    stoppedRef.current = true;
    cleanupAnalyser();
    stopStream();
    if (rec && rec.state !== "inactive") {
      try {
        rec.stop();
      } catch {
        setListening(false);
      }
    } else {
      setListening(false);
    }
  }, []);

  const start = useCallback(async () => {
    if (listening) return;
    setError(null);
    setTranscript("");

    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Microphone access isn't supported in this browser.");
      return;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Phone-call grade is plenty for short utterances and keeps uploads tiny.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (e) {
      const err = e as { name?: string; message?: string };
      if (err.name === "NotAllowedError" || err.name === "SecurityError") {
        setError("Microphone access denied.");
      } else if (err.name === "NotFoundError") {
        setError("No microphone found.");
      } else {
        setError(err.message ?? "Could not access microphone.");
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    stoppedRef.current = false;
    startedAtRef.current = Date.now();

    // Pick a supported mimeType; Whisper accepts all of these.
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
      "audio/ogg;codecs=opus",
    ];
    const mimeType =
      candidates.find((t) =>
        typeof MediaRecorder !== "undefined" &&
        MediaRecorder.isTypeSupported(t),
      ) ?? "";

    let rec: MediaRecorder;
    try {
      rec = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch (e) {
      stopStream();
      const message = e instanceof Error ? e.message : "Recorder init failed";
      setError(message);
      return;
    }

    rec.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    rec.onstop = () => {
      cleanupAnalyser();
      stopStream();
      void finalize();
    };
    rec.onerror = (event) => {
      const ev = event as unknown as { error?: { message?: string } };
      setError(ev.error?.message ?? "Recording error.");
      cleanupAnalyser();
      stopStream();
      setListening(false);
    };

    // Set up VAD via AnalyserNode (RMS over time domain).
    try {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;

      const buffer = new Uint8Array(analyser.fftSize);
      let speechStarted = false;

      const tick = () => {
        if (!analyserRef.current || stoppedRef.current) return;
        analyser.getByteTimeDomainData(buffer);
        let sumSquares = 0;
        for (let i = 0; i < buffer.length; i++) {
          const v = (buffer[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / buffer.length);
        const isSpeech = rms > 0.04;

        if (isSpeech) {
          speechStarted = true;
          onInterimRef.current?.("…");
          if (silenceTimerRef.current) {
            clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = null;
          }
        } else if (speechStarted && !silenceTimerRef.current) {
          silenceTimerRef.current = setTimeout(() => {
            try {
              if (rec.state !== "inactive") rec.stop();
            } catch {
              /* noop */
            }
          }, silenceMs);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch {
      // VAD is a nice-to-have; recording still works without it.
    }

    // Hard cap — never record more than maxMs.
    maxTimerRef.current = setTimeout(
      () => {
        try {
          if (rec.state !== "inactive") rec.stop();
        } catch {
          /* noop */
        }
      },
      Math.max(1000, maxMs),
    );

    try {
      rec.start(250); // emit chunks every 250ms so large captures don't OOM
      mediaRecorderRef.current = rec;
      setListening(true);
    } catch (e) {
      stopStream();
      cleanupAnalyser();
      const message = e instanceof Error ? e.message : "Could not start";
      setError(message);
    }
  }, [finalize, listening, maxMs, silenceMs]);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
  }, []);

  // Release the mic if the component unmounts mid-recording.
  useEffect(() => {
    return () => {
      stoppedRef.current = true;
      cleanupAnalyser();
      stopStream();
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {
          /* noop */
        }
      }
      mediaRecorderRef.current = null;
    };
  }, []);

  return { supported, listening, transcript, error, start, stop, reset };
}
