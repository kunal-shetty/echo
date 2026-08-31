/**
 * @file bottom-sheet.tsx
 * @description A sliding panel component that emerges from the bottom of the screen.
 * Supports drag-to-dismiss gestures and accessibility standards for modal dialogs.
 */

"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useDragControls } from "motion/react";
import { FADE, SPRING_SHEET } from "@/lib/motion";

interface BottomSheetProps {
  /** Control whether the sheet is visible. */
  open: boolean;
  /** Callback to trigger when the sheet is dismissed. */
  onClose: () => void;
  /** Optional heading for the sheet. */
  title?: string;
  /** Optional small text displayed above the title. */
  subtitle?: string;
  /** Content to be rendered inside the sheet. */
  children: ReactNode;
  /** Hide the drag handle. Defaults to false. */
  hideHandle?: boolean;
  /** Stop the swipe-down gesture from dismissing. */
  disableDrag?: boolean;
}

/**
 * A gesture-enabled modal panel that slides up from the bottom.
 * Handles body scroll locking and ESC key dismissal.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  hideHandle,
  disableDrag,
}: BottomSheetProps) {
  const titleId = useId();
  const [dragging, setDragging] = useState(false);
  const sheetRef = useRef<HTMLElement | null>(null);
  const dragControls = useDragControls();

  // ESC to dismiss
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const onDragEnd = useCallback(
    (_: unknown, info: { offset: { y: number }; velocity: { y: number } }) => {
      setDragging(false);
      const dismissed =
        info.offset.y > 120 || info.velocity.y > 600;
      if (dismissed) onClose();
    },
    [onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="sheet-backdrop"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={FADE}
          onClick={onClose}
        >
          <motion.section
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            className="voice-sheet"
            drag={disableDrag ? false : "y"}
            dragControls={dragControls}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragStart={() => setDragging(true)}
            onDragEnd={onDragEnd}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={SPRING_SHEET}
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "92svh", overflowY: "auto" }}
          >
            {!hideHandle && (
              <div
                className={`sheet-handle ${dragging ? "dragging" : ""}`}
                aria-hidden="true"
                onPointerDown={(e) => dragControls.start(e)}
              />
            )}
            {(title || subtitle) && (
              <div className="mb-5 flex items-start justify-between">
                <div>
                  {subtitle && <p className="eyebrow text-emerald">{subtitle}</p>}
                  {title && (
                    <h2
                      id={titleId}
                      className="mt-1 text-2xl font-semibold tracking-tight"
                    >
                      {title}
                    </h2>
                  )}
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close sheet"
                  onClick={onClose}
                >
                  <CloseIcon />
                </button>
              </div>
            )}
            {children}
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 6L6 18" />
      <path d="M6 6l12 12" />
    </svg>
  );
}
