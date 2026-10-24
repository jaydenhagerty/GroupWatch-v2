import type { NextConfig } from "next";

const nextConfig = {
  output: "export",
  images: {
    // next/image's optimizer endpoint doesn't exist on static exports (Firebase Hosting).
    unoptimized: true,
  },
};

export default nextConfig;