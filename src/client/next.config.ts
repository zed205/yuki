import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide the Next.js dev-mode "N" indicator (bottom-left corner) so the dev
  // instance visually matches the legacy client, which has no such overlay.
  devIndicators: false,
};

export default nextConfig;
