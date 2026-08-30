import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep heavy native deps external to avoid bundling them and to reduce NFT tracing issues
  serverExternalPackages: [
    "mineflayer",
    "minecraft-protocol",
    "prismarine-auth",
    "socks",
    "minecraft-data",
    "prismarine-chat",
    "node-minecraft-protocol",
  ],
  // Prevent Turbopack from tracing the entire project due to filesystem ops in bot engines
  // Using __dirname avoids path.join which itself triggers the NFT warning
  outputFileTracingRoot: __dirname,
  outputFileTracingExcludes: {
    "*": [
      "node_modules/@swc/core-linux-x64-gnu",
      "node_modules/@swc/core-linux-x64-musl",
      "node_modules/@esbuild/linux-x64",
      ".next/cache/**",
      "**/*.map",
    ],
  },
};

export default nextConfig;
