"use client";

import { motion } from "motion/react";
import { CircleDollarSign } from "lucide-react";
import { type Transaction } from "@/lib/schema";
import { money } from "@/lib/fmt";

const toneClasses = {
  violet: "bg-violet-soft text-violet",
  orange: "bg-orange-soft text-orange",
  blue: "bg-blue-soft text-blue",
  green: "bg-green-soft text-green",
  pink: "bg-pink-soft text-pink",
  red: "bg-red-soft text-red",
  neutral: "bg-surface-3 text-muted-foreground",
} as const;

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
  return (
    <motion.div
      className="flex items-center gap-3 py-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: index * 0.04 }}
      whileTap={{ scale: 0.99, backgroundColor: "oklch(0.18 0.03 255 / 60%)" }}
      style={{ borderRadius: "0.9rem", padding: "0.6rem 0.5rem" }}
      onClick={interactive ? () => onClick!(item) : undefined}
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
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
      <div className={`merchant-icon ${toneClasses[item.tone]}`}>
        {item.icon === "CircleDollarSign" ? <CircleDollarSign size={16} /> : item.icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate text-sm font-medium">
          {item.merchantRaw}
          {item.direction === "income" ? (
            <span className="shrink-0 rounded-full bg-emerald/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald">
              Income
            </span>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {categoryLabel} · {item.date}
        </p>
      </div>
      <p className="text-sm font-medium tabular-nums">
        {item.direction === "income" ? "+" : "−"}
        {money(item.amountMinor, item.currency)}
      </p>
    </motion.div>
  );
}
