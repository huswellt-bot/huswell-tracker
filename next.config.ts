import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      new URL("https://www.huswelltrading.com/logo/huswell-logo.png"),
    ],
  },
};

export default nextConfig;
