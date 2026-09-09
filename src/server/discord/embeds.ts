import { EmbedBuilder } from "discord.js";

// Brand palette — mirrors the dashboard: emerald accent, deep slate surfaces,
// indigo for informational, amber for warnings, rose for destructive.
export const BRAND = {
  emerald: 0x10b981,
  slate: 0x0f172a,
  indigo: 0x6366f1,
  amber: 0xf59e0b,
  rose: 0xf43f5e,
  violet: 0x8b5cf6,
  blurple: 0x5865f2,
};

export const BRAND_FOOTER = "MC Bot Manager";

/** Minimal, consistent card embed used across all bot output. */
export function brandEmbed(opts: {
  title?: string;
  description?: string;
  color?: number;
}): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(opts.color ?? BRAND.emerald)
    .setFooter({ text: BRAND_FOOTER })
    .setTimestamp(new Date());
  if (opts.title) embed.setTitle(opts.title);
  if (opts.description) embed.setDescription(opts.description);
  return embed;
}

/** Turn "a, b, c" or newline-separated input into "- a\n- b\n- c" bullets. */
export function bullets(input: string): string {
  return input
    .split(/[,\n]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join("\n");
}

/** Discord-relative timestamp ("in 3 days"). */
export function relative(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:R>`;
}

/** Discord long date+time timestamp. */
export function fullDate(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}
