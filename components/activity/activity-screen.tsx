"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ListFilter, Mic, PencilLine, Search } from "lucide-react";
import { type Transaction } from "@/lib/schema";
import { Header } from "@/components/home/header";
import { TransactionRow } from "@/components/transaction-row";
import { useCategories } from "@/lib/use-categories";
import { useApp } from "@/context/AppContext";
import { useTransactions } from "@/lib/use-transactions";

const ALL_FILTER = "All";

export function ActivityScreen() {
  const { setVoiceOpen, setAddMode } = useApp();
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
        const haystack = `${item.merchantRaw} ${item.categoryName ?? ""}`.toLowerCase();
        const matchesQuery = haystack.includes(query.toLowerCase());
        const catLabel = item.categoryName ?? "";
        const matchesFilter =
          filter === ALL_FILTER ||
          catLabel.toLowerCase() === filter.toLowerCase();
        return matchesQuery && matchesFilter;
      }),
    [query, filter, expenses],
  );

  const empty = !loading && expenses.length === 0;

  return (
    <>
      <Header screen="activity" onVoice={() => setVoiceOpen(true)} scrolled={false} />
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
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search memories"
                aria-label="Search memories"
              />
            </div>
            <div className="no-scrollbar -mr-1 flex gap-2 overflow-x-auto pr-1">
              {FILTERS.map((item) => {
                const active = filter === item;
                return (
                  <motion.button
                    key={item}
                    type="button"
                    onClick={() => setFilter(item)}
                    whileTap={{ scale: 0.95 }}
                    className={`chip ${active ? "chip-active" : ""}`}
                    layout
                    transition={{ type: "spring", stiffness: 380, damping: 24 }}
                  >
                    {item}
                  </motion.button>
                );
              })}
            </div>
            <div className="flex items-center justify-between">
              <p className="eyebrow">Your timeline</p>
              <motion.button
                type="button"
                className="icon-button"
                aria-label="Filter activity"
                whileTap={{ scale: 0.92 }}
              >
                <ListFilter size={17} />
              </motion.button>
            </div>
            <AnimatePresence mode="popLayout">
              <motion.div
                layout
                className="divide-y divide-border rounded-2xl bg-surface-1 px-3"
              >
                {filtered.map((item, i) => (
                  <TransactionRow
                    item={item}
                    index={i}
                    key={item.id}
                    onClick={() => {}}
                  />
                ))}
                {filtered.length === 0 && !empty && (
                  <motion.div
                    key="empty"
                    className="py-12 text-center text-sm text-muted-foreground"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                  >
                    No memories match those filters.
                  </motion.div>
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </main>
    </>
  );
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
