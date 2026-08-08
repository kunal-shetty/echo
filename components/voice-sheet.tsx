"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Check, Mic, Plus, Tag as TagIcon, Type } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Field } from "@/components/ui/field";
import { AmountStepper } from "@/components/ui/amount-stepper";
import { Segmented } from "@/components/ui/segmented";
import { money } from "@/lib/fmt";
import { toUiCategory, useCategories } from "@/lib/use-categories";
import { useSpeech } from "@/lib/use-speech";
import type { ParseResult } from "@/lib/parse";
import type { Transaction } from "@/lib/schema";

type CaptureMode = "listening" | "confirm" | "manual" | "parsing";

interface VoiceSheetProps {
  open: boolean;
  onClose: () => void;
  onSave: (expense: Transaction) => void;
}

export function VoiceSheet({ open, onClose, onSave }: VoiceSheetProps) {
  const { categories: rawCats } = useCategories();
  const categories = rawCats.map(toUiCategory);
  const [mode, setMode] = useState<CaptureMode>("listening");
  const [confirmedAmount, setConfirmedAmount] = useState(150);
  const [amount, setAmount] = useState(0);
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [transcript, setTranscript] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

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
        const res = await fetch("/api/parse-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: text }),
        });
        const data = (await res.json()) as ParseResult & { error?: string };
        if (!res.ok || data.error) {
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        if (typeof data.amount === "number" && data.amount > 0) {
          setConfirmedAmount(data.amount);
          setAmount(data.amount);
        }
        if (data.merchant) setMerchant(data.merchant);
        if (data.category) {
          const cat = categories.find(
            (c) => c.name.toLowerCase() === data.category!.toLowerCase(),
          );
          if (cat) setCategoryId(cat.id);
        }
        setMode("confirm");
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
    speech.reset();
    speech.start();
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const category =
    categories.find((c) => c.id === categoryId) ?? categories[0];

  const save = (amountValue: number, merchantValue: string) => {
    const cat = category;
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
      source: mode === "manual" ? "manual" : "voice",
      confidence: mode === "manual" ? null : 0.88,
      rawTranscript:
        mode === "manual" ? null : transcript || `spent ${amountValue} on ${merchantValue}`,
      clarified: false,
      icon: (merchantValue || "E").charAt(0).toUpperCase(),
      tone: cat?.tone ?? "neutral",
      date: "Today, just now",
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
              : undefined
      }
      subtitle={
        mode === "manual" || mode === "parsing" ? undefined : "Quick capture"
      }
    >
      <AnimatePresence mode="wait">
        {mode === "listening" ? (
          <ListeningState
            key="listening"
            transcript={speech.transcript}
            supported={speech.supported}
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
  error,
  onSkip,
  onRetry,
}: {
  transcript: string;
  supported: boolean;
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
          “{transcript}”
        </p>
      ) : (
        <p className="font-medium">Echo is listening</p>
      )}
      {supported ? (
        <p className="text-sm text-muted-foreground">
          {transcript ? "Hold to add more, or wait…" : "Try “Spent 150 on lunch.”"}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          Voice isn&apos;t supported in this browser.
        </p>
      )}
      {error && (
        <p className="mt-2 text-xs text-orange">{prettySpeechError(error)}</p>
      )}
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
        <p className="mt-1 text-sm text-muted-foreground">“{transcript}”</p>
      )}
      <p className="font-medium">Echo is parsing…</p>
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

function prettySpeechError(code: string): string {
  switch (code) {
    case "no-speech":
      return "Didn't catch that. Try again?";
    case "audio-capture":
      return "No microphone found.";
    case "not-allowed":
      return "Microphone access denied.";
    case "network":
      return "Network error. Try again.";
    default:
      return `Speech error: ${code}`;
  }
}
