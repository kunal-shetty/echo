/**
 * @file bottom-nav.tsx
 * @description Main navigation bar for the app.
 * Handles screen switching and the high-priority voice button (Echo trigger).
 */

"use client";

import { motion } from "motion/react";
import { Home, Lightbulb, ListFilter, Mic, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_PILL } from "@/lib/motion";
import { haptic } from "@/lib/native/haptics";

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
export function BottomNav({ onVoice }: { onVoice: () => void }) {
  const pathname = usePathname();
  const isActive = (path: string) =>
    path === "/" ? pathname === "/" : pathname.startsWith(path);

  const renderItem = (item: (typeof ITEMS)[number]) => {
    const active = isActive(item.path);
    return (
      <Link
        key={item.id}
        href={item.path}
        aria-current={active ? "page" : undefined}
        className={`nav-item ${active ? "active" : ""}`}
        onClick={() => !active && haptic("tap")}
      >
        {active && (
          <motion.span
            layoutId="nav-pill"
            className="nav-pill"
            transition={NAV_PILL}
          />
        )}
        <item.icon size={20} strokeWidth={active ? 2.3 : 2} />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <nav className="bottom-nav" aria-label="Primary">
      {ITEMS.slice(0, 2).map(renderItem)}
      <VoiceButton onVoice={onVoice} />
      {ITEMS.slice(2).map(renderItem)}
    </nav>
  );
}

/** The raised mic button: Echo's primary action. */
function VoiceButton({ onVoice }: { onVoice: () => void }) {
  return (
    <motion.button
      type="button"
      className="voice-nav-button"
      aria-label="Remember an expense by voice"
      onClick={onVoice}
      whileHover={{ y: -2, scale: 1.03 }}
      whileTap={{ scale: 0.92 }}
      transition={{ type: "spring", stiffness: 420, damping: 20 }}
    >
      <Mic size={28} strokeWidth={2.4} />
    </motion.button>
  );
}
