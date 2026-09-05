"use client";

import { HomeScreen } from "@/components/home/home-screen";
import { useTransactions } from "@/lib/use-transactions";
import { useApp } from "@/context/AppContext";

export default function Page() {
  const { user } = useApp();
  const tx = useTransactions();

  return (
    <HomeScreen
      setScreen={() => {}} // No longer used for routing
      onVoice={() => {}} // Handled by AppShell
      expenses={tx.transactions}
      loading={tx.loading}
      configured={tx.configured}
      scrolled={false} // Handled by AppShell
      user={user}
      onRowClick={() => {}} // This should be a link to a detail page if we had one
    />
  );
}

