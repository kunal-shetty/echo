"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Field } from "@/components/ui/field";
import { IconPicker } from "@/components/ui/icon-picker";
import { useCategories } from "@/lib/use-categories";
import type { DbCategory } from "@/lib/server/categories";
import type { Tone } from "@/lib/schema";
import type { IconName } from "@/lib/icon-vocab";

interface CategorySheetProps {
  open: boolean;
  onClose: () => void;
  /** When provided, the sheet edits the existing row instead of creating one. */
  initial?: { id: string; name: string; icon: string | null; tone: Tone };
  onSaved: (cat: DbCategory) => void;
  onDeleteBlocked?: (message: string) => void;
}

export function CategorySheet({
  open,
  onClose,
  initial,
  onSaved,
  onDeleteBlocked,
}: CategorySheetProps) {
  const cats = useCategories();
  const [name, setName] = useState("");
  const [icon, setIcon] = useState<IconName | null>(null);
  const [tone, setTone] = useState<Tone>("neutral");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initial) {
      setName(initial.name);
      setIcon((initial.icon as IconName | null) ?? null);
      setTone(initial.tone);
    } else {
      setName("");
      setIcon(null);
      setTone("neutral");
    }
    setError(null);
  }, [open, initial]);

  const canSave = name.trim().length > 0 && name.trim().length <= 40 && !submitting;

  const handleSave = async () => {
    if (!canSave) return;
    setSubmitting(true);
    setError(null);
    try {
      if (initial) {
        const updated = await cats.update(initial.id, {
          name: name.trim(),
          icon,
          tone,
        });
        if (updated) onSaved(updated);
      } else {
        const created = await cats.create({
          name: name.trim(),
          icon,
          tone,
        });
        if (created) onSaved(created);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!initial) return;
    setDeleting(true);
    setError(null);
    try {
      const ok = await cats.remove(initial.id);
      if (ok) {
        onClose();
      } else {
        const msg = "Category is in use — reassign its memories first";
        setError(msg);
        onDeleteBlocked?.(msg);
      }
    } finally {
      setDeleting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={initial ? "Edit category" : "New category"}
      subtitle={initial ? "Category" : "Categories"}
    >
      <div className="flex flex-col gap-5">
        <Field
          label="Name"
          placeholder="e.g. Coffee Runs"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          autoFocus
          invalid={error != null}
        />

        <IconPicker
          label="Icon & tone"
          icon={icon}
          tone={tone}
          onChange={(next) => {
            setIcon(next.icon);
            setTone(next.tone);
          }}
        />

        {error && (
          <p className="rounded-xl border border-red/40 bg-red/10 px-3.5 py-2.5 text-xs text-red">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          {initial && (
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Delete category"
              className="secondary-button disabled:opacity-50"
            >
              <Trash2 size={16} />
              {deleting ? "Deleting…" : "Delete"}
            </button>
          )}
          <button
            type="button"
            className="primary-button disabled:opacity-50"
            onClick={handleSave}
            disabled={!canSave}
          >
            {submitting ? "Saving…" : initial ? "Save changes" : "Create"}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
