"use client";

import { useEffect, useState, forwardRef, useImperativeHandle } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Mic, Plus, Tag as TagIcon, Type, Volume2, CircleDollarSign } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Field } from "@/components/ui/field";
import { AmountStepper } from "@/components/ui/amount-stepper";
import { Segmented } from "@/components/ui/segmented";
import { money, normalizeTranscript } from "@/lib/fmt";
import { toUiCategory, useCategories } from "@/lib/use-categories";
import { useSpeech } from "@/lib/use-speech";
import { useSpeechSynth } from "@/lib/use-speech-synth";
import { executeNlqSpec } from "@/lib/nlq-executor";
import { useTransactions } from "@/lib/use-transactions";
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

export const VoiceSheet = forwardRef(({
  open,
  onClose,
  onSave,
  onUpdated,
  onDeleted,
}, ref: any) => {
  const [sessionId] = useState(() => Math.random().toString(36).substring(7));
  const { categories: rawCats } = useCategories();
  const categories = rawCats.map(toUiCategory);
  const { transactions, provider } = useTransactions();
  const [mode, setMode] = useState<CaptureMode>("listening");
  const [confirmedAmount, setConfirmedAmount] = useState(150);
  const [amount, setAmount] = useState(0);
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [transcript, setTranscript] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AnswerState | null>(null);
  const synth = useSpeechSynth();

  const speech = useSpeech({
    onFinal: async (text) => {
      setTranscript(text);
      if (!text) return;
      setMode("parsing");
      try {
        const lowered = text.toLowerCase();
        const looksLikeQuestion =
          /^(how much|what (did|was|have)|show me|total|sum|biggest|largest|most|list)/i.test(
            lowered,
          );
        if (looksLikeQuestion) {
          // Determine if we should query local or API storage
          const isLocal = provider instanceof (await import("@/lib/storage-providers").then(m => m.LocalStorageProvider));

          if (isLocal) {
            // Hybrid Flow for Local Storage:
            // 1. Parse the intent on the server
            const parseRes = await fetch("/api/ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transcript: text, parseOnly: true }),
            });
            const parseData = await parseRes.json() as { result: ParseResult };
            const parsed = parseData.result;

            // 2. Execute the query locally
            let resultData: { total: number | null; rows: Transaction[] };
            if (parsed.nlqSpec) {
              resultData = executeNlqSpec(transactions, parsed.nlqSpec);
            } else {
              // Fallback to basic filtering if no nlqSpec
              const filtered = transactions.filter(t => {
                if (parsed.queryCategory) {
                  if (!t.categoryName?.toLowerCase().includes(parsed.queryCategory!.toLowerCase())) return false;
                }
                if (parsed.queryMerchant) {
                  if (!t.merchantRaw.toLowerCase().includes(parsed.queryMerchant!.toLowerCase())) return false;
                }
                if (parsed.queryDirection && t.direction !== parsed.queryDirection) return false;
                return true;
              });
              const total = filtered.reduce((acc, t) => acc + Number(t.amountMinor), 0);
              resultData = { total, rows: filtered };
            }

            // 3. Generate conversational response on the server
            const respondRes = await fetch("/api/ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript: text,
                respondOnly: true,
                result: {
                  total: resultData.total,
                  rows: resultData.rows,
                  kind: parsed.queryKind ?? "sum",
                  range: parsed.queryRange ?? "all",
                  headline: "", // Server will generate this
                  spoken: ""
                }
              }),
            });
            const respondData = await respondRes.json() as { spoken: string };

            setAnswer({
              headline: `Local Result: ${resultData.total ? money(resultData.total) : "No data"}`,
              spoken: respondData.spoken,
              rows: resultData.rows,
              kind: parsed.queryKind ?? "sum",
            });
            setMode("answer");
            if (respondData.spoken) synth.speak(respondData.spoken);
            return;
          } else {
            // Standard Flow for API Storage
            const askRes = await fetch("/api/ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ transcript: text, sessionId }),
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
            if (askData.query.spoken) synth.speak(askData.query.spoken);
            return;
          }
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
            direction: "expense" | "income";
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

        if (result.action === "query") {
          const askRes = await fetch("/api/ask", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript: text, sessionId }),
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
        if (
          (result.action === "update" || result.action === "delete") &&
          data.warning
        ) {
          setParseError(data.warning);
          setMode("manual");
          return;
        }

        const draft = data.draft;
        if (draft) {
          setConfirmedAmount(draft.amount);
          setAmount(draft.amount);
          setMerchant(draft.merchant);
          if (draft.categoryId) setCategoryId(draft.categoryId);
          if (draft.direction) setDirection(draft.direction);
        } else {
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
          speech.stop();
          if (data.transaction) {
            onSave(data.transaction);
          } else if (data.draft) {
            saveFromDraft(data.draft);
          }
          onClose();
        } else {
          setMode("confirm");
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Parse failed");
        setMode("manual");
      }
    },
  });

  useImperativeHandle(ref, () => ({
    start: () => {
      speech.reset();
      speech.start();
      setMode("listening");
    },
    stop: () => {
      speech.stop();
    },
  }));

  // Reset state when the sheet opens
  useEffect(() => {
    if (!open) return;
    setMode("listening");
    setMerchant("");
    setAmount(0);
    setConfirmedAmount(150);
    setDirection("expense");
    setTranscript("");
    setParseError(null);
    setAnswer(null);
    synth.cancel();
    speech.reset();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Stop any TTS when the sheet closes so it doesn't keep playing in the bg.
  useEffect(() => {
    if (open) return;
    synth.cancel();
  }, [open, synth]);

  const category =
    categories.find((c) => c.id === categoryId) ?? categories[0];

  const saveFromDraft = (draft: {
    amount: number;
    merchant: string;
    categoryId: string | null;
    direction: "expense" | "income";
    transactedAt: string;
    rawTranscript: string;
    confidence: number;
  }) => {
    const cat = categories.find((c) => c.id === draft.categoryId);
    const expense: Transaction = {
      id: `local-${Date.now()}`,
      userId: "user-1",
      accountId: "acc-default",
      categoryId: draft.categoryId,
      amountMinor: draft.amount,
      currency: "INR",
      direction: draft.direction,
      merchantRaw: draft.merchant,
      merchantCanonical: draft.merchant,
      transactedAt: draft.transactedAt,
      createdAt: new Date().toISOString(),
      source: "voice",
      confidence: draft.confidence,
      rawTranscript: draft.rawTranscript,
      clarified: false,
      icon: draft.merchant.charAt(0).toUpperCase(),
      tone: cat?.tone ?? "neutral",
      date: "Today, just now",
      categoryName: cat?.name ?? null,
    };
    speech.stop();
    onSave(expense);
  };

  const save = (

    amountValue: number,
    merchantValue: string,
    confidenceOverride?: number | null,
  ) => {
    const cat = category;
    const isManual = mode === "manual";
    const fallbackName = direction === "income" ? "Income" : "Expense";
    const expense: Transaction = {
      id: `local-${Date.now()}`,
      userId: "user-1",
      accountId: "acc-default",
      categoryId: cat?.id ?? null,
      amountMinor: amountValue,
      currency: "INR",
      direction,
      merchantRaw: merchantValue || fallbackName,
      merchantCanonical: merchantValue || fallbackName,
      transactedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      source: isManual ? "manual" : "voice",
      confidence: isManual ? null : confidenceOverride ?? 0.88,
      rawTranscript: isManual
        ? null
        : transcript || `spent ${amountValue} on ${merchantValue}`,
      clarified: false,
      icon: (merchantValue || fallbackName).charAt(0).toUpperCase(),
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
            merchant={merchant || (direction === "income" ? "Income" : "Lunch")}
            direction={direction}
            setDirection={setDirection}
            onPick={setConfirmedAmount}
            onSave={() => save(confirmedAmount, merchant || (direction === "income" ? "Income" : "Lunch"))}
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
            direction={direction}
            setDirection={setDirection}
            categories={categories}
            categoryName={category?.name ?? "your account"}
            parseError={parseError}
            onSave={() => save(amount, merchant)}
          />
        )}
      </AnimatePresence>
    </BottomSheet>
  );
});

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
                  {row.icon === "CircleDollarSign" ? <CircleDollarSign size={14} /> : row.icon}
                </span>
                <span className="truncate font-medium">{row.merchantRaw}</span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-xs text-muted-foreground">
                  {row.date}
                </span>
                <span className="tabular-nums font-medium">
                  {row.direction === "income" ? "+" : "−"}
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
  direction,
  setDirection,
  onPick,
  onSave,
  onSwitchToManual,
}: {
  amount: number;
  merchant: string;
  direction: "expense" | "income";
  setDirection: (v: "expense" | "income") => void;
  onPick: (v: number) => void;
  onSave: () => void;
  onSwitchToManual: () => void;
}) {
  const isIncome = direction === "income";
  return (
    <motion.div
      className="confirm-card"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-center gap-3">
        <div
          className={`merchant-icon ${
            isIncome
              ? "bg-emerald-soft text-emerald"
              : "bg-orange-soft text-orange"
          }`}
        >
          {merchant.charAt(0).toUpperCase()}
        </div>
        <div>
          <p className="font-medium">{merchant}</p>
          <p className="text-sm text-muted-foreground">
            Voice capture · Today
          </p>
        </div>
      </div>
      <div className="mt-4">
        <Segmented<"expense" | "income">
          ariaLabel="confirm-direction"
          value={direction}
          onChange={setDirection}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
          ]}
          size="sm"
        />
      </div>
      <p className="mt-5 text-sm text-muted-foreground">
        I heard you {isIncome ? "earned" : "spent"}{" "}
        <span className="font-medium text-foreground">{money(amount)}</span>{" "}
        {isIncome ? "from" : "on"}{" "}
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
  direction,
  setDirection,
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
  direction: "expense" | "income";
  setDirection: (v: "expense" | "income") => void;
  categories: Array<{ id: string; name: string }>;
  categoryName: string;
  parseError: string | null;
  onSave: () => void;
}) {
  const valid = amount > 0 && merchant.trim().length > 0;
  const isIncome = direction === "income";
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
      <Segmented<"expense" | "income">
        ariaLabel="manual-direction"
        value={direction}
        onChange={setDirection}
        options={[
          { value: "expense", label: "Expense" },
          { value: "income", label: "Income" },
        ]}
        size="sm"
      />
      <AmountStepper value={amount} onChange={setAmount} />
      <Field
        label={isIncome ? "What did you receive?" : "What was it for?"}
        placeholder={isIncome ? "e.g. Salary" : "e.g. Lunch"}
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
