"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import {
  Bell,
  Check,
  ChevronRight,
  CircleHelp,
  Cloud,
  CreditCard,
  Ear,
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
import { useApp } from "@/context/AppContext";
import { EASE_OUT } from "@/lib/motion";
import type { UserInfo } from "@/components/onboarding";

interface Row {
  icon: typeof UserRound;
  label: string;
  note: string;
  onClick?: () => void;
  badge?: React.ReactNode;
}

export function ProfileScreen() {
  const router = useRouter();
  const { user, updateUser, setVoiceOpen } = useApp();
  const [editing, setEditing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [draftName, setDraftName] = useState(user.name);
  const { user: remote } = useRemoteUser();
  const displayName = user.name || "User";

  // Seed the draft from the saved name each time, so an abandoned edit
  // (or a name that loaded after mount) never shows stale text.
  const openEditor = () => {
    setDraftName(user.name);
    setEditing(true);
  };

  const syncNote = remote?.email_verified_at
    ? (remote.email ?? "Verified")
    : "Use Echo on another device";

  const rows: Row[] = [
    {
      icon: UserRound,
      label: "Personal details",
      note: "Name, currency, reminders",
      onClick: openEditor,
    },
    {
      icon: CreditCard,
      label: "Connected accounts",
      note: "Link a bank or card",
      badge: <span className="badge-soon">Soon</span>,
    },
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
    {
      icon: Ear,
      label: "Voice agent",
      note: "Name it, then talk to it hands-free",
      onClick: () => router.push("/profile/agent"),
    },
    {
      icon: Bell,
      label: "Notifications",
      note:
        user.reminderTime === "off"
          ? "Daily nudge off"
          : `Daily nudge in the ${user.reminderTime}`,
      onClick: () => router.push("/profile/notifications"),
    },
    {
      icon: Settings,
      label: "App settings",
      note: "Appearance, security",
      onClick: () => router.push("/profile/settings"),
    },
    {
      icon: CircleHelp,
      label: "Help & support",
      note: "FAQs and contact",
      onClick: () => router.push("/profile/help"),
    },
  ];

  return (
    <>
      <Header
        screen="profile"
        onVoice={() => setVoiceOpen(true)}
      />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <motion.div
          className="profile-card relative overflow-hidden"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
        >
          <Avatar size={12} name={displayName} />
          <div className="min-w-0">
            <p className="font-semibold">{displayName}</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {remote?.email_verified_at && remote.email
                ? remote.email
                : "Tap Sync below to use Echo across devices"}
            </p>
          </div>
          <button
            type="button"
            className="ml-auto shrink-0 rounded-lg px-2 py-1 text-sm font-medium text-emerald transition-colors hover:bg-emerald/10"
            onClick={openEditor}
          >
            Edit
          </button>
        </motion.div>
        <div className="panel !p-2 echo-stagger">
          {rows.map(({ icon: Icon, label, note, onClick, badge }) => (
            <motion.button
              type="button"
              className="settings-row"
              key={label}
              onClick={onClick}
              disabled={!onClick}
              whileTap={onClick ? { scale: 0.985 } : undefined}
              transition={{ type: "spring", stiffness: 400, damping: 24 }}
            >
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-surface-3 text-muted-foreground ring-1 ring-border">
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
              {onClick && (
                <ChevronRight
                  size={17}
                  className="chevron shrink-0 text-muted-foreground"
                />
              )}
            </motion.button>
          ))}
        </div>
        <div className="flex justify-center gap-4 py-4">
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => router.push("/profile/privacy")}
          >
            Privacy Policy
          </button>
          <span className="text-xs text-muted-foreground">•</span>
          <button
            type="button"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => router.push("/profile/terms")}
          >
            Terms of Service
          </button>
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
                updateUser({ currency: v as UserInfo["currency"] })
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
                updateUser({ reminderTime: v as UserInfo["reminderTime"] })
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
            disabled={!draftName.trim()}
            onClick={() => {
              updateUser({ name: draftName.trim() });
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
