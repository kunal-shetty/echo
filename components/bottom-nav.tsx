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
import { type Screen } from "@/lib/schema";
import { NAV_PILL } from "@/lib/motion";

const ITEMS = [
  { id: "home" as Screen, label: "Home", icon: Home },
  { id: "activity" as Screen, label: "Activity", icon: ListFilter },
  { id: "insights" as Screen, label: "Insights", icon: Lightbulb },
  { id: "profile" as Screen, label: "Profile", icon: UserRound },
];

export function BottomNav({
  screen,
  setScreen,
  onVoice,
}: {
  screen: Screen;
  setScreen: (s: Screen) => void;
  onVoice: () => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.map((item) => {
        const active = screen === item.id;
        return (
          <motion.button
            key={item.id}
            type="button"
            aria-current={active ? "page" : undefined}
            className={`nav-item ${active ? "active" : ""}`}
            onClick={() => setScreen(item.id)}
            whileTap={{ scale: 0.92 }}
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
          </motion.button>
        );
      })}
      <VoiceButton onVoice={onVoice} />
    </nav>
  );
}

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
