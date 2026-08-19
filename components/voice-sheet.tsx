"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Mic, Plus, Tag as TagIcon, Type, Volume2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Field } from "@/components/ui/field";
import { AmountStepper } from "@/components/ui/amount-stepper";
import { Segmented } from "@/components/ui/segmented";
import { money, normalizeTranscript } from "@/lib/fmt";
import { toUiCategory, useCategories } from "@/lib/use-categories";
import { useSpeech } from "@/lib/use-speech";
import { useSpeechSynth } from "@/lib/use-speech-synth";
import type { ParseResult } from "@/lib/parse";
import type { Transaction } from "@/lib/schema";

type CaptureMode = "listening" | "confirm" | "manual" | "parsing" | "answer";

interface AnswerState {
  headline: string;
  spoken: string;
  rows: Transaction[];
  kind: "sum" | "list" | "biggest";
}

interface VoiceSheetProps {
  open: boolean;
  onClose: () => void;
  onSave: (expense: Transaction) => void;
  onUpdated?: (expense: Transaction) => void;
  onDeleted?: (id: string) => void;
}

export function VoiceSheet({
  open,
  onClose,
  onSave,
  onUpdated,
  onDeleted,
}: VoiceSheetProps) {
  const { categories: rawCats } = useCategories();
  const categories = rawCats.map(toUiCategory);
  const [mode, setMode] = useState<CaptureMode>("listening");
  const [confirmedAmount, setConfirmedAmount] = useState(150);
  const [amount, setAmount] = useState(0);
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [transcript, setTranscript] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const synth = useSpeechSynth();

  // Keep categoryId valid when categories load.
  useEffect(() => {
    if (categories.length === 0) return;
    if (!categories.find((c) => c.id === categoryId)) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const speech = useSpeech({
    onFinal: async (text) => {
      setTranscript(text);
      if (!text) return;
      setMode("parsing");
      try {
        // Cheap pre-classifier: if it sounds like a question, send to /api/ask.
        // The ask endpoint itself re-classifies and falls back if needed.
        const lowered = text.toLowerCase();
        const looksLikeQuestion =
          /^(how much|what (did|was|have)|show me|total|sum|biggest|largest|most|list)/i.test(
            lowered,
          );
        if (looksLikeQuestion) {
          const askRes = await fetch("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: text }),
          });
          const askData = (await askRes.json().catch(() => ({}))) as {
            result?: ParseResult;
            query?: {
              headline: string;
              spoken: string;
              rows: Transaction[];
              kind: "sum" | "list" | "biggest";
            };
            error?: string;
            warning?: string;
          };
          if (!askRes.ok || askData.error) {
            throw new Error(askData.error ?? `HTTP ${askRes.status}`);
          }
          if (!askData.query) {
            throw new Error("Empty response from /api/ask");
          }
          setAnswer({
            headline: askData.query.headline,
            spoken: askData.query.spoken,
            rows: askData.query.rows ?? [],
            kind: askData.query.kind,
          });
          setMode("answer");
          // Speak the headline back. Cancels any prior utterance.
          if (askData.query.spoken) synth.speak(askData.query.spoken);
          return;
        }

        const res = await fetch("/api/voice-intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          result?: ParseResult;
          draft?: {
            amount: number;
            merchant: string;
            categoryId: string | null;
            transactedAt: string;
            confidence: number;
          };
          transaction?: Transaction;
          deletedId?: string;
          warning?: string;
          error?: string;
        };
        if (!res.ok || data.error) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const result = data.result;
        if (!result) {
          throw new Error("Empty response from voice intent");
        }

        // Server-side query classification may have routed us to /api/ask
        // via the parser even though the heuristic missed. Handle it here.
        if (result.action === "query") {
          const askRes = await fetch("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: text }),
          });
          const askData = (await askRes.json().catch(() => ({}))) as {
            query?: {
              headline: string;
              spoken: string;
              rows: Transaction[];
              kind: "sum" | "list" | "biggest";
            };
            error?: string;
          };
          if (!askRes.ok || askData.error) {
            throw new Error(askData.error ?? `HTTP ${askRes.status}`);
          }
          if (!askData.query) {
            throw new Error("Empty response from /api/ask");
          }
          setAnswer({
            headline: askData.query.headline,
            spoken: askData.query.spoken,
            rows: askData.query.rows ?? [],
            kind: askData.query.kind,
          });
          setMode("answer");
          if (askData.query.spoken) synth.speak(askData.query.spoken);
          return;
        }

        // Update / delete: server did the work; close the sheet and let the
        // shell refresh + toast. The confirm card is for *creating* only.
        if (result.action === "update" && data.transaction) {
          speech.stop();
          onUpdated?.(data.transaction);
          onClose();
          return;
        }
        if (result.action === "delete" && data.deletedId) {
          speech.stop();
          onDeleted?.(data.deletedId);
          onClose();
          return;
        }
        // Server could not match → fall back to manual so the user can fix.
        if (
          (result.action === "update" || result.action === "delete") &&
          data.warning
        ) {
          setParseError(data.warning);
          setMode("manual");
          return;
        }

        // create flow — prefill from the draft the server returned.
        const draft = data.draft;
        if (draft) {
          setConfirmedAmount(draft.amount);
          setAmount(draft.amount);
          setMerchant(draft.merchant);
          if (draft.categoryId) setCategoryId(draft.categoryId);
        } else {
          // No draft but a result came back — pull the fields the old way.
          if (typeof result.amount === "number" && result.amount > 0) {
            setConfirmedAmount(result.amount);
            setAmount(result.amount);
          }
          if (result.merchant) setMerchant(result.merchant);
          if (result.category) {
            const cat = categories.find(
              (c) => c.name.toLowerCase() === result.category!.toLowerCase(),
            );
            if (cat) setCategoryId(cat.id);
          }
        }

        // Tiered routing on confidence:
        //   < 0.3  → too uncertain, send to manual entry.
        //   >= 0.7 → high confidence, the server already saved it; just close.
        //   0.3..0.7 → show the confirm card so the user can sanity-check.
        if (
          result.confidence < 0.3 ||
          result.amount == null ||
          !result.merchant
        ) {
          setParseError(
            data.warning ??
              "Couldn't parse that confidently. Please confirm below.",
          );
          setMode("manual");
        } else if (result.confidence >= 0.7) {
          // The server already created the transaction on our behalf.
          speech.stop();
          if (data.transaction) onSave(data.transaction);
          onClose();
        } else {
          setMode("confirm");
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Parse failed");
        // Fall through to manual so the user isn't stuck.
        setMode("manual");
      }
    },
  });

  // Reset state when the sheet opens
  useEffect(() => {
    if (!open) return;
    setMode("listening");
    setMerchant("");
    setAmount(0);
    setConfirmedAmount(150);
    setTranscript("");
    setParseError(null);
    setAnswer(null);
    synth.cancel();
    speech.reset();
    speech.start();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any TTS when the sheet closes so it doesn't keep playing in the bg.
  useEffect(() => {
    if (open) return;
    synth.cancel();
  }, [open, synth]);

  const category =
    categories.find((c) => c.id === categoryId) ?? categories[0];

  const save = (
    amountValue: number,
    merchantValue: string,
    confidenceOverride?: number | null,
  ) => {
    const cat = category;
    const isManual = mode === "manual";
    const expense: Transaction = {
      id: `local-${Date.now()}`,
      userId: "user-1",
      accountId: "acc-default",
      categoryId: cat?.id ?? null,
      amountMinor: amountValue,
      currency: "INR",
      direction: "expense",
      merchantRaw: merchantValue || "Expense",
      merchantCanonical: merchantValue || "Expense",
      transactedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      source: isManual ? "manual" : "voice",
      confidence: isManual ? null : confidenceOverride ?? 0.88,
      rawTranscript: isManual
        ? null
        : transcript || `spent ${amountValue} on ${merchantValue}`,
      clarified: false,
      icon: (merchantValue || "E").charAt(0).toUpperCase(),
      tone: cat?.tone ?? "neutral",
      date: "Today, just now",
      categoryName: cat?.name ?? null,
    };
    speech.stop();
    onSave(expense);
  };

  return (
    <BottomSheet
      open={open}
      onClose={() => {
        speech.stop();
        onClose();
      }}
      title={
        mode === "manual"
          ? "Add a memory"
          : mode === "confirm"
            ? "Did I get this right?"
            : mode === "parsing"
              ? "Thinking…"
              : mode === "answer"
                ? "Here's what I found"
                : undefined
      }
      subtitle={
        mode === "manual" || mode === "parsing" || mode === "answer"
          ? undefined
          : "Quick capture"
      }
    >
      <AnimatePresence mode="wait">
        {mode === "listening" ? (
          <ListeningState
            key="listening"
            transcript={speech.transcript}
            supported={speech.supported}
            listening={speech.listening}
            error={speech.error}
            onSkip={() => {
              speech.stop();
              setMode("manual");
            }}
            onRetry={() => {
              speech.reset();
              speech.start();
              setMode("listening");
            }}
          />
        ) : mode === "parsing" ? (
          <ParsingState key="parsing" transcript={transcript} />
        ) : mode === "answer" ? (
          <AnswerState
            key="answer"
            answer={answer}
            speaking={synth.speaking}
            supported={synth.supported}
            onReplay={() => answer && synth.speak(answer.spoken)}
            onAskAgain={() => {
              setAnswer(null);
              setMode("listening");
              speech.reset();
              speech.start();
            }}
            onClose={onClose}
          />
        ) : mode === "confirm" ? (
          <ConfirmState
            key="confirm"
            amount={confirmedAmount}
            merchant={merchant || "Lunch"}
            onPick={setConfirmedAmount}
            onSave={() => save(confirmedAmount, merchant || "Lunch")}
            onSwitchToManual={() => setMode("manual")}
          />
        ) : (
          <ManualState
            key="manual"
            amount={amount}
            setAmount={setAmount}
            merchant={merchant}
            setMerchant={setMerchant}
            categoryId={categoryId}
            setCategoryId={setCategoryId}
            categories={categories}
            categoryName={category?.name ?? "your account"}
            parseError={parseError}
            onSave={() => save(amount, merchant)}
          />
        )}
      </AnimatePresence>
    </BottomSheet>
  );
}

function ListeningState({
  transcript,
  supported,
  listening,
  error,
  onSkip,
  onRetry,
}: {
  transcript: string;
  supported: boolean;
  listening: boolean;
  error: string | null;
  onSkip: () => void;
  onRetry: () => void;
}) {
  return (
    <motion.div
      className="onboarding-listening"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.24 }}
    >
      <div
        className="voice-orb listening"
        style={{ viewTransitionName: "echo-orb" }}
      >
        <span className="orb-pulse-ring" />
        <span className="orb-pulse-ring" />
        <span className="orb-pulse-ring" />
        <Mic size={30} />
      </div>
      {transcript ? (
        <p className="mt-1 text-base font-medium text-foreground">
          “{normalizeTranscript(transcript)}”
        </p>
      ) : (
        <p className="font-medium">Echo is listening</p>
      )}
      {supported ? (
        <p className="text-sm text-muted-foreground">
          {listening
            ? "Speak — I'll stop when you pause."
            : transcript
              ? "Hold to add more, or wait…"
              : "Try “Spent 150 on lunch.”"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Voice isn&apos;t supported in this browser.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-orange">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          className="secondary-button !w-auto px-4"
          onClick={onSkip}
        >
          <Plus size={16} /> Add manually
        </button>
        {supported && (
          <button
            type="button"
            className="secondary-button !w-auto px-4"
            onClick={onRetry}
          >
            <Mic size={16} /> Try again
          </button>
        )}
      </div>
    </motion.div>
  );
}

function ParsingState({ transcript }: { transcript: string }) {
  return (
    <motion.div
      className="onboarding-listening"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.24 }}
    >
      <div className="voice-orb listening" style={{ viewTransitionName: "echo-orb" }}>
        <span className="orb-pulse-ring" />
        <span className="orb-pulse-ring" />
        <span className="orb-pulse-ring" />
      </div>
      {transcript && (
        <p className="mt-1 text-sm text-muted-foreground">
          “{normalizeTranscript(transcript)}”
        </p>
      )}
      <p className="font-medium">Echo is parsing…</p>
    </motion.div>
  );
}

function AnswerState({
  answer,
  speaking,
  supported,
  onReplay,
  onAskAgain,
  onClose,
}: {
  answer: AnswerState | null;
  speaking: boolean;
  supported: boolean;
  onReplay: () => void;
  onAskAgain: () => void;
  onClose: () => void;
}) {
  if (!answer) return null;
  return (
    <motion.div
      className="confirm-card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center gap-3">
        <div className="merchant-icon bg-emerald-soft text-emerald">
          <Volume2 size={18} />
        </div>
        <div>
          <p className="font-medium">{answer.headline}</p>
          <p className="text-sm text-muted-foreground">
            {answer.kind === "sum"
              ? "Voice query · Total"
              : answer.kind === "biggest"
                ? "Voice query · Biggest"
                : "Voice query · Recent"}
          </p>
        </div>
      </div>

      {answer.rows.length > 0 && (
        <ul className="mt-4 flex max-h-72 flex-col gap-1 overflow-y-auto">
          {answer.rows.map((row) => (
            <li
              key={row.id}
              className="flex items-center justify-between rounded-lg border border-border/60 bg-surface-2/60 px-3 py-2 text-sm"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-medium"
                  style={{
                    backgroundColor: "var(--surface-3, rgba(0,0,0,0.04))",
                  }}
                >
                  {row.icon}
                </span>
                <span className="truncate font-medium">{row.merchantRaw}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {row.date}
                </span>
                <span className="tabular-nums font-medium">
                  {money(row.amountMinor)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 flex gap-2">
        {supported && (
          <motion.button
            type="button"
            className="secondary-button !w-auto px-4"
            onClick={onReplay}
            whileTap={{ scale: 0.98 }}
            disabled={speaking}
          >
            <Volume2 size={16} /> {speaking ? "Speaking…" : "Replay"}
          </motion.button>
        )}
        <motion.button
          type="button"
          className="secondary-button !w-auto px-4"
          onClick={onAskAgain}
          whileTap={{ scale: 0.98 }}
        >
          <Mic size={16} /> Ask again
        </motion.button>
        <motion.button
          type="button"
          className="primary-button ml-auto"
          onClick={onClose}
          whileTap={{ scale: 0.99 }}
        >
          Done <Check size={17} />
        </motion.button>
      </div>
    </motion.div>
  );
}

function ConfirmState({
  amount,
  merchant,
  onPick,
  onSave,
  onSwitchToManual,
}: {
  amount: number;
  merchant: string;
  onPick: (v: number) => void;
  onSave: () => void;
  onSwitchToManual: () => void;
}) {
  return (
    <motion.div
      className="confirm-card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center gap-3">
        <div className="merchant-icon bg-orange-soft text-orange">
          {merchant.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-medium">{merchant}</p>
          <p className="text-sm text-muted-foreground">Voice capture · Today</p>
        </div>
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        I heard you spent{" "}
        <span className="font-medium text-foreground">{money(amount)}</span> on{" "}
        <span className="font-medium text-foreground">{merchant}</span>.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Which amount did you mean?
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[amount, Math.round((amount * 100) / 150) / 100].map((value, i) => (
          <motion.button
            key={`${value}-${i}`}
            type="button"
            className={`choice-button ${amount === value ? "choice-selected" : ""}`}
            onClick={() => onPick(value)}
            whileTap={{ scale: 0.97 }}
          >
            {money(value)}
          </motion.button>
        ))}
      </div>
      <motion.button
        type="button"
        className="primary-button mt-3"
        onClick={onSave}
        whileTap={{ scale: 0.99 }}
      >
        Remember this <Check size={17} />
      </motion.button>
      <motion.button
        type="button"
        className="secondary-button mt-2"
        onClick={onSwitchToManual}
        whileTap={{ scale: 0.99 }}
      >
        <Plus size={17} /> Edit manually
      </motion.button>
    </motion.div>
  );
}

function ManualState({
  amount,
  setAmount,
  merchant,
  setMerchant,
  categoryId,
  setCategoryId,
  categories,
  categoryName,
  parseError,
  onSave,
}: {
  amount: number;
  setAmount: (v: number) => void;
  merchant: string;
  setMerchant: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  categories: Array<{ id: string; name: string }>;
  categoryName: string;
  parseError: string | null;
  onSave: () => void;
}) {
  const valid = amount > 0 && merchant.trim().length > 0;
  return (
    <motion.div
      className="flex flex-col gap-4"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      {parseError && (
        <p className="rounded-lg border border-orange/30 bg-orange/10 px-3 py-2 text-xs text-orange">
          Voice parse didn&apos;t work: {parseError}
        </p>
      )}
      <AmountStepper value={amount} onChange={setAmount} />
      <Field
        label="What was it for?"
        placeholder="e.g. Lunch"
        leadingIcon={<Type size={16} />}
        autoFocus
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
      />
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <TagIcon size={12} /> Category
        </p>
        {categories.length > 0 ? (
          <Segmented
            ariaLabel="category"
            value={categoryId}
            onChange={setCategoryId}
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
            size="sm"
          />
        ) : (
          <p className="text-xs text-muted-foreground">Loading categories…</p>
        )}
      </div>
      <motion.button
        type="button"
        className="primary-button"
        disabled={!valid}
        onClick={onSave}
        whileTap={valid ? { scale: 0.99 } : undefined}
        style={!valid ? { opacity: 0.45, pointerEvents: "none" } : undefined}
      >
        Remember this <Check size={17} />
      </motion.button>
      <p className="text-center text-xs text-muted-foreground">
        Will be saved to {categoryName}
      </p>
    </motion.div>
  );
}
