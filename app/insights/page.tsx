"use client";

import { InsightsScreen } from "@/components/insights/insights-screen";
import { useTransactions } from "@/lib/use-transactions";

export default function Page() {
  const tx = useTransactions();

  return (
    <InsightsScreen
      onVoice={() => {}} // Handled by AppShell
      expenses={tx.transactions}
      loading={tx.loading}
      configured={tx.configured}
      scrolled={false} // Handled by AppShell
    />
  );
}

