import { db } from "@/db";
import { discordPanels, shopPlans } from "@/db/schema";
import { eq } from "drizzle-orm";
import { botState } from "./state";
import { getSiteUrl } from "./settings";
import { buildPurchasePanelPayload } from "./purchasePanel";

// Auto-updating purchase panels: every posted /purchase-panel message is
// tracked in discord_panels and re-rendered whenever plans change on the
// website (create / edit / delete) or the bot restarts.

/** Remember (or replace) the purchase panel message for a channel. */
export async function savePanelRef(
  guildId: string,
  channelId: string,
  messageId: string,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(discordPanels)
    .where(eq(discordPanels.channelId, channelId));
  if (existing) {
    await db
      .update(discordPanels)
      .set({ guildId, messageId, updatedAt: new Date() })
      .where(eq(discordPanels.id, existing.id));
  } else {
    await db.insert(discordPanels).values({ guildId, channelId, messageId, kind: "purchase" });
  }
}

/**
 * Re-render every tracked purchase panel with fresh plan data. Called from
 * the shop admin routes (fire-and-forget) and once on bot startup. Panels
 * whose message was deleted are dropped from tracking.
 */
export async function refreshPurchasePanels(): Promise<number> {
  const state = botState();
  if (!state.running || !state.client) return 0;

  const panels = await db.select().from(discordPanels).where(eq(discordPanels.kind, "purchase"));
  if (panels.length === 0) return 0;

  const plans = (await db.select().from(shopPlans).where(eq(shopPlans.active, "true"))).sort(
    (a, b) => a.price - b.price,
  );
  const siteUrl = await getSiteUrl();
  const payload = buildPurchasePanelPayload(plans, siteUrl);

  let updated = 0;
  for (const panel of panels) {
    try {
      const channel = await state.client.channels.fetch(panel.channelId);
      if (!channel || !channel.isTextBased()) {
        await db.delete(discordPanels).where(eq(discordPanels.id, panel.id));
        continue;
      }
      const message = await channel.messages.fetch(panel.messageId);
      await message.edit({ embeds: payload.embeds, components: payload.components });
      updated++;
    } catch {
      // Message deleted, channel gone, or missing perms — stop tracking.
      await db.delete(discordPanels).where(eq(discordPanels.id, panel.id));
    }
  }
  if (updated > 0) console.log(`[discord-bot] refreshed ${updated} purchase panel(s)`);
  return updated;
}
