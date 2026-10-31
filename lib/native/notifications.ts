/**
 * @file notifications.ts
 * @description The daily "memory nudge" as a local notification. It's
 * scheduled on the phone, so it works offline and needs no push server.
 */

import { LocalNotifications } from "@capacitor/local-notifications";
import type { UserInfo } from "@/lib/schema";
import { isNativeApp } from "./platform";

export const REMINDER_NOTIFICATION_ID = 1001;

const REMINDER_HOURS: Record<Exclude<UserInfo["reminderTime"], "off">, number> = {
  morning: 9,
  evening: 21,
};

/**
 * Schedules (or cancels) the daily nudge to match the user's reminder
 * setting. Asks for notification permission the first time.
 * Returns false if notifications aren't allowed.
 */
export async function syncDailyReminder(
  reminderTime: UserInfo["reminderTime"],
  agentName: string,
): Promise<boolean> {
  if (!isNativeApp()) return false;

  await LocalNotifications.cancel({
    notifications: [{ id: REMINDER_NOTIFICATION_ID }],
  });
  if (reminderTime === "off") return true;

  let { display } = await LocalNotifications.checkPermissions();
  if (display === "prompt" || display === "prompt-with-rationale") {
    ({ display } = await LocalNotifications.requestPermissions());
  }
  if (display !== "granted") return false;

  await LocalNotifications.schedule({
    notifications: [
      {
        id: REMINDER_NOTIFICATION_ID,
        title:
          reminderTime === "morning"
            ? "Anything from yesterday?"
            : "How did today go?",
        body: `Just say “${agentName}” and tell me what you spent.`,
        schedule: {
          on: { hour: REMINDER_HOURS[reminderTime], minute: 0 },
          allowWhileIdle: true,
        },
        extra: { kind: "reminder" },
      },
    ],
  });
  return true;
}
