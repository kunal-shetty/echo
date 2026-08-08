"use client";

import { motion } from "motion/react";
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
}: {
  item: Transaction;
  index?: number;
}) {
  // Category label can be derived from the categoryId slug for system
  // categories (cat-food → "Food", etc.). Without a DB join we fall back
  // to "Uncategorized".
  const labelFromId = item.categoryId
    ? item.categoryId
        .replace(/^(cat-|system-)/, "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : null;
  return (
    <motion.div
      className="flex items-center gap-3 py-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: index * 0.04 }}
      whileTap={{ scale: 0.99, backgroundColor: "oklch(0.18 0.03 255 / 60%)" }}
      style={{ borderRadius: "0.9rem", padding: "0.6rem 0.5rem" }}
    >
      <div className={`merchant-icon ${toneClasses[item.tone]}`}>{item.icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.merchantRaw}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {labelFromId ?? "Uncategorized"} · {item.date}
        </p>
      </div>
      <p className="text-sm font-medium tabular-nums">
        −{money(item.amountMinor, item.currency)}
      </p>
    </motion.div>
  );
}
