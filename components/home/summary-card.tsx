"use client";

import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { type Transaction } from "@/lib/schema";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { money } from "@/lib/fmt";

export function SummaryCard({ expenses }: { expenses: Transaction[] }) {
  const spendTotal = expenses
    .filter((t) => t.direction !== "income")
    .reduce((sum, t) => sum + t.amountMinor, 0);
  const incomeTotal = expenses
    .filter((t) => t.direction === "income")
    .reduce((sum, t) => sum + t.amountMinor, 0);
  const ratio = Math.min(100, (expenses.length / 30) * 100);
  return (
    <motion.section
      layout
      className="summary-card"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Financial memory</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight">
            <AnimatedNumber value={spendTotal} />
          </p>
        </div>
        <div className="grid size-10 place-items-center rounded-xl bg-emerald/15 text-emerald">
          <Wallet size={19} />
        </div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <ArrowUpRight size={11} className="text-orange" />
            Spent
          </div>
          <p className="mt-1.5 text-base font-semibold tabular-nums">
            {money(spendTotal, "INR")}
          </p>
        </div>
        <div className="rounded-xl bg-surface-2 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <ArrowDownLeft size={11} className="text-emerald" />
            Earned
          </div>
          <p className="mt-1.5 text-base font-semibold tabular-nums text-emerald">
            +{money(incomeTotal, "INR")}
          </p>
        </div>
      </div>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <p className="text-xs text-muted-foreground">Remembered this month</p>
          <div className="mt-2 h-2 w-44 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full rounded-full bg-emerald"
              initial={{ width: 0 }}
              animate={{ width: `${ratio}%` }}
              transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
        </div>
        <p className="text-sm font-medium text-emerald">
          {expenses.length} events
        </p>
      </div>
    </motion.section>
  );
}
