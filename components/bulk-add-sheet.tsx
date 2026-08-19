"use client";

import { useMemo, useState } from "react";
import { motion } from "motion/react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Segmented } from "@/components/ui/segmented";
import { useTransactions } from "@/lib/use-transactions";
import { money } from "@/lib/fmt";
import {
  parseBulkPaste,
  validateRow,
  BULK_FIELDS,
  type BulkField,
  type ParsedBulkRow,
} from "@/lib/bulk-parse";

type Step = "paste" | "mapping" | "preview" | "importing" | "done";

interface BulkAddSheetProps {
  open: boolean;
  onClose: () => void;
  onComplete: (inserted: number, failures: number) => void;
}

const PLACEHOLDER = `Paste rows. Auto-detects CSV or TSV. First row may be headers.

date,amount,merchant,category,note,direction
2026-08-19,250,Lunch,Food & Drink,with Sam,expense
2026-08-19,50000,Salary,Other,August paycheck,income
2026-08-18,80,Coffee,Food & Drink,,expense`;

export function BulkAddSheet({ open, onClose, onComplete }: BulkAddSheetProps) {
  const tx = useTransactions();
  const [step, setStep] = useState<Step>("paste");
  const [paste, setPaste] = useState("");
  const [mapping, setMapping] = useState<Map<number, BulkField | "ignore">>(
    new Map(),
  );

  const parsed = useMemo(
    () => parseBulkPaste(paste, mapping.size > 0 ? mapping : undefined),
    [paste, mapping],
  );

  const validations = useMemo(
    () =>
      parsed.rows.map((r) => ({ row: r, result: validateRow(r) })),
    [parsed],
  );

  const validCount = validations.filter((v) => v.result.ok).length;
  const invalidCount = validations.length - validCount;

  const handleContinue = () => {
    if (parsed.rows.length === 0) return;
    if (parsed.detectedHeaders && hasUnmapped(parsed.mapping)) {
      setStep("mapping");
    } else {
      setStep("preview");
    }
  };

  const handleImport = async () => {
    const rows = validations
      .filter((v): v is { row: ParsedBulkRow; result: { ok: true; row: import("@/lib/use-transactions").BulkRowInput } } => v.result.ok)
      .map((v) => v.result.row);
    if (rows.length === 0) return;
    setStep("importing");
    const res = await tx.bulkAdd(rows);
    setStep("done");
    onComplete(res.transactions.length, res.failures.length);
  };

  const handleClose = () => {
    // Reset on close so a fresh open is a blank sheet.
    setStep("paste");
    setPaste("");
    setMapping(new Map());
    onClose();
  };

  return (
    <BottomSheet
      open={open}
      onClose={handleClose}
      title={step === "paste" ? "Bulk add" : "Bulk import"}
      subtitle="Bulk"
    >
      {step === "paste" && (
        <div className="flex flex-col gap-4">
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            placeholder={PLACEHOLDER}
            rows={10}
            className="w-full resize-y rounded-2xl border border-border bg-surface-2 px-3.5 py-3 font-mono text-[0.78rem] leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-emerald/60"
            aria-label="Paste rows"
          />
          <p className="text-xs text-muted-foreground">
            {parsed.detectedHeaders
              ? `Detected ${parsed.detectedDelimiter === "\t" ? "TSV" : "CSV"} with a header row.`
              : parsed.rows.length > 0
                ? `Detected ${parsed.detectedDelimiter === "\t" ? "TSV" : "CSV"} — using default columns: date, amount, merchant, category, note, direction.`
                : "Paste at least one row."}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="secondary-button"
              onClick={handleClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary-button disabled:opacity-50"
              onClick={handleContinue}
              disabled={parsed.rows.length === 0}
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {step === "mapping" && (
        <MappingStep
          mapping={parsed.mapping}
          rows={parsed.rows}
          onChange={setMapping}
          onBack={() => setStep("paste")}
          onApply={() => setStep("preview")}
        />
      )}

      {step === "preview" && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-surface-2 px-3.5 py-2.5 text-xs">
            <span className="text-muted-foreground">
              {validCount} valid · {invalidCount} invalid
            </span>
            {parsed.detectedHeaders && (
              <button
                type="button"
                className="text-emerald"
                onClick={() => setStep("mapping")}
              >
                Edit columns
              </button>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto rounded-2xl border border-border">
            {validations.length === 0 ? (
              <p className="px-3.5 py-6 text-center text-sm text-muted-foreground">
                No rows to preview.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {validations.map((v, i) => (
                  <PreviewRow key={i} v={v} />
                ))}
              </ul>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="secondary-button"
              onClick={() => setStep("paste")}
            >
              Back
            </button>
            <button
              type="button"
              className="primary-button disabled:opacity-50"
              disabled={validCount === 0}
              onClick={handleImport}
            >
              Import {validCount} {validCount === 1 ? "row" : "rows"}
            </button>
          </div>
        </div>
      )}

      {step === "importing" && (
        <div className="grid place-items-center gap-3 py-10">
          <motion.div
            className="size-8 rounded-full border-2 border-emerald border-t-transparent"
            animate={{ rotate: 360 }}
            transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
          />
          <p className="text-sm text-muted-foreground">Importing…</p>
        </div>
      )}

      {step === "done" && (
        <div className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-base font-medium">Done</p>
          <p className="text-sm text-muted-foreground">
            Memories have been added to your timeline.
          </p>
          <button
            type="button"
            className="primary-button mt-2"
            onClick={handleClose}
          >
            Close
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

function hasUnmapped(mapping: Map<number, BulkField | "ignore">): boolean {
  if (mapping.size === 0) return false;
  return Array.from(mapping.values()).some((v) => v !== "ignore");
}

function MappingStep({
  mapping,
  rows,
  onChange,
  onBack,
  onApply,
}: {
  mapping: Map<number, BulkField | "ignore">;
  rows: ParsedBulkRow[];
  onChange: (next: Map<number, BulkField | "ignore">) => void;
  onBack: () => void;
  onApply: () => void;
}) {
  const entries = Array.from(mapping.entries()).sort(([a], [b]) => a - b);
  const update = (col: number, value: BulkField | "ignore") => {
    const next = new Map(mapping);
    next.set(col, value);
    onChange(next);
  };

  const options = [
    ...BULK_FIELDS.map((f) => ({ value: f, label: labelFor(f) })),
    { value: "ignore" as const, label: "— Ignore —" },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">
        Map each detected column to a field. We'll re-parse your paste.
      </p>
      <div className="flex flex-col gap-3">
        {entries.map(([col, field]) => {
          const sample = rows[0]?.cells[col] ?? "";
          return (
            <div
              key={col}
              className="flex items-center gap-3 rounded-xl border border-border bg-surface-2 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground">
                  Column {col + 1}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {sample || "(empty)"}
                </p>
              </div>
              <div className="w-40">
                <Segmented<BulkField | "ignore">
                  size="sm"
                  ariaLabel={`Map column ${col + 1}`}
                  value={field}
                  onChange={(v) => update(col, v)}
                  options={options}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button type="button" className="secondary-button" onClick={onBack}>
          Back
        </button>
        <button type="button" className="primary-button" onClick={onApply}>
          Apply
        </button>
      </div>
    </div>
  );
}

function PreviewRow({
  v,
}: {
  v: { row: ParsedBulkRow; result: ReturnType<typeof validateRow> };
}) {
  if (!v.result.ok) {
    return (
      <li className="flex items-center gap-3 px-3.5 py-2.5">
        <span
          aria-label="Invalid"
          className="grid size-5 shrink-0 place-items-center rounded-full bg-red/15 text-xs text-red"
        >
          !
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">
            Row {v.row.rowIndex}: {v.result.error}
          </p>
        </div>
      </li>
    );
  }
  const r = v.result.row;
  const isIncome = r.direction === "income";
  return (
    <li className="flex items-center gap-3 px-3.5 py-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-emerald/15 text-xs font-semibold text-emerald">
        ✓
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {r.merchantRaw}
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              isIncome
                ? "bg-emerald/15 text-emerald"
                : "bg-surface-3 text-muted-foreground"
            }`}
          >
            {isIncome ? "Income" : "Expense"}
          </span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {r.categoryName ?? "Uncategorized"}
          {r.date ? ` · ${r.date}` : ""}
          {r.note ? ` · ${r.note}` : ""}
        </p>
      </div>
      <p className="text-sm font-medium tabular-nums">
        {isIncome ? "+" : "−"}
        {money(r.amountMinor, "INR")}
      </p>
    </li>
  );
}

function labelFor(field: BulkField): string {
  switch (field) {
    case "date":
      return "Date";
    case "amount":
      return "Amount";
    case "merchant":
      return "Merchant";
    case "category":
      return "Category";
    case "note":
      return "Note";
    case "direction":
      return "Direction";
  }
}
