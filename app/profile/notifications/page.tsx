"use client";

import { useEffect, useState } from "react";
import { Header } from "@/components/home/header";
import { Segmented } from "@/components/ui/segmented";
import { useApp } from "@/context/AppContext";
import { Bell, Ear } from "lucide-react";
import { isNativeApp } from "@/lib/native/platform";
import type { UserInfo } from "@/lib/schema";

export default function NotificationsPage() {
  const { setVoiceOpen, user, updateUser } = useApp();
  const [native, setNative] = useState(false);
  useEffect(() => setNative(isNativeApp()), []);

  return (
    <>
      <Header
        screen="notifications"
        onVoice={() => setVoiceOpen(true)}
      />
      <main className="flex flex-col gap-5 px-5 pb-28">
        <div className="panel !p-2">
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Bell size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Daily memory nudge</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {native
                  ? "A reminder to tell Echo what you spent: 9 AM or 9 PM."
                  : "Install the Android app to get reminders on your phone."}
              </span>
            </span>
          </div>
          <div className="px-3 pb-3">
            <Segmented
              ariaLabel="reminder-time"
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
          <div className="settings-row">
            <span className="grid size-9 place-items-center rounded-xl bg-surface-3 text-muted-foreground">
              <Ear size={17} />
            </span>
            <span className="min-w-0 flex-1 text-left">
              <span className="block text-sm font-medium">Agent replies</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                Your voice agent posts what it saved or answered, so you can
                check it later. Manage it in Android&apos;s notification
                settings.
              </span>
            </span>
          </div>
        </div>
      </main>
    </>
  );
}
