"use client";

import { Header } from "@/components/home/header";
import { useApp } from "@/context/AppContext";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { Shield, Palette, Lock, Vibrate } from "lucide-react";
import { haptic, hapticsEnabled, setHapticsEnabled } from "@/lib/native/haptics";

export default function SettingsPage() {
  const { setVoiceOpen } = useApp();
  const [haptics, setHaptics] = useState(true);
  useEffect(() => setHaptics(hapticsEnabled()), []);

  const toggleHaptics = () => {
    const next = !haptics;
    setHapticsEnabled(next);
    setHaptics(next);
    haptic("tap");
  };

  return (
    <>
      <Header
        screen="settings"
        onVoice={() => setVoiceOpen(true)}
      />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel !p-2">
          <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Appearance
          </h3>
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Palette size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Theme</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Currently: Dark Mode
              </span>
            </span>
          </div>
        </div>
        <div className="panel !p-2">
          <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Feedback
          </h3>
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Vibrate size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Vibration</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Feel taps on buttons and a buzz when something saves or fails.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={haptics}
              aria-label="Vibration"
              onClick={toggleHaptics}
              className={`relative h-7 w-12 shrink-0 rounded-full ring-1 transition-colors duration-300 ${
                haptics
                  ? "bg-emerald shadow-[0_0_14px_oklch(0.78_0.17_160/35%)] ring-emerald/40"
                  : "bg-surface-3 ring-border"
              }`}
            >
              <motion.span
                className="absolute top-1 size-5 rounded-full bg-white shadow"
                animate={{ left: haptics ? 24 : 4 }}
                transition={{ type: "spring", stiffness: 500, damping: 32 }}
              />
            </button>
          </div>
        </div>
        <div className="panel !p-2">
          <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Security
          </h3>
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Lock size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-2 text-sm font-medium">
                Biometric Lock <span className="badge-soon">Soon</span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Secure your financial data with FaceID/Fingerprint.
              </span>
            </span>
          </div>
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Shield size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="flex items-center gap-2 text-sm font-medium">
                Two-Factor Auth <span className="badge-soon">Soon</span>
              </span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Add an extra layer of security.
              </span>
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
