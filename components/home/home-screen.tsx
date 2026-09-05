"use client";

import { Lightbulb, Mic, Receipt } from "lucide-react";
import { motion } from "motion/react";
import { type Transaction } from "@/lib/schema";
import { Header } from "@/components/home/header";
import { SummaryCard } from "@/components/home/summary-card";
import { TransactionRow } from "@/components/transaction-row";
import { useApp } from "@/context/AppContext";
import { useRouter } from "next/navigation";
import { useTransactions } from "@/lib/use-transactions";

export function HomeScreen() {
  const { user, setVoiceOpen } = useApp();
  const router = useRouter();
  const tx = useTransactions();

  const expenses = tx.transactions;
  const loading = tx.loading;
  const configured = tx.configured;
  const empty = !loading && expenses.length === 0;

  return (
    <>
      <Header
        screen="home"
        onVoice={() => setVoiceOpen(true)}
        scrolled={false}
        displayName={user.name}
      />
      <main className="flex flex-col gap-5 px-5 pb-28 echo-stagger">
        <div>
          <p className="eyebrow text-emerald">Your financial memory</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            Ask Echo where your money went.
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            The more you remember, the more useful your answers become.
          </p>
        </div>
        <SummaryCard expenses={expenses} />
        <div className="grid grid-cols-2 gap-3">
          <motion.button
            type="button"
            className="quick-action"
            onClick={() => setVoiceOpen(true)}
            whileTap={{ scale: 0.97 }}
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 360, damping: 22 }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-emerald/15 text-emerald">
              <Mic size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">Remember by voice</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Just talk naturally
              </span>
            </span>
          </motion.button>
          <motion.button
            type="button"
            className="quick-action"
            onClick={() => router.push("/insights")}
            whileTap={{ scale: 0.97 }}
            whileHover={{ y: -2 }}
            transition={{ type: "spring", stiffness: 360, damping: 22 }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-violet-soft text-violet">
              <Lightbulb size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium">View insights</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                See your patterns
              </span>
            </span>
          </motion.button>
        </div>

        {empty ? (
          <EmptyState onVoice={() => setVoiceOpen(true)} configured={configured} />
        ) : (
          <>
            <div className="section-heading">
              <h2 className="text-lg font-semibold">Recent memories</h2>
              <button
                type="button"
                className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => router.push("/activity")}
              >
                View all
              </button>
            </div>
            <div className="divide-y divide-border rounded-2xl bg-surface-1 px-3">
              {expenses.slice(0, 4).map((item, i) => (
                <TransactionRow item={item} index={i} key={item.id} onClick={() => {}} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function EmptyState({
  onVoice,
  configured,
}: {
  onVoice: () => void;
  configured: boolean;
}) {
  return (
    <motion.section
      className="panel flex flex-col items-center gap-3 py-10 text-center"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="grid size-12 place-items-center rounded-full bg-emerald/15 text-emerald">
        <Receipt size={22} />
      </div>
      <p className="text-base font-medium">No memories yet</p>
      <p className="max-w-xs text-sm text-muted-foreground">
        Tap the mic and tell Echo one thing you spent on — like
        <em> “lunch, 250 rupees.” </em>
        We&apos;ll remember it for you.
      </p>
      <motion.button
        type="button"
        className="primary-button mt-2"
        onClick={onVoice}
        whileTap={{ scale: 0.97 }}
        whileHover={{ y: -1 }}
      >
        <Mic size={17} />
        Remember your first thing
      </motion.button>
      {!configured && (
        <p className="mt-2 max-w-xs text-xs text-muted-foreground">
          Backend isn&apos;t configured yet, so this memory will stay on this
          device until you connect Supabase.
        </p>
      )}
    </motion.section>
  );
}
