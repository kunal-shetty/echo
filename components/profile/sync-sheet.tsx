"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, KeyRound, Mail } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Field } from "@/components/ui/field";
import { useRemoteUser } from "@/lib/use-remote-user";

type Step = "email" | "code" | "done";

export function SyncSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { user, refresh } = useRemoteUser();
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendTimer, setResendTimer] = useState(0);
  const [migrated, setMigrated] = useState(false);

  // Reset state every time the sheet opens.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep("email");
        setEmail("");
        setCode("");
        setError(null);
        setMigrated(false);
        setResendTimer(0);
      }, 250);
      return () => clearTimeout(t);
    }
    // When opening, jump straight to "done" if already verified.
    if (user?.email_verified_at) {
      setStep("done");
      setEmail(user.email ?? "");
    }
  }, [open, user]);

  // Resend cooldown timer.
  useEffect(() => {
    if (resendTimer <= 0) return;
    const t = setTimeout(() => setResendTimer((v) => v - 1), 1000);
    return () => clearTimeout(t);
  }, [resendTimer]);

  const start = async () => {
    if (sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!res.ok) {
        setError(json.error ?? `Could not send code (${res.status})`);
        return;
      }
      setStep("code");
      setResendTimer(60);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setSending(false);
    }
  };

  const verify = async () => {
    if (verifying || code.length < 6) return;
    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        migrated?: boolean;
      };
      if (!res.ok) {
        setError(json.error ?? `Verification failed (${res.status})`);
        return;
      }
      setMigrated(Boolean(json.migrated));
      setStep("done");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network error");
    } finally {
      setVerifying(false);
    }
  };

  const subtitle =
    step === "email"
      ? "Use Echo on another device"
      : step === "code"
        ? "Check your inbox"
        : "Synced";

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Sync across devices"
      subtitle={subtitle}
    >
      <AnimatePresence mode="wait">
        {step === "email" && (
          <motion.div
            key="email"
            className="flex flex-col gap-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24 }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              Enter your email and we&apos;ll send a 6-digit code. Use the same
              email on another device to bring this account&apos;s memories with
              you.
            </p>
            <Field
              label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              type="email"
              autoFocus
              autoComplete="email"
            />
            {error && (
              <p className="text-xs text-orange">{error}</p>
            )}
            <motion.button
              type="button"
              className="primary-button"
              disabled={!email.includes("@") || sending}
              onClick={start}
              whileTap={{ scale: 0.99 }}
              style={
                !email.includes("@") || sending
                  ? { opacity: 0.45, pointerEvents: "none" }
                  : undefined
              }
            >
              <Mail size={17} />
              {sending ? "Sending…" : "Send code"}
            </motion.button>
          </motion.div>
        )}

        {step === "code" && (
          <motion.div
            key="code"
            className="flex flex-col gap-4"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.24 }}
          >
            <p className="text-sm leading-6 text-muted-foreground">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-foreground">{email}</span>.
              It expires in 10 minutes.
            </p>
            <Field
              label="Verification code"
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
              }
              placeholder="123456"
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
            {error && <p className="text-xs text-orange">{error}</p>}
            <motion.button
              type="button"
              className="primary-button"
              disabled={code.length < 6 || verifying}
              onClick={verify}
              whileTap={{ scale: 0.99 }}
              style={
                code.length < 6 || verifying
                  ? { opacity: 0.45, pointerEvents: "none" }
                  : undefined
              }
            >
              <KeyRound size={17} />
              {verifying ? "Verifying…" : "Verify"}
            </motion.button>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <button
                type="button"
                className="transition-colors hover:text-foreground"
                onClick={() => setStep("email")}
              >
                Change email
              </button>
              <button
                type="button"
                disabled={resendTimer > 0 || sending}
                onClick={start}
                className="transition-colors hover:text-foreground disabled:opacity-50"
              >
                {resendTimer > 0
                  ? `Resend in ${resendTimer}s`
                  : "Resend code"}
              </button>
            </div>
          </motion.div>
        )}

        {step === "done" && (
          <motion.div
            key="done"
            className="flex flex-col items-center gap-3 py-2 text-center"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 320,
              damping: 22,
            }}
          >
            <div className="grid size-12 place-items-center rounded-full bg-emerald/15 text-emerald">
              <Check size={22} />
            </div>
            <p className="text-base font-medium">Synced</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {user?.email ? (
                <>
                  This device is now linked to{" "}
                  <span className="font-medium text-foreground">
                    {user.email}
                  </span>
                  . Sign in there with the same email to bring your memories
                  over.
                </>
              ) : (
                <>Echo will remember you on this device.</>
              )}
            </p>
            {migrated && (
              <p className="max-w-xs text-xs text-muted-foreground">
                We also merged data from another device that already used this
                email.
              </p>
            )}
            <motion.button
              type="button"
              className="secondary-button mt-2"
              onClick={onClose}
              whileTap={{ scale: 0.98 }}
            >
              Done
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </BottomSheet>
  );
}
