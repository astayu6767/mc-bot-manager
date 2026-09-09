import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { eq } from "drizzle-orm";

// Bot settings live in the app_settings table so the Discord bot auto-resumes
// with the same token after every deploy/restart.

export const BOT_TOKEN_KEY = "discord_bot_token";
export const SITE_URL_KEY = "site_url";

export async function getSetting(key: string): Promise<string> {
  try {
    const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
    return row?.value ?? "";
  } catch {
    return "";
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

export async function deleteSetting(key: string): Promise<void> {
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

// Discord user IDs allowed to claim tickets (the server owner's accounts).
// Extend via the OWNER_DISCORD_IDS env var (comma-separated).
export const OWNER_DISCORD_IDS = new Set(
  (process.env.OWNER_DISCORD_IDS || "1484126687049289738")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean),
);

/** Public site URL used by buttons in embeds (Renew Now, Buy License, ...). */
export async function getSiteUrl(): Promise<string> {
  const stored = await getSetting(SITE_URL_KEY);
  if (stored) return stored.replace(/\/+$/, "");
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/+$/, "");
  if (process.env.RAILWAY_PUBLIC_DOMAIN) return `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`;
  return "";
}
