"use client";

import { useEffect, useRef } from "react";
import { BottomNav } from "@/components/bottom-nav";
import { VoiceSheet, type VoiceSheetHandle } from "@/components/voice-sheet";
import { Toast } from "@/components/ui/toast";
import { Fab } from "@/components/fab";
import { ManualAddSheet } from "@/components/manual-add-sheet";
import { BulkAddSheet } from "@/components/bulk-add-sheet";
import { CategorySheet } from "@/components/category-sheet";
import { useTransactions } from "@/lib/use-transactions";
import { useApp } from "@/context/AppContext";
import type { Transaction } from "@/lib/schema";

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    addMode,
    setAddMode,
    editing,
    setEditing,
    voiceOpen,
    setVoiceOpen,
    toast,
    setToast,
  } = useApp();

  const voiceSheetRef = useRef<VoiceSheetHandle>(null);
  const tx = useTransactions();

  // Start listening whenever the voice sheet opens, whichever button opened
  // it. Deferred a tick so the sheet is mounted before we call start.
  useEffect(() => {
    if (!voiceOpen) return;
    const t = setTimeout(() => voiceSheetRef.current?.start(), 0);
    return () => clearTimeout(t);
  }, [voiceOpen]);

  /** A draft the user confirmed in the voice sheet: save it. */
  const persistExpense = async (expense: Transaction) => {
    setVoiceOpen(false);
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
    setToast(saved ? `Saved · ${saved.merchantRaw}` : "Couldn't save. Please try again.");
  };

  /** The server already saved this transaction; just show it. */
  const handleCreated = (expense: Transaction) => {
    tx.ingest(expense);
    setVoiceOpen(false);
    setToast(`Saved · ${expense.merchantRaw}`);
  };

  const handleUpdated = (expense: Transaction) => {
    tx.ingest(expense);
    setVoiceOpen(false);
    setToast(`Updated · ${expense.merchantRaw}`);
  };

  const handleDeleted = () => {
    void tx.refresh();
    setVoiceOpen(false);
    setToast("Deleted");
  };

  return (
    <div className="app-viewport">
      <div className="app-frame">
        <div className="app-content">{children}</div>
        <BottomNav onVoice={() => setVoiceOpen(true)} />
        <VoiceSheet
          ref={voiceSheetRef}
          open={voiceOpen}
          onClose={() => setVoiceOpen(false)}
          onSave={persistExpense}
          onCreated={handleCreated}
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
          visible
          onPickSingle={() => setAddMode("single")}
          onPickBulk={() => setAddMode("bulk")}
          onPickCategory={() => setAddMode("category")}
        />
        <Toast message={toast} onDismiss={() => setToast(null)} />
      </div>
    </div>
  );
}
