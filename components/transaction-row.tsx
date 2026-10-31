"use client";

import { motion } from "motion/react";
import { CircleDollarSign } from "lucide-react";
import { type Transaction } from "@/lib/schema";
import { money } from "@/lib/fmt";
import { EASE_OUT } from "@/lib/motion";

const toneClasses = {
  violet: "bg-violet-soft text-violet",
  orange: "bg-orange-soft text-orange",
  blue: "bg-blue-soft text-blue",
  green: "bg-green-soft text-green",
  pink: "bg-pink-soft text-pink",
  red: "bg-red-soft text-red",
  neutral: "bg-surface-3 text-muted-foreground",
} as const;

/** Rows past this index enter together, so long lists don't trickle in. */
const MAX_STAGGER = 8;

export function TransactionRow({
  item,
  index = 0,
  onClick,
}: {
  item: Transaction;
  index?: number;
  onClick?: (item: Transaction) => void;
}) {
  // Category label comes from the joined categories table (populated
  // server-side in `toUiTransaction`). Falls back to "Uncategorized"
  // when the transaction has no category assigned.
  const categoryLabel = item.categoryName ?? "Uncategorized";
  const interactive = Boolean(onClick);
  const income = item.direction === "income";
  return (
    <motion.div
      layout="position"
      className="tx-row"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.15 } }}
      transition={{
        duration: 0.36,
        ease: EASE_OUT,
        delay: Math.min(index, MAX_STAGGER) * 0.035,
      }}
      whileTap={interactive ? { scale: 0.985 } : undefined}
      onClick={interactive ? () => onClick!(item) : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={
        interactive
          ? `Edit ${item.merchantRaw}, ${money(item.amountMinor, item.currency)}`
          : undefined
      }
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick!(item);
              }
            }
          : undefined
      }
    >
      <div className={`merchant-icon shrink-0 ${toneClasses[item.tone]}`}>
        {item.icon === "CircleDollarSign" ? (
          <CircleDollarSign size={16} />
        ) : (
          item.icon
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
          <span className="truncate">{item.merchantRaw}</span>
          {income ? (
            <span className="shrink-0 rounded-full bg-emerald/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald">
              Income
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {categoryLabel} · {item.date}
        </p>
      </div>
      <p
        className={`shrink-0 text-sm font-semibold tabular-nums ${
          income ? "text-emerald" : ""
        }`}
      >
        {income ? "+" : "−"}
        {money(item.amountMinor, item.currency)}
      </p>
    </motion.div>
  );
}

/** Placeholder rows shown while transactions load. */
export function TransactionRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="list-card" aria-busy="true" aria-label="Loading memories">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="tx-row" style={{ opacity: 1 - i * 0.18 }}>
          <div className="skeleton size-10 shrink-0 !rounded-[0.8rem]" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="skeleton h-3 w-2/5" />
            <div className="skeleton h-2.5 w-3/5" />
          </div>
          <div className="skeleton h-3 w-14" />
        </div>
      ))}
    </div>
  );
}
