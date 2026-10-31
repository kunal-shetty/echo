/**
 * @file haptics.ts
 * @description One call for vibration feedback. Uses the phone's haptic
 * engine inside the app and the Vibration API in browsers that have it.
 * Users can turn haptics off in App settings.
 */

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNativeApp } from "./platform";

/**
 * - tap: a button press
 * - success / warning / error: the outcome of an action
 */
export type HapticKind = "tap" | "success" | "warning" | "error";

const STORAGE_KEY = "echo-haptics-v1";

/** Browser fallback patterns, in ms (vibrate, pause, vibrate...). */
const WEB_PATTERNS: Record<HapticKind, number | number[]> = {
  tap: 10,
  success: [20, 60, 40],
  warning: [60, 80, 60],
  error: [120, 80, 120],
};

export function hapticsEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    /* noop */
  }
}

/** Plays a haptic. Never throws; does nothing where unsupported. */
export function haptic(kind: HapticKind = "tap"): void {
  if (typeof window === "undefined" || !hapticsEnabled()) return;

  if (isNativeApp()) {
    const done =
      kind === "tap"
        ? Haptics.impact({ style: ImpactStyle.Light })
        : Haptics.notification({
            type:
              kind === "success"
                ? NotificationType.Success
                : kind === "warning"
                  ? NotificationType.Warning
                  : NotificationType.Error,
          });
    done.catch(() => {
      /* noop */
    });
    return;
  }

  try {
    navigator.vibrate?.(WEB_PATTERNS[kind]);
  } catch {
    /* noop */
  }
}
