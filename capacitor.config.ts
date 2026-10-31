import type { CapacitorConfig } from "@capacitor/cli";

// The app loads the running Next.js server instead of a static bundle, so
// every page and /api/* call stays same-origin and the echo_session cookie
// keeps working. The native wake-word agent reads that same cookie.
//
// CAP_SERVER_URL defaults to the Android emulator's address for the host
// machine. On a phone, point it at your computer's LAN IP or the deployed
// site, then run `npx cap sync android`.
const serverUrl = process.env.CAP_SERVER_URL ?? "http://10.0.2.2:3000";

const config: CapacitorConfig = {
  appId: "app.echo.finance",
  appName: "Echo",
  // Shown only when the server can't be reached.
  webDir: "mobile/www",
  server: {
    url: serverUrl,
    cleartext: serverUrl.startsWith("http://"),
    errorPath: "offline.html",
  },
  plugins: {
    LocalNotifications: {
      smallIcon: "ic_stat_echo",
      iconColor: "#7C5CFF",
    },
  },
};

export default config;
