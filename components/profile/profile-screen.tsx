"use client";

import { useState } from "react";
import { motion } from "motion/react";
import {
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  CreditCard,
  Settings,
  UserRound,
} from "lucide-react";
import { Header } from "@/components/home/header";
import { Avatar } from "@/components/shared";
import { Field } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { SyncSheet } from "@/components/profile/sync-sheet";
import { useRemoteUser } from "@/lib/use-remote-user";
import type { UserInfo } from "@/components/onboarding";

interface Row {
  icon: typeof UserRound;
  label: string;
  note: string;
  onClick?: () => void;
  badge?: React.ReactNode;
}

export function ProfileScreen({
  onVoice,
  scrolled,
  user,
  onUpdateUser,
}: {
  onVoice: () => void;
  scrolled: boolean;
  user: UserInfo;
  onUpdateUser: (patch: Partial<UserInfo>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [draftName, setDraftName] = useState(user.name);
  const { user: remote } = useRemoteUser();
  const displayName = user.name || "friend";

  const syncNote = remote?.email_verified_at
    ? remote.email ?? "Verified"
    : "Use Echo on another device";

  const rows: Row[] = [
    { icon: UserRound, label: "Personal details", note: "Name, email, preferences", onClick: () => setEditing(true) },
    { icon: CreditCard, label: "Connected accounts", note: "2 accounts connected" },
    {
      icon: Cloud,
      label: "Sync across devices",
      note: syncNote,
      onClick: () => setSyncing(true),
      badge: remote?.email_verified_at ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald/15 px-2 py-0.5 text-[11px] font-medium text-emerald">
          <Check size={11} /> Synced
        </span>
      ) : undefined,
    },
    { icon: Bell, label: "Notifications", note: "Evening memory prompt" },
    { icon: Settings, label: "App settings", note: "Appearance, security" },
    { icon: CircleHelp, label: "Help & support", note: "FAQs and contact" },
  ];

  return (
    <>
      <Header screen="profile" onVoice={onVoice} scrolled={scrolled} />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="profile-card">
          <Avatar size={11} name={displayName} />
          <div>
            <p className="font-semibold">{displayName}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {remote?.email_verified_at && remote.email
                ? remote.email
                : "Tap Sync below to use Echo across devices"}
            </p>
          </div>
          <button
            type="button"
            className="ml-auto text-sm font-medium text-emerald transition-transform hover:translate-x-0.5"
            onClick={() => {
              setDraftName(user.name);
              setEditing(true);
            }}
          >
            Edit
          </button>
        </div>
        <div className="panel !p-2">
          {rows.map(({ icon: Icon, label, note, onClick, badge }) => (
            <motion.button
              type="button"
              className="settings-row"
              key={label}
              onClick={onClick}
              whileTap={{
                scale: 0.99,
                backgroundColor: "oklch(0.2 0.03 255 / 70%)",
              }}
              transition={{ type: "spring", stiffness: 400, damping: 24 }}
            >
              <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
                <Icon size={17} />
              </span>
              <span className="min-w-0 flex-1 text-left">
                <span className="flex items-center gap-2">
                  <span className="block text-sm font-medium">{label}</span>
                  {badge}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {note}
                </span>
              </span>
              <ChevronRight size={17} className="text-muted-foreground" />
            </motion.button>
          ))}
        </div>
      </main>
      <BottomSheet
        open={editing}
        onClose={() => setEditing(false)}
        title="Personal details"
        subtitle="Profile"
      >
        <div className="flex flex-col gap-4">
          <Field
            label="Your first name"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            placeholder="Your first name"
          />
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Home currency
            </p>
            <Segmented
              ariaLabel="profile-currency"
              value={user.currency}
              onChange={(v) =>
                onUpdateUser({ currency: v as UserInfo["currency"] })
              }
              options={(["INR", "USD", "EUR", "GBP"] as const).map((c) => ({
                value: c,
                label: c,
              }))}
              size="sm"
            />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Memory nudge
            </p>
            <Segmented
              ariaLabel="profile-reminder"
              value={user.reminderTime}
              onChange={(v) =>
                onUpdateUser({ reminderTime: v as UserInfo["reminderTime"] })
              }
              options={(["morning", "evening", "off"] as const).map((r) => ({
                value: r,
                label:
                  r === "off" ? "Off" : r === "morning" ? "Morning" : "Evening",
              }))}
              size="sm"
            />
          </div>
          <motion.button
            type="button"
            className="primary-button"
            onClick={() => {
              if (draftName.trim()) onUpdateUser({ name: draftName.trim() });
              setEditing(false);
            }}
            whileTap={{ scale: 0.99 }}
          >
            Save
          </motion.button>
        </div>
      </BottomSheet>
      <SyncSheet open={syncing} onClose={() => setSyncing(false)} />
    </>
  );
}