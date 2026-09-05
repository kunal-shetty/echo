/**
 * @file bottom-nav.tsx
 * @description Main navigation bar for the app.
 * Handles screen switching and the high-priority Voice Button (Echo trigger).
 */

"use client";

import { motion } from "motion/react";
import { useRef, useState } from "react";
import {
  Home,
  Lightbulb,
  ListFilter,
  Mic,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_PILL } from "@/lib/motion";

const ITEMS = [
  { id: "home", path: "/", label: "Home", icon: Home },
  { id: "activity", path: "/activity", label: "Activity", icon: ListFilter },
  { id: "insights", path: "/insights", label: "Insights", icon: Lightbulb },
  { id: "profile", path: "/profile", label: "Profile", icon: UserRound },
];

/**
 * The primary bottom navigation bar.
 * Uses Next.js routing for screen switching with an animated active pill.
 */
export function BottomNav({
  onVoice,
}: {
  onVoice: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map((item) => {
        const active = pathname === item.path;
        return (
          <Link
            key={item.id}
            href={item.path}
            aria-current={active ? "page" : undefined}
            className={`nav-item ${active ? "active" : ""}`}
          >
            {active && (
              <motion.span
                layoutId="nav-pill"
                className="nav-pill"
                transition={NAV_PILL}
              />
            )}
            <item.icon size={20} />
            <span>{item.label}</span>
          </Link>
        );
      })}
      <VoiceButton onVoice={onVoice} />
    </nav>
  );
}

/**
 * A specialized button for triggering voice input.
 * Supports a "hold-to-trigger" gesture for faster interaction.
 */
function VoiceButton({ onVoice }: { onVoice: () => void }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const start = () => {
    setHolding(true);
    timer.current = setTimeout(() => onVoice(), 450);
  };
  const end = () => {
    if (timer.current) clearTimeout(timer.current);
    if (holding) onVoice();
    setHolding(false);
  };

  return (
    <motion.button
      type="button"
      className={`voice-nav-button ${holding ? "is-holding" : ""}`}
      aria-label="Hold to remember an expense"
      onPointerDown={start}
      onPointerUp={end}
      onPointerLeave={end}
      onClick={() => !holding && onVoice()}
      whileTap={{ scale: 0.96 }}
      animate={
        holding
          ? {
              scale: 1.08,
              boxShadow:
                "0 0 0 0.6rem oklch(0.78 0.17 160 / 18%), 0 14px 34px oklch(0.78 0.17 160 / 40%)",
            }
          : { scale: 1 }
      }
      transition={{ type: "spring", stiffness: 380, damping: 22 }}
    >
      <Mic size={28} strokeWidth={2.4} />
      <span>Echo</span>
    </motion.button>
  );
}
