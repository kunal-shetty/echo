"use client";

import { Header } from "@/components/home/header";
import { useApp } from "@/context/AppContext";
import { motion } from "motion/react";
import { Shield, Palette, Lock } from "lucide-react";

export default function SettingsPage() {
  const { setVoiceOpen } = useApp();

  return (
    <>
      <Header screen="settings" onVoice={() => setVoiceOpen(true)} scrolled={false} />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel !p-2">
          <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Appearance</h3>
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Palette size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Theme</span>
              <span className="mt-1 block text-xs text-muted-foreground">Currently: Dark Mode</span>
            </span>
          </div>
        </div>
        <div className="panel !p-2">
          <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Security</h3>
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Lock size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Biometric Lock</span>
              <span className="mt-1 block text-xs text-muted-foreground">Secure your financial data with FaceID/Fingerprint.</span>
            </span>
          </div>
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Shield size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Two-Factor Auth</span>
              <span className="mt-1 block text-xs text-muted-foreground">Add an extra layer of security.</span>
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
