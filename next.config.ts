import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["mineflayer", "minecraft-protocol", "prismarine-auth", "socks", "discord.js"],
};

export default nextConfig;
