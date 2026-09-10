import {
  ActivityType,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
} from "discord.js";
import { handleInteraction, syncCommandsToGuild } from "./commands";
import { startReminderLoop, stopReminderLoop } from "./reminders";
import { botState } from "./state";
import { BOT_TOKEN_KEY, getSetting } from "./settings";

export { botState } from "./state";
export {
  BOT_TOKEN_KEY,
  SITE_URL_KEY,
  getSetting,
  setSetting,
  deleteSetting,
  getSiteUrl,
} from "./settings";

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

function fullIntents() {
  return [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // privileged — needed for ticket transcripts
  ];
}

function baseIntents() {
  return [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages];
}

/**
 * Start (or restart) the Discord bot with the given token.
 * If login fails because the Message Content privileged intent is disabled in
 * the developer portal, retries once without it (transcripts become degraded).
 */
export async function startDiscordBot(token: string): Promise<void> {
  const clean = token.trim();
  if (!clean) throw new Error("Bot token is required");

  const state = botState();
  if (state.starting) throw new Error("Bot is already starting — give it a few seconds");
  if (state.running) await stopDiscordBot();

  state.starting = true;
  state.lastError = "";

  try {
    await loginWithIntents(clean, fullIntents(), false);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/disallowed intents/i.test(msg)) {
      // Privileged intent disabled — retry without transcripts support.
      await loginWithIntents(clean, baseIntents(), true);
    } else {
      state.starting = false;
      throw new Error(friendlyLoginError(msg));
    }
  }
}

function friendlyLoginError(msg: string): string {
  if (/invalid token|unauthorized|401/i.test(msg)) {
    return "Invalid bot token — copy it again from the Discord Developer Portal (Bot → Reset Token).";
  }
  return msg;
}

async function loginWithIntents(token: string, intents: number[], degraded: boolean): Promise<void> {
  const state = botState();
  const client = new Client({ intents });

  client.once(Events.ClientReady, async (ready) => {
    state.client = client;
    state.running = true;
    state.tag = ready.user.tag;
    state.applicationId = ready.application?.id ?? "";
    state.startedAt = Date.now();
    state.degraded = degraded;
    state.starting = false;

    ready.user.setPresence({
      status: "online",
      activities: [{ name: "the dashboard", type: ActivityType.Watching }],
    });

    // Register slash commands in every guild (instant, no global propagation delay)
    for (const [, guild] of ready.guilds.cache) {
      void syncCommandsToGuild(client, guild.id);
    }

    startReminderLoop(client);
    // Catch purchase panels up with any website changes made while offline.
    try {
      const { refreshPurchasePanels } = await import("./panels");
      void refreshPurchasePanels();
    } catch {}
    console.log(`[discord-bot] online as ${state.tag} (${ready.guilds.cache.size} servers)`);
  });

  client.on(Events.GuildCreate, (guild) => {
    void syncCommandsToGuild(client, guild.id);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction);
  });

  client.on(Events.Error, (err) => {
    console.warn(`[discord-bot] client error: ${err.message}`);
  });

  try {
    await client.login(token);
  } catch (err) {
    try {
      client.destroy();
    } catch {}
    throw err;
  }
}

export async function stopDiscordBot(): Promise<void> {
  const state = botState();
  stopReminderLoop();
  if (state.client) {
    try {
      await state.client.destroy();
    } catch {}
  }
  state.client = null;
  state.running = false;
  state.tag = "";
  state.applicationId = "";
  state.startedAt = 0;
  state.degraded = false;
  console.log("[discord-bot] stopped");
}

/** Auto-start on server boot when a token was saved previously. */
export async function startSavedDiscordBot(): Promise<void> {
  const token = await getSetting(BOT_TOKEN_KEY);
  if (!token) return;
  const state = botState();
  if (state.running || state.starting) return;
  try {
    await startDiscordBot(token);
  } catch (err) {
    console.warn(`[discord-bot] auto-start failed: ${err instanceof Error ? err.message : err}`);
  }
}

export function getBotStatus() {
  const state = botState();
  return {
    running: state.running,
    starting: state.starting,
    tag: state.tag,
    applicationId: state.applicationId,
    guildCount: state.client?.guilds.cache.size ?? 0,
    uptimeSec: state.startedAt ? Math.floor((Date.now() - state.startedAt) / 1000) : 0,
    degraded: state.degraded,
    lastError: state.lastError,
  };
}

export function setBotError(message: string): void {
  botState().lastError = message;
}

// ---------------------------------------------------------------------------
// Website-event logging — used by src/lib/eventLog.ts
// ---------------------------------------------------------------------------

export const LOG_CHANNEL_NAMES = {
  signup: "logs-signups",
  purchase: "logs-purchases",
  bot: "logs-bots",
  error: "logs-errors",
} as const;

export type LogKind = keyof typeof LOG_CHANNEL_NAMES;

/**
 * Send an event embed to every `logs-*` channel that exists. Returns how many
 * channels received it (0 = nobody logged it, caller can fall back).
 */
export async function sendToLogChannels(
  kind: LogKind,
  event: { title: string; description?: string; color?: number; fields?: { name: string; value: string; inline?: boolean }[] },
): Promise<number> {
  const state = botState();
  if (!state.running || !state.client) return 0;
  const name = LOG_CHANNEL_NAMES[kind];
  const embed = new EmbedBuilder()
    .setTitle(event.title)
    .setColor(event.color ?? 0x10b981)
    .setFooter({ text: "MC Bot Manager" })
    .setTimestamp(new Date());
  if (event.description) embed.setDescription(event.description);
  if (event.fields) embed.addFields(event.fields);

  let sent = 0;
  for (const [, guild] of state.client.guilds.cache) {
    const channels = guild.channels.cache.filter(
      (c) => c.type === ChannelType.GuildText && c.name === name,
    );
    for (const [, channel] of channels) {
      try {
        const text = channel as import("discord.js").TextChannel;
        await text.send({ embeds: [embed] });
        sent++;
      } catch (err) {
        console.warn(`[discord-bot] failed to log to #${name}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }
  return sent;
}
