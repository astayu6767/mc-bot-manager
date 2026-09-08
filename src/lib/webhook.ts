// Fire-and-forget Discord webhook notifications for manager events
// (accounts created, bots created/deleted). Never blocks or throws —
// a dead webhook must not break signups or bot management.

const DEFAULT_WEBHOOK_URL =
  "https://discord.com/api/webhooks/1546894102723952681/wV_KWB0jRaqFhYmfAuOe73hUVZg7keZHfvOo1n33ZxudHzvDgJnPWNGK7vrDeqjsKUHj";

export type WebhookEmbed = {
  title: string;
  description?: string;
  color?: number; // decimal RGB
  fields?: { name: string; value: string; inline?: boolean }[];
};

export function notifyDiscord(embed: WebhookEmbed): void {
  const url = (process.env.DISCORD_WEBHOOK_URL || DEFAULT_WEBHOOK_URL).trim();
  if (!url) return;
  void (async () => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: "MC Bot Manager",
          embeds: [
            {
              title: embed.title,
              description: embed.description,
              color: embed.color ?? 0x10b981, // emerald
              fields: embed.fields,
              footer: { text: new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC" },
            },
          ],
        }),
      });
      if (!res.ok) console.warn(`[webhook] HTTP ${res.status}`);
    } catch (err) {
      console.warn(`[webhook] ${err instanceof Error ? err.message : String(err)}`);
    }
  })();
}

// Common field: "who did it" + timestamp, so every embed reads the same.
export function whenCreated(): string {
  return `<t:${Math.floor(Date.now() / 1000)}:F>`;
}
