import { pgTable, text, timestamp, integer, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Discord account info (discordId is null for dev/guest accounts)
  discordId: text("discord_id"),
  username: text("username").notNull(),
  avatar: text("avatar"),
  // "user" | "admin"
  role: text("role").notNull().default("user"),
  // How many bots this user is allowed to create
  botSlots: integer("bot_slots").notNull().default(2),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const bots = pgTable("bots", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Owner of this bot
  userId: uuid("user_id"),
  // Friendly name for the bot (defaults to the resolved Minecraft username)
  name: text("name").notNull(),
  // Minecraft.net bearer / access token used to authenticate the session
  token: text("token").notNull(),
  // Resolved Minecraft account info (from the token)
  username: text("username"),
  uuid: text("uuid"),
  // Target server
  host: text("host").notNull(),
  port: integer("port").notNull().default(25565),
  // Pinned Minecraft version, or "auto" to let mineflayer detect it
  version: text("version").notNull().default("auto"),
  // Optional SOCKS proxy, e.g. "socks5://user:pass@host:1080" (empty = direct)
  proxy: text("proxy").notNull().default(""),
  // YouTube channel name the beam AI mentions when asked
  ytChannel: text("yt_channel").notNull().default("Alight.z"),
  // Server IP the beam AI shares with players who can't use discord
  beamIp: text("beam_ip").notNull().default("badlion-pvp.xyz"),
  // Discord username to hand out
  discordUser: text("discord_user").notNull().default("stood014"),
  // Bot Engine: "mineflayer" (Full UI) or "nmp" (Raw Protocol Bypass)
  engine: text("engine").notNull().default("azalea"),
  // Beam type: "ai" or "spam"
  beamType: text("beam_type").notNull().default("ai"),
  // Spam message
  spamMessage: text("spam_message").notNull().default("join my smp guys /msg me"),
  // Spam interval in ms
  spamInterval: integer("spam_interval").notNull().default(60000),
  // Spam trigger word
  spamTriggerWord: text("spam_trigger_word").notNull().default("123"),
  // Spam reply message
  spamReplyMessage: text("spam_reply_message").notNull().default("add my discord stood014 to join"),
  // Last known status: offline | connecting | online | error
  status: text("status").notNull().default("offline"),
  lastError: text("last_error"),
  // Whether the user wants this bot running (so it can auto-reconnect)
  enabled: text("enabled").notNull().default("false"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Global key/value app settings (e.g. ai_training flag, ai_learnings text).
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Saved beam conversations used for AI training/analysis.
export const beamConversations = pgTable("beam_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  botId: uuid("bot_id"),
  target: text("target"),
  outcome: text("outcome").notNull().default("unknown"),
  transcript: text("transcript").notNull().default("[]"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Bot = typeof bots.$inferSelect;
export type NewBot = typeof bots.$inferInsert;
export type AppSetting = typeof appSettings.$inferSelect;
export type BeamConversation = typeof beamConversations.$inferSelect;
