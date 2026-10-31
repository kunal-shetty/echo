"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { BatteryCharging, Ear, GraduationCap, Mic, Sparkles, X } from "lucide-react";
import { Header } from "@/components/home/header";
import { Field } from "@/components/ui/field";
import { useApp } from "@/context/AppContext";
import {
  DEFAULT_AGENT_NAME,
  onAgentEvent,
  useAgent,
  type AgentStatus,
} from "@/lib/native/agent";
import { haptic } from "@/lib/native/haptics";

/** How many times the user says the name during the "teach" step. */
const TEACH_ROUNDS = 3;
/** Heard phrases shorter than this (in letters) are everyday words like "now". */
const MIN_ALIAS_LETTERS = 4;

function letters(text: string): string {
  return text.toLowerCase().replace(/[^a-z]/g, "");
}

function statusLine(status: AgentStatus): string {
  const name = status.name;
  switch (status.state) {
    case "preparing":
      return "Starting…";
    case "downloading":
      return `Downloading the offline speech model (${status.detail})`;
    case "listening":
      return `Listening for “${name}”`;
    case "awake":
      return "Heard you, go ahead";
    case "thinking":
      return "Thinking…";
    case "paused":
      return "Paused while the app uses the mic";
    case "calibrating":
      return `Say “${name}” now`;
    case "error":
      return status.detail || "Something went wrong";
    default:
      return status.enabled ? "Starting…" : "Off";
  }
}

export function AgentScreen() {
  const { setVoiceOpen } = useApp();
  const agent = useAgent();
  const { status } = agent;
  const [draftName, setDraftName] = useState("");
  const [teaching, setTeaching] = useState<string[] | null>(null);
  const [teachNote, setTeachNote] = useState<string | null>(null);

  useEffect(() => {
    if (status) setDraftName((d) => d || status.name);
  }, [status]);

  // Latest values for the long-lived "heard" listener.
  const latest = useRef({ teaching, status, agent });
  useEffect(() => {
    latest.current = { teaching, status, agent };
  });

  useEffect(
    () =>
      onAgentEvent("heard", ({ text }) => {
        const { teaching, status, agent } = latest.current;
        if (!teaching || !status) return;
        haptic("tap");
        const heard = [...teaching, text];
        if (heard.length < TEACH_ROUNDS) {
          setTeaching(heard);
          void agent.calibrate();
          return;
        }
        // Keep the distinct ways it heard the name, minus the name itself
        // and anything too short to be safe as a trigger.
        const nameKey = letters(status.name);
        const aliases = [...new Set(heard.map((h) => h.trim().toLowerCase()))].filter(
          (h) => letters(h) !== nameKey && letters(h).length >= MIN_ALIAS_LETTERS,
        );
        const skipped = heard.filter((h) => letters(h).length < MIN_ALIAS_LETTERS);
        setTeaching(null);
        setTeachNote(
          skipped.length
            ? `I heard “${skipped[0]}”, which is too close to an everyday word. A longer name will work better.`
            : `Got it. I heard: ${heard.map((h) => `“${h}”`).join(", ")}.`,
        );
        haptic(skipped.length ? "warning" : "success");
        void agent.configure({ aliases: [...new Set([...status.aliases, ...aliases])] });
      }),
    [],
  );

  const header = (
    <Header screen="agent" onVoice={() => setVoiceOpen(true)} />
  );

  if (!agent.supported) {
    return (
      <>
        {header}
        <main className="flex flex-col gap-5 px-5 pb-28">
          <div className="panel flex flex-col gap-2">
            <p className="font-medium">Available in the Android app</p>
            <p className="text-sm text-muted-foreground">
              Install Echo on your Android phone to get an assistant that is always
              listening for its name. Say “Hey {DEFAULT_AGENT_NAME}, spent 200 on
              petrol” without opening the app.
            </p>
          </div>
        </main>
      </>
    );
  }

  const name = status?.name ?? DEFAULT_AGENT_NAME;
  const trimmed = draftName.trim().replace(/\s+/g, " ");
  const nameValid = /^[\p{L}][\p{L} '-]{1,23}$/u.test(trimmed);
  const nameChanged = !!status && trimmed !== status.name;

  const saveName = () => {
    if (!nameValid) return;
    haptic("success");
    setTeachNote(null);
    // Taught aliases belong to the old name.
    void agent.configure({ name: trimmed, aliases: [] });
  };

  const startTeaching = () => {
    haptic("tap");
    setTeachNote(null);
    setTeaching([]);
    void agent.calibrate();
  };

  const toggle = () => {
    haptic("tap");
    void (status?.enabled ? agent.stop() : agent.start());
  };

  return (
    <>
      {header}
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel flex items-center gap-3">
          <span
            className={`grid size-11 shrink-0 place-items-center rounded-2xl ${
              status?.running ? "bg-emerald/15 text-emerald" : "bg-surface-3 text-muted-foreground"
            }`}
          >
            {status?.state === "awake" || status?.state === "thinking" ? (
              <Sparkles size={20} />
            ) : (
              <Ear size={20} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{name}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground" aria-live="polite">
              {status ? statusLine(status) : "Loading…"}
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={!!status?.enabled}
            aria-label={`Always listen for ${name}`}
            onClick={toggle}
            disabled={!status}
            className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${
              status?.enabled ? "bg-emerald" : "bg-surface-3"
            }`}
          >
            <motion.span
              className="absolute top-1 size-5 rounded-full bg-white shadow"
              animate={{ left: status?.enabled ? 24 : 4 }}
              transition={{ type: "spring", stiffness: 500, damping: 32 }}
            />
          </button>
        </div>

        {agent.error && (
          <p className="rounded-xl bg-red/10 px-4 py-3 text-sm text-red">{agent.error}</p>
        )}

        <div className="panel flex flex-col gap-3">
          <Field
            label="Your agent's name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            maxLength={24}
            invalid={!!trimmed && !nameValid}
            hint={
              letters(trimmed).length > 0 && letters(trimmed).length < MIN_ALIAS_LETTERS
                ? "Short names go off by accident more often. Two syllables work best."
                : "Anything you like: Nova, Jarvis, Penny…"
            }
            leadingIcon={<Mic size={16} />}
          />
          <motion.button
            type="button"
            className="primary-button"
            disabled={!nameChanged || !nameValid}
            onClick={saveName}
            whileTap={{ scale: 0.99 }}
          >
            Save name
          </motion.button>
        </div>

        <div className="panel !p-2">
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <GraduationCap size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Teach it your name</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {teaching
                  ? `Say “${name}” (${teaching.length + 1} of ${TEACH_ROUNDS})`
                  : (teachNote ??
                    "Say the name 3 times so it learns how you pronounce it.")}
              </span>
            </span>
            <button
              type="button"
              className="text-sm font-medium text-emerald disabled:opacity-40"
              disabled={!status?.running || !!teaching}
              onClick={startTeaching}
            >
              {teaching ? "Listening…" : "Start"}
            </button>
          </div>
          {status && status.aliases.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 px-3 pb-3">
              {status.aliases.map((a) => (
                <span
                  key={a}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-2.5 py-1 text-xs"
                >
                  “{a}”
                  <button
                    type="button"
                    aria-label={`Forget “${a}”`}
                    onClick={() =>
                      void agent.configure({ aliases: status.aliases.filter((x) => x !== a) })
                    }
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {status && !status.batteryUnrestricted && (
            <button
              type="button"
              className="settings-row"
              onClick={() => void agent.openBatterySettings()}
            >
              <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
                <BatteryCharging size={17} />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="block text-sm font-medium">Keep it running</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Set Echo&apos;s battery use to “Unrestricted” so Android doesn&apos;t
                  put {name} to sleep.
                </span>
              </span>
            </button>
          )}
        </div>

        <div className="panel flex flex-col gap-2 text-sm">
          <p className="font-medium">Try saying</p>
          <ul className="flex flex-col gap-1.5 text-muted-foreground">
            <li>“{name}, spent 200 on petrol”</li>
            <li>“Hey {name}, got my salary of 50,000”</li>
            <li>“{name}, how much did I spend on food this week?”</li>
            <li>“{name}, change the last one to 250”</li>
          </ul>
          <p className="mt-2 text-xs text-muted-foreground">
            Wake-word listening happens on your phone. Audio is only sent to Echo after
            it hears “{name}”. You&apos;ll feel two quick taps when it starts
            listening, and it vibrates again with the result.
          </p>
        </div>
      </main>
    </>
  );
}
