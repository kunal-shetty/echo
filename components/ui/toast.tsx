/**
 * @file toast.tsx
 * @description A small animated notification pill.
 * Dismissal is timed by `AppContext`; this component only renders.
 */

"use client";

import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "lucide-react";
import { SPRING_SNAPPY } from "@/lib/motion";
import type { ToastState } from "@/context/AppContext";

/**
 * A floating notification that springs up above the bottom nav.
 * A new `toast.id` replaces the current pill with a fresh animation.
 */
export function Toast({ toast }: { toast: ToastState | null }) {
  return (
    <AnimatePresence mode="popLayout">
      {toast && (
        <motion.div
          key={toast.id}
          className="toast"
          data-tone={toast.tone}
          role={toast.tone === "error" ? "alert" : "status"}
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          initial={{ opacity: 0, y: 16, scale: 0.92, x: "-50%" }}
          animate={{ opacity: 1, y: 0, scale: 1, x: "-50%" }}
          exit={{ opacity: 0, y: 8, scale: 0.96, x: "-50%" }}
          transition={SPRING_SNAPPY}
        >
          <motion.span
            className="toast-icon"
            initial={{ scale: 0, rotate: -45 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ ...SPRING_SNAPPY, delay: 0.08 }}
          >
            {toast.tone === "error" ? (
              <X size={13} strokeWidth={2.8} />
            ) : (
              <Check size={13} strokeWidth={2.8} />
            )}
          </motion.span>
          <span>{toast.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
