import { notifyDiscord, type WebhookEmbed } from "@/lib/webhook";

// Website-event logging. Preferred path: the Admin Bot posts a branded embed
// into the matching logs-* channel. If the bot isn't running (or no channel
// exists), we fall back to the classic webhook so notifications never die.
// Fire-and-forget: logging must never break the request that triggered it.

export type SiteEvent = {
  title: string;
  description?: string;
  color?: number;
  fields?: { name: string; value: string; inline?: boolean }[];
};

/**
 * Ask the Discord bot to re-render its tracked purchase panels (fire and
 * forget — never blocks or breaks the request that triggered it).
 */
export function refreshDiscordPanels(): void {
  void (async () => {
    try {
      const { refreshPurchasePanels } = await import("@/server/discord/panels");
      await refreshPurchasePanels();
    } catch (err) {
      console.warn(`[eventLog] panel refresh failed: ${err instanceof Error ? err.message : err}`);
    }
  })();
}

export function logDiscordEvent(
  kind: "signup" | "purchase" | "bot" | "error",
  event: SiteEvent,
): void {
  void (async () => {
    try {
      const { sendToLogChannels } = await import("@/server/discord/bot");
      const sent = await sendToLogChannels(kind, event);
      if (sent > 0) return;

      // Fallback: classic webhook (same look as before the bot existed)
      const legacy: WebhookEmbed = {
        title: event.title,
        description: event.description,
        color: event.color,
        fields: event.fields,
      };
      notifyDiscord(legacy);
    } catch (err) {
      console.warn(`[eventLog] ${err instanceof Error ? err.message : err}`);
    }
  })();
}
