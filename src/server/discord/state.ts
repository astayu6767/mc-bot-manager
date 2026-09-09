import type { Client } from "discord.js";

// Runtime state lives on globalThis (same trick as the pg pool) so it survives
// Next.js module reloads. Kept in its own module with zero imports so every
// file can read it without creating import cycles.

export type BotRuntimeState = {
  client: Client | null;
  starting: boolean;
  running: boolean;
  tag: string;
  applicationId: string;
  startedAt: number;
  lastError: string;
  // true when Message Content Intent is disabled — transcripts are degraded
  degraded: boolean;
};

const globalForBot = globalThis as typeof globalThis & {
  __mcbmDiscordBot?: BotRuntimeState;
};

export function botState(): BotRuntimeState {
  if (!globalForBot.__mcbmDiscordBot) {
    globalForBot.__mcbmDiscordBot = {
      client: null,
      starting: false,
      running: false,
      tag: "",
      applicationId: "",
      startedAt: 0,
      lastError: "",
      degraded: false,
    };
  }
  return globalForBot.__mcbmDiscordBot;
}
