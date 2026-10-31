import type { NextConfig } from "next";

// Every /api/* request is served by the FastAPI backend in backend/. Proxying
// keeps the browser on one origin, so the echo_session cookie stays
// first-party and no CORS setup is needed.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

// The Android emulator reaches the dev server as 10.0.2.2. Add a phone's
// view of your machine (its LAN IP) with DEV_ORIGINS=192.168.1.20,...
const devOrigins = ["10.0.2.2", ...(process.env.DEV_ORIGINS?.split(",") ?? [])]
  .map((o) => o.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: devOrigins,
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
