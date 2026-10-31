import type { CapacitorConfig } from "@capacitor/cli";

// The app loads the running Next.js server instead of a static bundle, so
// every page and /api/* call stays same-origin and the echo_session cookie
// keeps working. The native wake-word agent reads that same cookie.
//
// Defaults to the production site. To test against your machine, set
// CAP_SERVER_URL=http://<your-LAN-IP>:3000 and run `npm run android:sync`.
const serverUrl = process.env.CAP_SERVER_URL ?? "https://echomoney.vercel.app";

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
