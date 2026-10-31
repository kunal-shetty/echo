"use client";

/**
 * Connects the web app to the phone when running inside the Android app:
 * keeps the daily nudge scheduled, shows what the background agent did,
 * refreshes data when the app comes back, and hands the microphone to the
 * voice sheet while it's open. Renders nothing; a no-op in browsers.
 */

import { useEffect, useRef } from "react";
import { App } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import { useApp } from "@/context/AppContext";
import { useTransactions } from "@/lib/use-transactions";
import { DEFAULT_AGENT_NAME, EchoAgent, onAgentEvent } from "@/lib/native/agent";
import { haptic } from "@/lib/native/haptics";
import { syncDailyReminder } from "@/lib/native/notifications";
import { isNativeApp } from "@/lib/native/platform";

export function NativeBridge() {
  const { user, onboarded, voiceOpen, setVoiceOpen, setToast } = useApp();
  const { refresh, ingest } = useTransactions();

  // Latest callbacks for long-lived native listeners.
  const latest = useRef({ refresh, ingest, setToast, setVoiceOpen });
  useEffect(() => {
    latest.current = { refresh, ingest, setToast, setVoiceOpen };
  });

  // Daily nudge follows the reminder setting (asks permission once).
  useEffect(() => {
    if (!isNativeApp() || !onboarded) return;
    void (async () => {
      const name = await EchoAgent.getStatus()
        .then((s) => s.name)
        .catch(() => DEFAULT_AGENT_NAME);
      await syncDailyReminder(user.reminderTime, name).catch(() => false);
    })();
  }, [user.reminderTime, onboarded]);

  // What the background agent did while the app was open (or queued while
  // it was closed): show it and update the list.
  useEffect(
    () =>
      onAgentEvent("turn", ({ reply }) => {
        const { ingest, refresh, setToast } = latest.current;
        if (reply.transaction) ingest(reply.transaction);
        else if (reply.deletedId) void refresh();
        if (reply.spoken) setToast(reply.spoken);
      }),
    [],
  );

  // Coming back to the app: the agent may have saved things meanwhile.
  // Tapping the daily nudge opens the voice sheet.
  useEffect(() => {
    if (!isNativeApp()) return;
    const handles: Promise<PluginListenerHandle>[] = [
      App.addListener("resume", () => void latest.current.refresh()),
      LocalNotifications.addListener("localNotificationActionPerformed", (e) => {
        if (e.notification.extra?.kind === "reminder") {
          haptic("tap");
          latest.current.setVoiceOpen(true);
        }
      }),
    ];
    return () => {
      for (const h of handles) void h.then((x) => x.remove());
    };
  }, []);

  // Android gives the mic to one recorder at a time: pause the agent while
  // the voice sheet records.
  useEffect(() => {
    if (!isNativeApp()) return;
    void (voiceOpen ? EchoAgent.pause() : EchoAgent.resume()).catch(() => {});
  }, [voiceOpen]);

  return null;
}
