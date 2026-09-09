import type { Client } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { db } from "@/db";
import { licenses, licenseReminders, users } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { brandEmbed, BRAND, fullDate } from "./embeds";
import { getSiteUrl } from "./settings";

// Daily-ish check (every 6h, deduped) that DMs users before their license
// expires: once at 5 days out and once at 1 day out.

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

const globalForReminders = globalThis as typeof globalThis & {
  __mcbmReminderTimer?: ReturnType<typeof setInterval>;
};

export function startReminderLoop(client: Client): void {
  stopReminderLoop();
  void runLicenseReminderCheck(client);
  globalForReminders.__mcbmReminderTimer = setInterval(() => {
    void runLicenseReminderCheck(client);
  }, CHECK_INTERVAL_MS);
}

export function stopReminderLoop(): void {
  if (globalForReminders.__mcbmReminderTimer) {
    clearInterval(globalForReminders.__mcbmReminderTimer);
    globalForReminders.__mcbmReminderTimer = undefined;
  }
}

async function alreadySent(licenseId: string, kind: "5d" | "1d"): Promise<boolean> {
  const [row] = await db
    .select({ id: licenseReminders.id })
    .from(licenseReminders)
    .where(and(eq(licenseReminders.licenseId, licenseId), eq(licenseReminders.kind, kind)))
    .limit(1);
  return Boolean(row);
}

export async function runLicenseReminderCheck(client: Client): Promise<void> {
  try {
    const siteUrl = await getSiteUrl();
    const active = await db.select().from(licenses).where(eq(licenses.active, "true"));
    const now = Date.now();

    for (const license of active) {
      const expiresAt = license.expiresAt.getTime();
      const daysLeft = (expiresAt - now) / (1000 * 60 * 60 * 24);
      if (daysLeft <= 0) continue;

      let kind: "5d" | "1d" | null = null;
      if (daysLeft <= 1.25) kind = "1d";
      else if (daysLeft <= 5.25) kind = "5d";
      if (!kind) continue;
      if (await alreadySent(license.id, kind)) continue;

      // Find the linked Discord account to DM
      const [user] = await db.select().from(users).where(eq(users.id, license.userId));
      const discordId = user?.discordId ?? "";
      // Real Discord snowflakes are numeric — skip local/dev accounts
      if (!/^\d+$/.test(discordId)) {
        await db.insert(licenseReminders).values({ licenseId: license.id, kind, discordId });
        continue;
      }

      try {
        const discordUser = await client.users.fetch(discordId);
        const embed = brandEmbed({
          title: kind === "1d" ? "Your license expires tomorrow" : "Your license expires in a few days",
          description:
            kind === "1d"
              ? "This is your last reminder — renew now to keep your bots online."
              : "Heads up — renew early so your bots never go offline.",
          color: kind === "1d" ? BRAND.rose : BRAND.amber,
        });
        embed.addFields(
          { name: "Slots", value: `${license.slots} bot slots`, inline: true },
          { name: "Expires", value: fullDate(license.expiresAt), inline: true },
        );
        const rows = siteUrl
          ? [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder().setLabel("Renew Now").setStyle(ButtonStyle.Link).setURL(`${siteUrl}/#shop`),
              ),
            ]
          : [];
        await discordUser.send({ embeds: [embed], components: rows });
      } catch {
        // DMs closed or user unreachable — still record so we don't spam retry
        console.warn(`[discord-bot] reminder DM failed for ${discordId}`);
      }

      await db.insert(licenseReminders).values({ licenseId: license.id, kind, discordId });
    }
  } catch (err) {
    console.warn(`[discord-bot] reminder check failed: ${err instanceof Error ? err.message : err}`);
  }
}
