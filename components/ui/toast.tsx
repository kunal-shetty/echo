/**
 * @file toast.tsx
 * @description A simple, animated notification toast.
 * Displays a success message and automatically dismisses after a delay.
 */

"use client";

import { AnimatePresence, motion } from "motion/react";
import { SPRING_SNAPPY } from "@/lib/motion";

interface ToastProps {
  /** The message to display. If null, the toast is hidden. */
  message: string | null;
  /** Callback triggered after the auto-dismiss timeout. */
  onDismiss?: () => void;
}

/**
 * A small, floating notification that appears at the bottom of the screen.
 * Auto-dismisses after 1.8 seconds of being active.
 */
export function Toast({ message, onDismiss }: ToastProps) {
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="toast"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 12, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={SPRING_SNAPPY}
          onAnimationComplete={(d) => {
            if (d === "animate" && onDismiss) {
              const id = setTimeout(onDismiss, 1800);
              return () => clearTimeout(id);
            }
          }}
        >
          <CheckIcon />
          <span>{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="text-emerald"
    >
      <path d="M20 6L9 17l-5-5" />
    </svg>
  );
}
