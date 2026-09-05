"use client";

import { Header } from "@/components/home/header";
import { useApp } from "@/context/AppContext";
import { motion } from "motion/react";
import { Bell, Check } from "lucide-react";

export default function NotificationsPage() {
  const { setVoiceOpen } = useApp();

  return (
    <>
      <Header screen="notifications" onVoice={() => setVoiceOpen(true)} scrolled={false} />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel !p-2">
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Bell size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Evening Memory Prompt</span>
              <span className="mt-1 block text-xs text-muted-foreground">Remind me to record my expenses every evening.</span>
            </span>
            <input type="checkbox" className="rounded-full border-border bg-surface-3 text-emerald focus:ring-emerald" defaultChecked />
          </div>
        </div>
      </main>
    </>
  );
}
