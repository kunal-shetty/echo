"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { Bell, ChevronLeft, Mic } from "lucide-react";
import { type Screen } from "@/lib/schema";
import { greeting, todayEyebrow } from "@/lib/fmt";
import { Avatar } from "@/components/shared";
import { useApp } from "@/context/AppContext";

interface HeaderProps {
  screen: Screen;
  onVoice: () => void;
}

const TITLES: Record<Screen, (name: string) => string> = {
  home: (name) => greeting(name),
  activity: () => "Activity",
  insights: () => "Your insights",
  profile: () => "Profile",
  notifications: () => "Notifications",
  settings: () => "App settings",
  agent: () => "Voice agent",
  help: () => "Help & support",
  privacy: () => "Privacy Policy",
  terms: () => "Terms of Service",
};

/** Screens reached from Profile; they get a back button instead of a tab. */
const SUB_SCREENS = new Set<Screen>([
  "notifications",
  "settings",
  "agent",
  "help",
  "privacy",
  "terms",
]);

const SPRING = { type: "spring", stiffness: 400, damping: 22 } as const;

export function Header({ screen, onVoice }: HeaderProps) {
  const router = useRouter();
  const { user } = useApp();
  const scrolled = useScrolled();
  const name = user.name || "friend";
  const isSub = SUB_SCREENS.has(screen);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/profile");
  };

  return (
    <header className={`echo-header ${scrolled ? "is-scrolled" : ""}`}>
      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-6">
        <div className="flex min-w-0 items-center gap-3">
          {isSub && (
            <motion.button
              type="button"
              className="icon-button shrink-0"
              aria-label="Back"
              onClick={goBack}
              whileTap={{ scale: 0.9 }}
              whileHover={{ x: -2 }}
              transition={SPRING}
            >
              <ChevronLeft size={19} />
            </motion.button>
          )}
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">
              {screen === "home" ? todayEyebrow() : isSub ? "Profile" : "Echo"}
            </p>
            <h1 className="mt-1 text-2xl font-semibold leading-tight tracking-tight text-balance">
              {TITLES[screen](name)}
            </h1>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <motion.button
            type="button"
            className="icon-button"
            aria-label="Voice capture"
            onClick={onVoice}
            whileTap={{ scale: 0.92 }}
            whileHover={{ y: -1 }}
            transition={SPRING}
          >
            <Mic size={18} />
          </motion.button>
          <motion.button
            type="button"
            className="icon-button"
            aria-label="Notifications"
            onClick={() => router.push("/profile/notifications")}
            whileTap={{ scale: 0.92 }}
            whileHover={{
              y: -1,
              rotate: [0, -14, 10, -6, 0],
              transition: { duration: 0.5 },
            }}
            transition={SPRING}
          >
            <Bell size={18} />
          </motion.button>
          <button
            type="button"
            aria-label="Profile"
            className="rounded-full transition-transform hover:scale-105 active:scale-95"
            onClick={() => router.push("/profile")}
          >
            <Avatar name={user.name || undefined} />
          </button>
        </div>
      </div>
    </header>
  );
}

/** True once the page has scrolled past a few pixels. */
function useScrolled(threshold = 8): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);
  return scrolled;
}
