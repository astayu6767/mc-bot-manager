import { pgTable, text, timestamp, integer, uuid, doublePrecision } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Discord account info (discordId is null for dev/guest accounts)
  discordId: text("discord_id"),
  username: text("username").notNull(),
  avatar: text("avatar"),
  // "user" | "admin"
  role: text("role").notNull().default("user"),
  // How many bots this user is allowed to create - starts at 0, needs license
  botSlots: integer("bot_slots").notNull().default(0),
  // Password auth (local accounts)
  passwordHash: text("password_hash").notNull().default(""),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Licenses table - admin can give license with slots and duration (days/hours)
export const licenses = pgTable("licenses", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  // How many bot slots this license grants
  slots: integer("slots").notNull().default(1),
  // Duration
  durationDays: integer("duration_days").notNull().default(0),
  durationHours: integer("duration_hours").notNull().default(0),
  // Calculated expiration
  expiresAt: timestamp("expires_at").notNull(),
  // Status
  active: text("active").notNull().default("true"),
  // Reason / note
  reason: text("reason").notNull().default(""),
  // Original redeemable key if this came from a key
  licenseKey: text("license_key").notNull().default(""),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Redeemable license keys - admin generates keys like abeam-key-xxxx, user redeems
export const licenseKeys = pgTable("license_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  slots: integer("slots").notNull().default(1),
  durationDays: integer("duration_days").notNull().default(0),
  durationHours: integer("duration_hours").notNull().default(0),
  reason: text("reason").notNull().default(""),
  active: text("active").notNull().default("true"),
  redeemed: text("redeemed").notNull().default("false"),
  redeemedBy: uuid("redeemed_by").references(() => users.id),
  redeemedAt: timestamp("redeemed_at"),
  createdBy: uuid("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Shop plans - admin manageable, 3 plans $5 $8 $15 etc
export const shopPlans = pgTable("shop_plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  tier: text("tier").notNull(), // e.g. STARTER, PRO, ENTERPRISE
  // USD dollars — decimal (NOT integer) so discounted/custom prices like
  // 7.76 don't blow up invoice inserts
  price: doublePrecision("price").notNull(),
  bots: integer("bots").notNull().default(1),
  hours: integer("hours").notNull().default(5),
  features: text("features").notNull().default("[]"), // JSON array string
  popular: text("popular").notNull().default("false"),
  active: text("active").notNull().default("true"),
  discount: integer("discount").notNull().default(0), // percent 0-100
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Invoices for LTC payments
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").references(() => shopPlans.id, { onDelete: "set null" }),
  // USD — decimal so discounted totals (e.g. 7.76) insert cleanly
  amountUSD: doublePrecision("amount_usd").notNull(),
  amountLTC: text("amount_ltc").notNull(), // e.g. "0.2004008"
  ltcAddress: text("ltc_address").notNull(),
  ltcPrivateKey: text("ltc_private_key").notNull().default(""), // WIF for sweeping (mock)
  ownerLtcAddress: text("owner_ltc_address").notNull().default(""),
  status: text("status").notNull().default("pending"), // pending | paid | expired | forwarded
  licenseKey: text("license_key").notNull().default(""),
  licenseKeyId: uuid("license_key_id").references(() => licenseKeys.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
  expiresAt: timestamp("expires_at").notNull(),
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
  // Bot Engine: "azalea" (Rust vanilla client) | "mineflayer" | "nmp"
  engine: text("engine").notNull().default("azalea"),
  // Beam type: "ai" | "spam" | "lobby" (lobby = anti-AFK trigger-word mode,
  // reuses the spam_* settings columns below)
  beamType: text("beam_type").notNull().default("ai"),
  // Spam message
  spamMessage: text("spam_message").notNull().default("join my smp guys /msg me"),
  // Spam interval in ms
  spamInterval: integer("spam_interval").notNull().default(60000),
  // Spam trigger word
  spamTriggerWord: text("spam_trigger_word").notNull().default("123"),
  // Spam reply message
  spamReplyMessage: text("spam_reply_message").notNull().default("add my discord stood014 to join"),
  // AI-beam opener script: one message per line (1-5). Empty = spin between built-in defaults.
  openerScript: text("opener_script").notNull().default(""),
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
export type License = typeof licenses.$inferSelect;
export type NewLicense = typeof licenses.$inferInsert;
export type LicenseKey = typeof licenseKeys.$inferSelect;
export type NewLicenseKey = typeof licenseKeys.$inferInsert;
export type ShopPlan = typeof shopPlans.$inferSelect;
export type NewShopPlan = typeof shopPlans.$inferInsert;
export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;
