"use client";

import { useEffect, useState, useRef } from "react";
import { Mic } from "lucide-react";
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
import { useApp } from "@/context/AppContext";
import type { Transaction } from "@/lib/schema";

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    user,
    addMode,
    setAddMode,
    editing,
    setEditing,
    voiceOpen,
    setVoiceOpen,
    toast,
    setToast,
  } = useApp();

  const voiceSheetRef = useRef<any>(null);
  const tx = useTransactions();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const el = document.querySelector(".app-content");
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 12);
    onScroll();
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

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
    void tx.refresh();
    setVoiceOpen(false);
    setToast(`Updated · ${expense.merchantRaw}`);
  };

  const handleDeleted = (id: string) => {
    void tx.refresh();
    setVoiceOpen(false);
    setToast("Deleted");
  };

  return (
    <div className="app-viewport">
      <div className="app-frame">
        <div className="app-content">
          {children}
        </div>
        <BottomNav
          onVoice={() => {
            setVoiceOpen(true);
            // Request mic access via the ref.
            // Wrap in setTimeout to ensure the sheet is mounted before calling start.
            setTimeout(() => voiceSheetRef.current?.start(), 0);
          }}
        />
        <VoiceSheet
          ref={voiceSheetRef}
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
          visible={true} // Now controlled by the page or just always visible
          onPickSingle={() => setAddMode("single")}
          onPickBulk={() => setAddMode("bulk")}
          onPickCategory={() => setAddMode("category")}
        />
        <Toast message={toast} onDismiss={() => setToast(null)} />
      </div>
    </div>
  );
}
