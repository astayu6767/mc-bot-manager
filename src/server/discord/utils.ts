// Pure helpers for the Discord bot — no imports, so they can be unit-tested
// directly (see scripts/test-discord-utils.ts).

/** Parse "30d", "12h", "7d12h" or a bare number (days). */
export function parseDuration(input: string): { days: number; hours: number } | null {
  const s = input.trim().toLowerCase();
  if (/^\d+$/.test(s)) {
    const bare = parseInt(s, 10);
    return bare > 0 ? { days: bare, hours: 0 } : null;
  }
  const m = s.match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?$/);
  if (!m) return null;
  const days = m[1] ? parseInt(m[1], 10) : 0;
  const hours = m[2] ? parseInt(m[2], 10) : 0;
  if (days === 0 && hours === 0) return null;
  return { days, hours };
}

export const CHANNEL_EMOJI_RULES: [RegExp, string][] = [
  [/announc|news|update/, "📢"],
  [/rule|law|guide/, "📜"],
  [/ticket|support|help|assist/, "🎧"],
  [/bill|payment|purchase|shop|store|buy|ltc|crypto|checkout/, "🛒"],
  [/log/, "📋"],
  [/bot/, "🤖"],
  [/licen[sc]e|key/, "🔑"],
  [/bug|report|issue|glitch/, "🐞"],
  [/voice|vc|music|radio/, "🔊"],
  [/intro|welcome|start|info/, "👋"],
  [/memes?|spam|fun|meme/, "😈"],
  [/staff|admin|mod|team/, "🛡️"],
  [/general|chat|talk|lounge|off-?topic/, "💬"],
];

/** "💬 General Chat" → "💬-general-chat" (clean emoji-prefixed kebab name). */
export function smoothChannelName(current: string): string {
  // Strip leading emojis/symbols, keep the words
  let name = current.replace(/^[^a-z0-9]+/i, "");
  name = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!name) name = "channel";
  const emoji = CHANNEL_EMOJI_RULES.find(([re]) => re.test(name))?.[1] ?? "✨";
  return `${emoji}-${name}`;
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
