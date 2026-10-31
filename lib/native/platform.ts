/**
 * @file platform.ts
 * @description Tells the web app whether it's running inside the Echo
 * Android app (Capacitor) or a normal browser.
 */

import { Capacitor } from "@capacitor/core";

/** True inside the installed app, false in a browser. */
export function isNativeApp(): boolean {
  return Capacitor.isNativePlatform();
}
