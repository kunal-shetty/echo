"use client";

import { useEffect, useState } from "react";
import { ViewTransition } from "react";
import { Mic } from "lucide-react";
import { Onboarding, type UserInfo } from "@/components/onboarding";
import { BottomNav } from "@/components/bottom-nav";
import { VoiceSheet } from "@/components/voice-sheet";
import { Toast } from "@/components/ui/toast";
import { HomeScreen } from "@/components/home/home-screen";
import { ActivityScreen } from "@/components/activity/activity-screen";
import { InsightsScreen } from "@/components/insights/insights-screen";
import { ProfileScreen } from "@/components/profile/profile-screen";
import { Fab } from "@/components/fab";
import { ManualAddSheet } from "@/components/manual-add-sheet";
import { BulkAddSheet } from "@/components/bulk-add-sheet";
import { CategorySheet } from "@/components/category-sheet";
import { useTransactions } from "@/lib/use-transactions";
import type { Screen, Transaction } from "@/lib/schema";

const ONBOARDING_KEY = "echo-onboarded-v1";
const USER_KEY = "echo-user-info-v1";

const DEFAULT_USER: UserInfo = {
  name: "",
  currency: "INR",
  reminderTime: "evening",
};

type AddMode = "single" | "bulk" | "category" | null;

export function EchoApp() {
  const [ready, setReady] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [user, setUser] = useState<UserInfo>(DEFAULT_USER);
  const [addMode, setAddMode] = useState<AddMode>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  const tx = useTransactions();

  // Hydrate onboarding + user from localStorage on mount.
  useEffect(() => {
    try {
      const done = window.localStorage.getItem(ONBOARDING_KEY);
      const userRaw = window.localStorage.getItem(USER_KEY);
      if (userRaw) {
        const parsed = JSON.parse(userRaw) as Partial<UserInfo>;
        setUser({ ...DEFAULT_USER, ...parsed });
      }
      setOnboarded(done === "true");
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  // Track scroll on the .app-content element to give the header a backdrop.
  useEffect(() => {
    if (!onboarded) return;
    const el = document.querySelector(".app-content");
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 12);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [onboarded, screen]);

  const persistExpense = async (expense: Transaction) => {
    const saved = await tx.add({
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
    setVoiceOpen(false);
    setToast(`Saved · ${expense.merchantRaw}`);
    return saved;
  };

  const handleUpdated = (expense: Transaction) => {
    // Refresh the list so the home/activity screens reflect the change.
    void tx.refresh();
    setVoiceOpen(false);
    setToast(`Updated · ${expense.merchantRaw}`);
  };

  const handleDeleted = (id: string) => {
    void tx.refresh();
    setVoiceOpen(false);
    setToast("Deleted");
  };

  const completeOnboarding = async (
    expense: Transaction,
    info: UserInfo,
  ) => {
    setUser(info);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, "true");
      window.localStorage.setItem(USER_KEY, JSON.stringify(info));
    } catch {
      /* ignore */
    }
    // Persist user prefs server-side if Supabase is configured.
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
    await persistExpense(expense);
    setOnboarded(true);
  };

  const updateUser = (patch: Partial<UserInfo>) => {
    setUser((u) => {
      const next = { ...u, ...patch };
      try {
        window.localStorage.setItem(USER_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
    // Best-effort server sync.
    const serverPatch: Record<string, unknown> = {};
    if (patch.name !== undefined) serverPatch.display_name = patch.name;
    if (patch.currency !== undefined) serverPatch.home_currency = patch.currency;
    if (patch.reminderTime !== undefined)
      serverPatch.reminder_time = patch.reminderTime;
    if (Object.keys(serverPatch).length === 0) return;
    void fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(serverPatch),
    }).catch(() => {});
  };

  if (!ready) {
    return (
      <div className="app-viewport">
        <div className="app-frame grid place-items-center">
          <div className="voice-orb listening">
            <Mic size={26} />
          </div>
        </div>
      </div>
    );
  }

  if (!onboarded) {
    return (
      <div className="app-viewport">
        <div className="app-frame">
          <Onboarding onComplete={completeOnboarding} />
        </div>
      </div>
    );
  }

  return (
    <div className="app-viewport">
      <div className="app-frame">
        <div className="app-content">
          <ViewTransition name="echo-screen">
            <div key={screen}>
              {screen === "home" && (
                <HomeScreen
                  setScreen={setScreen}
                  onVoice={() => setVoiceOpen(true)}
                  expenses={tx.transactions}
                  loading={tx.loading}
                  configured={tx.configured}
                  scrolled={scrolled}
                  user={user}
                  onRowClick={(item) => setEditing(item)}
                />
              )}
              {screen === "activity" && (
                <ActivityScreen
                  onVoice={() => setVoiceOpen(true)}
                  onAddManually={() => setAddMode("single")}
                  expenses={tx.transactions}
                  loading={tx.loading}
                  configured={tx.configured}
                  scrolled={scrolled}
                  onRowClick={(item) => setEditing(item)}
                />
              )}
              {screen === "insights" && (
                <InsightsScreen
                  onVoice={() => setVoiceOpen(true)}
                  expenses={tx.transactions}
                  loading={tx.loading}
                  configured={tx.configured}
                  scrolled={scrolled}
                />
              )}
              {screen === "profile" && (
                <ProfileScreen
                  onVoice={() => setVoiceOpen(true)}
                  scrolled={scrolled}
                  user={user}
                  onUpdateUser={updateUser}
                />
              )}
            </div>
          </ViewTransition>
        </div>
        <BottomNav
          screen={screen}
          setScreen={setScreen}
          onVoice={() => setVoiceOpen(true)}
        />
        <VoiceSheet
          open={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onSave={persistExpense}
          onUpdated={handleUpdated}
          onDeleted={handleDeleted}
        />
        <ManualAddSheet
          open={addMode === "single"}
          mode="add"
          onClose={() => setAddMode(null)}
          onSaved={(saved) => {
            setAddMode(null);
            setToast(`Saved · ${saved.merchantRaw}`);
          }}
        />
        <ManualAddSheet
          open={editing != null}
          mode="edit"
          initial={editing ?? undefined}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            setToast(`Updated · ${saved.merchantRaw}`);
          }}
        />
        <BulkAddSheet
          open={addMode === "bulk"}
          onClose={() => setAddMode(null)}
          onComplete={(inserted, failures) => {
            setAddMode(null);
            if (inserted === 0) {
              setToast("Nothing imported");
            } else if (failures > 0) {
              setToast(
                `Imported ${inserted} ${inserted === 1 ? "memory" : "memories"} (${failures} skipped)`,
              );
            } else {
              setToast(
                `Imported ${inserted} ${inserted === 1 ? "memory" : "memories"}`,
              );
            }
          }}
        />
        <CategorySheet
          open={addMode === "category"}
          onClose={() => setAddMode(null)}
          onSaved={(cat) => {
            setAddMode(null);
            setToast(`Saved · ${cat.name}`);
          }}
        />
        <Fab
          visible={screen === "home" || screen === "activity"}
          onPickSingle={() => setAddMode("single")}
          onPickBulk={() => setAddMode("bulk")}
          onPickCategory={() => setAddMode("category")}
        />
        <Toast message={toast} onDismiss={() => setToast(null)} />
      </div>
    </div>
  );
}