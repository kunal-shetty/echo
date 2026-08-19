"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Plus, PencilLine, FileSpreadsheet, Tag } from "lucide-react";

interface FabProps {
  visible?: boolean;
  onPickSingle: () => void;
  onPickBulk: () => void;
  onPickCategory: () => void;
}

interface Action {
  key: string;
  label: string;
  Icon: typeof Plus;
  onPick: () => void;
}

export function Fab({ visible = true, onPickSingle, onPickBulk, onPickCategory }: FabProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const actions: Action[] = [
    { key: "single", label: "Single memory", Icon: PencilLine, onPick: onPickSingle },
    { key: "bulk", label: "Bulk add", Icon: FileSpreadsheet, onPick: onPickBulk },
    { key: "category", label: "New category", Icon: Tag, onPick: onPickCategory },
  ];

  const handlePick = (a: Action) => () => {
    setOpen(false);
    a.onPick();
  };

  if (!visible) return null;

  return (
    <>
      {/* Backdrop tap-to-close; invisible but receives pointer events. */}
      <AnimatePresence>
        {open && (
          <motion.button
            type="button"
            aria-label="Close add menu"
            className="fab-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      <div className="fab-root">
        <AnimatePresence>
          {open &&
            actions.map((a, i) => (
              <motion.div
                key={a.key}
                className="fab-action"
                role="menuitem"
                tabIndex={-1}
                initial={{ opacity: 0, y: 10, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 6, scale: 0.95 }}
                transition={{
                  duration: 0.18,
                  ease: [0.16, 1, 0.3, 1],
                  delay: (actions.length - 1 - i) * 0.04,
                }}
              >
                <button
                  type="button"
                  onClick={handlePick(a)}
                  className="flex items-center gap-2"
                >
                  <a.Icon size={15} className="text-muted-foreground" />
                  <span>{a.label}</span>
                </button>
              </motion.div>
            ))}
        </AnimatePresence>

        <motion.button
          type="button"
          className="fab-main"
          aria-label={open ? "Close add menu" : "Add a memory"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          whileTap={{ scale: 0.94 }}
        >
          <motion.span
            animate={{ rotate: open ? 45 : 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="grid place-items-center"
          >
            <Plus size={22} />
          </motion.span>
        </motion.button>
      </div>
    </>
  );
}
