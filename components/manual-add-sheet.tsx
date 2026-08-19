"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { AmountStepper } from "@/components/ui/amount-stepper";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { CategorySheet } from "@/components/category-sheet";
import { useCategories } from "@/lib/use-categories";
import { useTransactions } from "@/lib/use-transactions";
import { money } from "@/lib/fmt";
import type { Transaction } from "@/lib/schema";

interface ManualAddSheetProps {
  open: boolean;
  mode: "add" | "edit";
  /** Required when mode === "edit". */
  initial?: Transaction;
  onClose: () => void;
  onSaved: (tx: Transaction, mode: "add" | "edit") => void;
}

function toDateInput(iso: string): string {
  // Returns YYYY-MM-DD in UTC so the picker stays timezone-stable.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

function fromDateInput(date: string, fallbackIso: string): string {
  if (!date) return fallbackIso;
  // Combine picked date with the original time-of-day, falling back to noon.
  const original = new Date(fallbackIso);
  const [y, m, day] = date.split("-").map(Number);
  if (!y || !m || !day) return fallbackIso;
  const d = new Date(original);
  d.setUTCFullYear(y, m - 1, day);
  if (Number.isNaN(original.getTime())) {
    d.setUTCHours(12, 0, 0, 0);
  }
  return d.toISOString();
}

export function ManualAddSheet({
  open,
  mode,
  initial,
  onClose,
  onSaved,
}: ManualAddSheetProps) {
  const cats = useCategories();
  const tx = useTransactions();
  const [amount, setAmount] = useState(0);
  const [merchant, setMerchant] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [direction, setDirection] = useState<"expense" | "income">("expense");
  const [categorySheetOpen, setCategorySheetOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Hydrate / reset whenever the sheet is reopened or `initial` changes.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initial) {
      setAmount(initial.amountMinor);
      setMerchant(initial.merchantRaw);
      setCategoryId(initial.categoryId);
      setNote(initial.note ?? "");
      setDate(toDateInput(initial.transactedAt));
      setDirection(initial.direction === "income" ? "income" : "expense");
    } else {
      setAmount(0);
      setMerchant("");
      setCategoryId(null);
      setNote("");
      setDate(toDateInput(new Date().toISOString()));
      setDirection("expense");
    }
  }, [open, mode, initial]);

  const categoryOptions = useMemo(() => {
    const opts = cats.categories.map((c) => ({
      value: c.id,
      label: c.name,
    }));
    return opts;
  }, [cats.categories]);

  const canSave = amount > 0 && merchant.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSave) return;
    setSubmitting(true);
    try {
      if (mode === "edit" && initial) {
        const fallbackIso = initial.transactedAt;
        const transactedAt = fromDateInput(date, fallbackIso);
        const updated = await tx.update(initial.id, {
          amountMinor: amount,
          merchantRaw: merchant.trim(),
          merchantCanonical: merchant.trim(),
          categoryId,
          note: note.trim() || undefined,
          transactedAt,
          direction,
        });
        if (updated) onSaved(updated, "edit");
      } else {
        const transactedAt = date
          ? fromDateInput(date, new Date().toISOString())
          : new Date().toISOString();
        const created = await tx.add({
          accountId: "acc-default", // server overrides via accounts.is_default
          categoryId,
          amountMinor: amount,
          currency: "INR",
          direction,
          merchantRaw: merchant.trim(),
          merchantCanonical: merchant.trim(),
          note: note.trim() || undefined,
          source: "manual",
          confidence: null,
          rawTranscript: null,
          transactedAt,
          clarified: true,
        });
        if (created) onSaved(created, "add");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title={mode === "edit" ? "Edit memory" : "Add a memory"}
        subtitle={mode === "edit" ? "Memory" : "New memory"}
      >
        <div className="flex flex-col gap-5">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Type
            </p>
            <Segmented<"expense" | "income">
              ariaLabel="direction"
              value={direction}
              onChange={setDirection}
              options={[
                { value: "expense", label: "Expense" },
                { value: "income", label: "Income" },
              ]}
              size="sm"
            />
          </div>

          <AmountStepper
            value={amount}
            onChange={setAmount}
            currency="INR"
            label={mode === "edit" ? `Was ${money(initial?.amountMinor ?? 0, "INR")}` : "How much?"}
          />

          <Field
            label="What was it for?"
            placeholder="e.g. Lunch at Sam's"
            value={merchant}
            onChange={(e) => setMerchant(e.target.value)}
            autoFocus
          />

          <div>
            <span className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Category
            </span>
            {categoryOptions.length === 0 ? (
              <p className="rounded-xl border border-border bg-surface-2 px-3.5 py-3 text-sm text-muted-foreground">
                No categories yet — create one to organize your memories.
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <CategoryPill
                  active={categoryId === null}
                  onClick={() => setCategoryId(null)}
                  label="Uncategorized"
                />
                {categoryOptions.map((c) => (
                  <CategoryPill
                    key={c.value}
                    active={categoryId === c.value}
                    onClick={() => setCategoryId(c.value)}
                    label={c.label}
                  />
                ))}
                <button
                  type="button"
                  onClick={() => setCategorySheetOpen(true)}
                  className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-3 py-1.5 text-xs text-muted-foreground transition hover:border-emerald hover:text-emerald"
                >
                  <Plus size={14} />
                  New
                </button>
              </div>
            )}
          </div>

          <Field
            label="Note (optional)"
            placeholder="Anything to remember"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
          />

          <Field
            label="Date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSave}
            className="primary-button disabled:opacity-50"
          >
            {submitting
              ? "Saving…"
              : mode === "edit"
                ? "Save changes"
                : "Save memory"}
          </button>
        </div>
      </BottomSheet>

      <CategorySheet
        open={categorySheetOpen}
        onClose={() => setCategorySheetOpen(false)}
        onSaved={(cat) => {
          setCategoryId(cat.id);
          setCategorySheetOpen(false);
        }}
      />
    </>
  );
}

function CategoryPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`chip ${active ? "chip-active" : ""}`}
    >
      {label}
    </button>
  );
}
