"use client";

import { ArrowDownLeft, ArrowUpRight, Wallet } from "lucide-react";
import { motion } from "motion/react";
import { type Transaction } from "@/lib/schema";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { money } from "@/lib/fmt";
import { EASE_OUT } from "@/lib/motion";

/** A month with this many memories fills the progress bar. */
const MONTHLY_GOAL = 30;

export function SummaryCard({
  expenses,
  loading = false,
}: {
  expenses: Transaction[];
  loading?: boolean;
}) {
  const now = new Date();
  const thisMonth = expenses.filter((t) => {
    const d = new Date(t.transactedAt);
    return (
      d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
    );
  });
  const spendTotal = thisMonth
    .filter((t) => t.direction !== "income")
    .reduce((sum, t) => sum + t.amountMinor, 0);
  const incomeTotal = thisMonth
    .filter((t) => t.direction === "income")
    .reduce((sum, t) => sum + t.amountMinor, 0);
  const ratio = Math.min(100, (thisMonth.length / MONTHLY_GOAL) * 100);
  const monthName = now.toLocaleDateString("en-IN", { month: "long" });

  return (
    <motion.section
      className="summary-card"
      initial={{ opacity: 0, y: 14, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: EASE_OUT }}
    >
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Spent in {monthName}</p>
          {loading ? (
            <div className="skeleton mt-3 h-9 w-40" />
          ) : (
            <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
              <AnimatedNumber value={spendTotal} duration={1} />
            </p>
          )}
        </div>
        <motion.div
          className="grid size-10 place-items-center rounded-xl bg-emerald/15 text-emerald ring-1 ring-emerald/20"
          initial={{ rotate: -20, scale: 0.6, opacity: 0 }}
          animate={{ rotate: 0, scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 16, delay: 0.15 }}
        >
          <Wallet size={19} />
        </motion.div>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3">
        <Stat
          label="Spent"
          icon={<ArrowUpRight size={11} className="text-orange" />}
          value={money(spendTotal, "INR")}
        />
        <Stat
          label="Earned"
          icon={<ArrowDownLeft size={11} className="text-emerald" />}
          value={`+${money(incomeTotal, "INR")}`}
          className="text-emerald"
        />
      </div>
      <div className="mt-6 flex items-end justify-between gap-4">
        <div className="flex-1">
          <p className="text-xs text-muted-foreground">Remembered this month</p>
          <div className="mt-2 h-2 max-w-44 overflow-hidden rounded-full bg-surface-3">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-emerald/70 to-emerald shadow-[0_0_12px_var(--emerald)]"
              initial={{ width: 0 }}
              animate={{ width: `${ratio}%` }}
              transition={{ duration: 1, ease: EASE_OUT, delay: 0.2 }}
            />
          </div>
        </div>
        <p className="text-sm font-medium text-emerald tabular-nums">
          {thisMonth.length} {thisMonth.length === 1 ? "memory" : "memories"}
        </p>
      </div>
    </motion.section>
  );
}

function Stat({
  label,
  icon,
  value,
  className = "",
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  className?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-2/70 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <p
        className={`mt-1.5 truncate text-base font-semibold tabular-nums ${className}`}
      >
        {value}
      </p>
    </div>
  );
}
