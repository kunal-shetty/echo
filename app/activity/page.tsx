"use client";

import { ActivityScreen } from "@/components/activity/activity-screen";
import { useTransactions } from "@/lib/use-transactions";

export default function Page() {
  const tx = useTransactions();

  return (
    <ActivityScreen
      onVoice={() => {}} // Handled by AppShell
      onAddManually={() => {}} // This should be handled by context setAddMode
      expenses={tx.transactions}
      loading={tx.loading}
      configured={tx.configured}
      scrolled={false} // Handled by AppShell
      onRowClick={() => {}}
    />
  );
}

