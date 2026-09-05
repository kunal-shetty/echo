"use client";

import { motion } from "motion/react";
import { Bell, Mic } from "lucide-react";
import { type Screen } from "@/lib/schema";
import { greeting, todayEyebrow } from "@/lib/fmt";
import { Avatar } from "@/components/shared";

interface HeaderProps {
  screen: Screen;
  onVoice: () => void;
  scrolled: boolean;
  displayName?: string;
}

const TITLES: Record<Screen, (name: string) => string> = {
  home: (name) => greeting(name),
  activity: () => "Activity",
  insights: () => "Your insights",
  profile: () => "Profile",
  notifications: () => "Notifications",
  settings: () => "App settings",
  help: () => "Help & support",
  privacy: () => "Privacy Policy",
  terms: () => "Terms of Service",
};

export function Header({
  screen,
  onVoice,
  scrolled,
  displayName,
}: HeaderProps) {
  const name = displayName || "friend";
  return (
    <motion.header
      // viewTransitionName keeps the header anchored across screen swaps
      style={{ viewTransitionName: "echo-header" }}
      className={`echo-header ${scrolled ? "is-scrolled" : ""}`}
    >
      <div className="flex items-center justify-between px-5 pb-4 pt-6">
        <div>
          {screen === "home" ? (
            <>
              <p className="text-sm text-muted-foreground">{todayEyebrow()}</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {TITLES[screen](name)}
              </h1>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">Echo</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">
                {TITLES[screen](name)}
              </h1>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          <motion.button
            type="button"
            className="icon-button"
            aria-label="Voice capture"
            onClick={onVoice}
            whileTap={{ scale: 0.92 }}
            whileHover={{ y: -1 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
          >
            <Mic size={18} />
          </motion.button>
          <motion.button
            type="button"
            className="relative"
            aria-label="Notifications"
            whileTap={{ scale: 0.92 }}
            transition={{ type: "spring", stiffness: 400, damping: 22 }}
          >
            <Bell size={19} className="text-muted-foreground" />
            <span className="absolute -right-1 -top-1 size-2 rounded-full bg-orange ring-2 ring-background" />
          </motion.button>
          <Avatar name={name} />
        </div>
      </div>
    </motion.header>
  );
}
