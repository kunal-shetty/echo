import type { NextConfig } from "next";

// Every /api/* request is served by the FastAPI backend in backend/. Proxying
// keeps the browser on one origin, so the echo_session cookie stays
// first-party and no CORS setup is needed.
const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${BACKEND_URL}/api/:path*` }];
  },
};

export default nextConfig;
