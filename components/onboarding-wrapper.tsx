"use client";

import { useApp } from "@/context/AppContext";
import { Onboarding } from "@/components/onboarding";
import { useTransactions } from "@/lib/use-transactions";
import { Transaction } from "@/lib/schema";

export function OnboardingWrapper({ children }: { children: React.ReactNode }) {
  const { onboarded, setOnboarded, user, setUser } = useApp();
  const tx = useTransactions();

  const completeOnboarding = async (
    expense: Transaction,
    info: any,
  ) => {
    setUser(info);
    try {
      window.localStorage.setItem("echo-onboarded-v1", "true");
      window.localStorage.setItem("echo-user-info-v1", JSON.stringify(info));
    } catch {
      /* ignore */
    }

    try {
      await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: info.name,
          home_currency: info.currency,
          reminder_time: info.reminderTime,
        }),
      });
    } catch {
      /* offline ok; local-only */
    }

    await tx.add({
      accountId: expense.accountId,
      categoryId: expense.categoryId,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      direction: expense.direction,
      merchantRaw: expense.merchantRaw,
      merchantCanonical: expense.merchantCanonical,
      source: expense.source,
      confidence: expense.confidence,
      rawTranscript: expense.rawTranscript,
      transactedAt: expense.transactedAt,
      clarified: expense.clarified,
    });

    setOnboarded(true);
  };

  if (!onboarded) {
    return (
      <div className="app-viewport">
        <div className="app-frame">
          <Onboarding onComplete={completeOnboarding} />
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
