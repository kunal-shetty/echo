"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Check, Mic, Plus, Sparkles } from "lucide-react";
import { Logo } from "@/components/shared";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { money, normalizeTranscript } from "@/lib/fmt";
import { toUiCategory, useCategories } from "@/lib/use-categories";
import { useSpeech } from "@/lib/use-speech";
import type { ParseResult } from "@/lib/parse";
import type { Transaction } from "@/lib/schema";

type CaptureMode = "listening" | "parsing" | "confirm" | "manual";

export interface UserInfo {
  name: string;
  currency: "INR" | "USD" | "EUR" | "GBP";
  reminderTime: "morning" | "evening" | "off";
}

interface OnboardingProps {
  onComplete: (expense: Transaction, user: UserInfo) => void;
}

const CURRENCY_OPTIONS: UserInfo["currency"][] = ["INR", "USD", "EUR", "GBP"];
const REMINDER_OPTIONS: UserInfo["reminderTime"][] = [
  "morning",
  "evening",
  "off",
];

export function Onboarding({ onComplete }: OnboardingProps) {
  const { categories: rawCats } = useCategories();
  const categories = rawCats.map(toUiCategory);
  const [step, setStep] = useState<
    "welcome" | "capture" | "remembered" | "name" | "preferences" | "done"
  >("welcome");
  const [mode, setMode] = useState<CaptureMode>("listening");

  const [amount, setAmount] = useState(0);
  const [confirmedAmount, setConfirmedAmount] = useState(180);
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [transcript, setTranscript] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  const [user, setUser] = useState<UserInfo>({
    name: "",
    currency: "INR",
    reminderTime: "evening",
  });

  // Once categories load, ensure categoryId is valid.
  useEffect(() => {
    if (categories.length === 0) return;
    if (!categories.find((c) => c.id === categoryId)) {
      setCategoryId(categories[0].id);
    }
  }, [categories, categoryId]);

  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        // Prefill whatever the model returned, even on low confidence,
        // so the user only has to fix what's wrong.
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
        // Tiered routing on confidence:
        //   < 0.3  → too uncertain, send to manual entry.
        //   >= 0.7 → high confidence, advance past the confirm card.
        //   0.3..0.7 → show the confirm card so the user can sanity-check.
        if (data.confidence < 0.3 || data.amount == null || !data.merchant) {
          setParseError(
            "Couldn't parse that confidently. Please confirm below.",
          );
          setMode("manual");
        } else if (data.confidence >= 0.7) {
          handleExpenseSave(data.amount, data.merchant);
        } else {
          setMode("confirm");
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Parse failed");
        setMode("manual");
      }
    },
  });

  // Auto-start listening when entering capture.
  useEffect(() => {
    if (step === "capture" && mode === "listening") {
      speech.reset();
      speech.start();
    }
    return () => {
      speech.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  useEffect(() => {
    return () => {
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
    };
  }, []);

  const finishOnboarding = () => {
    const finalExpense = buildExpense(confirmedAmount, merchant || "Lunch");
    onComplete(finalExpense, user);
  };

  const buildExpense = (
    amountValue: number,
    merchantValue: string,
  ): Transaction => {
    const cat = categories.find((c) => c.id === categoryId) ?? categories[0];
    return {
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
        mode === "manual"
          ? null
          : transcript || `spent ${amountValue} on ${merchantValue}`,
      clarified: false,
      icon: (merchantValue || "E").charAt(0).toUpperCase(),
      tone: cat?.tone ?? "neutral",
      date: "Today, just now",
    };
  };

  const handleExpenseSave = (
    amountValue: number,
    merchantValue: string,
  ) => {
    const finalAmount = amountValue > 0 ? amountValue : confirmedAmount;
    const finalMerchant = merchantValue || "Lunch";
    speech.stop();
    setStep("remembered");
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = setTimeout(() => setStep("name"), 1100);
    // Stash so we can re-use on the final step without rebuilding
    setConfirmedAmount(finalAmount);
    setMerchant(finalMerchant);
  };

  const handleFinish = () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    speech.stop();
    finishOnboarding();
  };

  return (
    <div className="onboarding">
      <div className="onboarding-top">
        <Logo />
        <span className="eyebrow">Your financial memory</span>
      </div>
      <AnimatePresence mode="wait">
        {step === "welcome" && (
          <motion.div
            key="welcome"
            className="onboarding-copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              className="welcome-glyph"
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 320, damping: 18 }}
            >
              <Sparkles size={26} />
            </motion.div>
            <p className="eyebrow text-emerald">No spreadsheets. No guilt.</p>
            <h1>Never wonder where your money went again.</h1>
            <p>
              Echo remembers the little things you spend on, so you can ask
              better questions later.
            </p>
            <motion.button
              type="button"
              className="primary-button"
              onClick={() => setStep("capture")}
              whileTap={{ scale: 0.98 }}
              whileHover={{ y: -1 }}
              transition={{ type: "spring", stiffness: 380, damping: 22 }}
            >
              Start with one thing <ArrowUpRight size={18} />
            </motion.button>
          </motion.div>
        )}

        {step === "capture" && (
          <motion.div
            key="capture"
            className="onboarding-copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="eyebrow text-emerald">Start with today</p>
            <h1>Tell me one thing you spent money on today.</h1>
            <p>
              Say it naturally. Echo will listen, parse it with AI, and remember
              it for you.
            </p>
            <AnimatePresence mode="wait">
              {mode === "listening" && (
                <ListeningPanel
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
                    setMode("listening");
                  }}
                />
              )}
              {mode === "parsing" && (
                <ParsingPanel
                  key="parsing"
                  transcript={transcript || speech.transcript}
                />
              )}
              {mode === "confirm" && (
                <ConfirmPanel
                  key="confirm"
                  amount={confirmedAmount}
                  merchant={merchant || "Lunch"}
                  onPick={setConfirmedAmount}
                  onSave={() => handleExpenseSave(confirmedAmount, merchant)}
                  onSwitchToManual={() => setMode("manual")}
                />
              )}
              {mode === "manual" && (
                <ManualPanel
                  key="manual"
                  amount={amount}
                  setAmount={setAmount}
                  merchant={merchant}
                  setMerchant={setMerchant}
                  categoryId={categoryId}
                  setCategoryId={setCategoryId}
                  categories={categories}
                  parseError={parseError}
                  onSave={() => handleExpenseSave(amount, merchant)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {step === "remembered" && (
          <motion.div
            key="remembered"
            className="onboarding-copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              className="welcome-glyph success"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 320,
                damping: 16,
                delay: 0.05,
              }}
            >
              <Check size={26} />
            </motion.div>
            <p className="eyebrow text-emerald">Remembered</p>
            <h1>Got it.</h1>
            <p>
              That&apos;s your first memory. Now tell Echo a little about you so
              it can greet you right.
            </p>
          </motion.div>
        )}

        {step === "name" && (
          <motion.div
            key="name"
            className="onboarding-copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="eyebrow text-emerald">A little about you</p>
            <h1>What should Echo call you?</h1>
            <p>Just a first name is enough. You can change this anytime.</p>
            <Field
              label="Your first name"
              placeholder="e.g. Kunal"
              autoFocus
              value={user.name}
              onChange={(e) =>
                setUser((u) => ({ ...u, name: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && user.name.trim()) {
                  setStep("preferences");
                }
              }}
            />
            <motion.button
              type="button"
              className="primary-button"
              onClick={() => setStep("preferences")}
              disabled={!user.name.trim()}
              whileTap={{ scale: 0.98 }}
              style={
                !user.name.trim()
                  ? { opacity: 0.45, pointerEvents: "none" }
                  : undefined
              }
            >
              Continue <ArrowUpRight size={18} />
            </motion.button>
          </motion.div>
        )}

        {step === "preferences" && (
          <motion.div
            key="preferences"
            className="onboarding-copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <p className="eyebrow text-emerald">Last thing</p>
            <h1>How would you like Echo to behave?</h1>
            <p>Pick what feels right. You can change this later.</p>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Home currency
              </p>
              <Segmented
                ariaLabel="currency"
                value={user.currency}
                onChange={(v) =>
                  setUser((u) => ({
                    ...u,
                    currency: v as UserInfo["currency"],
                  }))
                }
                options={CURRENCY_OPTIONS.map((c) => ({
                  value: c,
                  label: c,
                }))}
                size="sm"
              />
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                Memory nudge
              </p>
              <Segmented
                ariaLabel="reminder"
                value={user.reminderTime}
                onChange={(v) =>
                  setUser((u) => ({
                    ...u,
                    reminderTime: v as UserInfo["reminderTime"],
                  }))
                }
                options={REMINDER_OPTIONS.map((r) => ({
                  value: r,
                  label:
                    r === "off" ? "Off" : r === "morning" ? "Morning" : "Evening",
                }))}
                size="sm"
              />
            </div>
            <motion.button
              type="button"
              className="primary-button"
              onClick={() => {
                setStep("done");
                if (advanceTimer.current) clearTimeout(advanceTimer.current);
                advanceTimer.current = setTimeout(handleFinish, 1100);
              }}
              whileTap={{ scale: 0.98 }}
            >
              That&apos;s me <Check size={18} />
            </motion.button>
          </motion.div>
        )}

        {step === "done" && (
          <motion.div
            key="done"
            className="onboarding-copy"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          >
            <motion.div
              className="welcome-glyph success"
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                type: "spring",
                stiffness: 320,
                damping: 16,
                delay: 0.05,
              }}
            >
              <Check size={26} />
            </motion.div>
            <p className="eyebrow text-emerald">All set</p>
            <h1>Welcome, {user.name || "friend"}.</h1>
            <p>
              Echo&apos;s ready. Tap the mic to remember anything — from coffee
              to cab fares.
            </p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="onboarding-footer">
        <span className="size-2 rounded-full bg-emerald" />
        <span>Private by default. Saved on this device.</span>
      </div>
    </div>
  );
}

function ListeningPanel({
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
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
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
      {error && <p className="mt-2 text-xs text-orange">Speech: {error}</p>}
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

function ParsingPanel({ transcript }: { transcript: string }) {
  return (
    <motion.div
      className="onboarding-listening"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.24 }}
    >
      <div
        className="voice-orb listening"
        style={{ viewTransitionName: "echo-orb" }}
      >
        <span className="orb-pulse-ring" />
        <span className="orb-pulse-ring" />
        <span className="orb-pulse-ring" />
      </div>
      {transcript && (
        <p className="text-sm text-muted-foreground">
          “{normalizeTranscript(transcript)}”
        </p>
      )}
      <p className="font-medium">Echo is parsing with AI…</p>
    </motion.div>
  );
}

function ConfirmPanel({
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
  const alt = Math.round((amount * 100) / 150) / 100;
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
        <span className="font-medium text-foreground">{money(amount)}</span>{" "}
        on <span className="font-medium text-foreground">{merchant}</span>.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        Did you mean {money(amount)} or {money(alt)}?
      </p>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <motion.button
          type="button"
          className="choice-button choice-selected"
          onClick={() => onPick(amount)}
          whileTap={{ scale: 0.97 }}
        >
          {money(amount)}
        </motion.button>
        <motion.button
          type="button"
          className="choice-button"
          onClick={() => onPick(alt)}
          whileTap={{ scale: 0.97 }}
        >
          {money(alt)}
        </motion.button>
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

function ManualPanel({
  amount,
  setAmount,
  merchant,
  setMerchant,
  categoryId,
  setCategoryId,
  categories,
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
  parseError: string | null;
  onSave: () => void;
}) {
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
          Voice parse didn&apos;t work: {parseError}. You can add it manually
          below.
        </p>
      )}
      <Field
        label="What was it for?"
        placeholder="e.g. Lunch"
        autoFocus
        value={merchant}
        onChange={(e) => setMerchant(e.target.value)}
      />
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          How much?
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full border border-border bg-surface-2 text-muted-foreground"
            onClick={() => setAmount(Math.max(0, amount - 10))}
            aria-label="Decrease"
          >
            −
          </button>
          <input
            type="number"
            inputMode="decimal"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value) || 0)}
            placeholder="150"
            className="min-w-0 flex-1 rounded-xl border border-border bg-surface-2 px-3 py-3 text-center text-base tabular-nums outline-none focus:border-emerald/60"
          />
          <button
            type="button"
            className="grid size-11 place-items-center rounded-full border border-border bg-surface-2 text-muted-foreground"
            onClick={() => setAmount(amount + 10)}
            aria-label="Increase"
          >
            +
          </button>
        </div>
      </div>
      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">
          Category
        </p>
        {categories.length > 0 ? (
          <Segmented
            ariaLabel="onboarding-category"
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
        disabled={!(amount > 0 && merchant.trim())}
        onClick={onSave}
        whileTap={{ scale: 0.99 }}
        style={
          !(amount > 0 && merchant.trim())
            ? { opacity: 0.45, pointerEvents: "none" }
            : undefined
        }
      >
        Remember this <Check size={17} />
      </motion.button>
    </motion.div>
  );
}
