"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence, LayoutGroup } from "motion/react";
import { Mic, PencilLine, Search, X } from "lucide-react";
import { type Transaction } from "@/lib/schema";
import { Header } from "@/components/home/header";
import {
  TransactionRow,
  TransactionRowSkeleton,
} from "@/components/transaction-row";
import { useCategories } from "@/lib/use-categories";
import { useApp } from "@/context/AppContext";
import { useTransactions } from "@/lib/use-transactions";
import { money } from "@/lib/fmt";
import { NAV_PILL } from "@/lib/motion";

const ALL_FILTER = "All";

export function ActivityScreen() {
  const { setVoiceOpen, setAddMode, setEditing } = useApp();
  const tx = useTransactions();
  const cats = useCategories();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>(ALL_FILTER);

  const expenses = tx.transactions;
  const loading = tx.loading;
  const configured = tx.configured;

  const FILTERS = useMemo(
    () => [ALL_FILTER, ...cats.categories.map((c) => c.name)],
    [cats.categories],
  );

  const filtered = useMemo(
    () =>
      expenses.filter((item) => {
        const haystack =
          `${item.merchantRaw} ${item.categoryName ?? ""}`.toLowerCase();
        const matchesQuery = haystack.includes(query.trim().toLowerCase());
        const catLabel = item.categoryName ?? "";
        const matchesFilter =
          filter === ALL_FILTER ||
          catLabel.toLowerCase() === filter.toLowerCase();
        return matchesQuery && matchesFilter;
      }),
    [query, filter, expenses],
  );

  const groups = useMemo(() => groupByDay(filtered), [filtered]);
  const empty = !loading && expenses.length === 0;

  return (
    <>
      <Header screen="activity" onVoice={() => setVoiceOpen(true)} />
      <main className="flex flex-col gap-5 px-5 pb-28">
        {empty ? (
          <EmptyActivity
            onVoice={() => setVoiceOpen(true)}
            onAddManually={() => setAddMode("single")}
            configured={configured}
          />
        ) : (
          <>
            <div className="search-box">
              <Search size={17} className="text-muted-foreground" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memories"
                aria-label="Search memories"
              />
              <AnimatePresence>
                {query && (
                  <motion.button
                    type="button"
                    aria-label="Clear search"
                    className="grid size-5 place-items-center rounded-full bg-surface-3 text-muted-foreground hover:text-foreground"
                    initial={{ opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.6 }}
                    onClick={() => setQuery("")}
                  >
                    <X size={12} />
                  </motion.button>
                )}
              </AnimatePresence>
            </div>
            <LayoutGroup id="activity-filters">
              <div
                className="no-scrollbar -mx-5 flex gap-2 overflow-x-auto px-5"
                role="tablist"
                aria-label="Filter by category"
              >
                {FILTERS.map((item) => {
                  const active = filter === item;
                  return (
                    <motion.button
                      key={item}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setFilter(item)}
                      whileTap={{ scale: 0.95 }}
                      className={`chip relative ${active ? "chip-active !bg-transparent" : ""}`}
                    >
                      {active && (
                        <motion.span
                          layoutId="activity-chip"
                          className="absolute inset-0 rounded-full bg-emerald/10"
                          transition={NAV_PILL}
                        />
                      )}
                      <span className="relative">{item}</span>
                    </motion.button>
                  );
                })}
              </div>
            </LayoutGroup>
            <div className="flex items-center justify-between">
              <p className="eyebrow">Your timeline</p>
              {!loading && (
                <p className="text-xs text-muted-foreground tabular-nums">
                  {filtered.length}{" "}
                  {filtered.length === 1 ? "memory" : "memories"}
                </p>
              )}
            </div>
            {loading ? (
              <TransactionRowSkeleton count={6} />
            ) : filtered.length === 0 ? (
              <motion.div
                className="list-card py-12 text-center text-sm text-muted-foreground"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
              >
                No memories match those filters.
              </motion.div>
            ) : (
              <div className="flex flex-col gap-4">
                <AnimatePresence initial={false}>
                  {groups.map((group, gi) => (
                    <motion.section
                      key={group.key}
                      layout="position"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, transition: { duration: 0.15 } }}
                      transition={{
                        duration: 0.3,
                        delay: Math.min(gi, 4) * 0.05,
                      }}
                    >
                      <div className="mb-2 flex items-baseline justify-between px-1">
                        <h3 className="text-xs font-semibold text-muted-foreground">
                          {group.label}
                        </h3>
                        {group.spend > 0 && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            −{money(group.spend, "INR")}
                          </span>
                        )}
                      </div>
                      <div className="list-card">
                        <AnimatePresence initial={false}>
                          {group.items.map((item, i) => (
                            <TransactionRow
                              item={item}
                              index={i}
                              key={item.id}
                              onClick={setEditing}
                            />
                          ))}
                        </AnimatePresence>
                      </div>
                    </motion.section>
                  ))}
                </AnimatePresence>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

interface DayGroup {
  key: string;
  label: string;
  spend: number;
  items: Transaction[];
}

/** Buckets transactions (already newest-first) into calendar days. */
function groupByDay(items: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const keyOf = (d: Date) =>
    `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  for (const item of items) {
    const d = new Date(item.transactedAt);
    const key = keyOf(d);
    let group = groups[groups.length - 1];
    if (!group || group.key !== key) {
      const label =
        key === keyOf(today)
          ? "Today"
          : key === keyOf(yesterday)
            ? "Yesterday"
            : d.toLocaleDateString("en-IN", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year:
                  d.getFullYear() === today.getFullYear()
                    ? undefined
                    : "numeric",
              });
      group = { key, label, spend: 0, items: [] };
      groups.push(group);
    }
    group.items.push(item);
    if (item.direction !== "income") group.spend += item.amountMinor;
  }
  return groups;
}

function EmptyActivity({
  onVoice,
  onAddManually,
  configured,
}: {
  onVoice: () => void;
  onAddManually?: () => void;
  configured: boolean;
}) {
  return (
    <motion.section
      className="panel flex flex-col items-center gap-3 py-10 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <p className="text-base font-medium">Nothing remembered yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Your timeline will fill up as you talk to Echo. Start with one memory.
      </p>
      <motion.button
        type="button"
        className="primary-button mt-2"
        onClick={onVoice}
        whileTap={{ scale: 0.97 }}
        whileHover={{ y: -1 }}
      >
        <Mic size={17} />
        Add your first memory
      </motion.button>
      {onAddManually && (
        <motion.button
          type="button"
          className="secondary-button mt-1"
          onClick={onAddManually}
          whileTap={{ scale: 0.97 }}
        >
          <PencilLine size={15} />
          Or add it manually
        </motion.button>
      )}
      {!configured && (
        <p className="mt-2 max-w-xs text-xs text-muted-foreground">
          Backend isn&apos;t configured. Memories stay on this device for now.
        </p>
      )}
    </motion.section>
  );
}
