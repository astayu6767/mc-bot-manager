import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type RESTPostAPIApplicationCommandsJSONBody,
} from "discord.js";
import { db } from "@/db";
import { shopPlans, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getUserLicenseStatus, redeemLicenseKey, createLicenseKey } from "@/lib/license";
import { logDiscordEvent } from "@/lib/eventLog";
import { brandEmbed, BRAND, bullets, fullDate, relative } from "./embeds";
import { getSiteUrl } from "./settings";
import { openTicketFromSelect, postTicketPanel, handleTicketButton } from "./tickets";

// ---------------------------------------------------------------------------
// Permissions & helpers
// ---------------------------------------------------------------------------

/** Find the website account linked to a Discord user (null if not linked). */
export async function getLinkedUser(discordId: string) {
  const [linked] = await db.select().from(users).where(eq(users.discordId, discordId));
  return linked ?? null;
}

/**
 * Owner/admin gate for privileged commands: guild owner, Administrator
 * permission, the configured ADMIN_DISCORD_ID, or a linked website admin.
 */
export async function isAdminExecutor(interaction: Interaction): Promise<boolean> {
  const guild = interaction.guild;
  if (!guild) return false;
  if (guild.ownerId === interaction.user.id) return true;
  const member = interaction.member;
  if (member && "permissions" in member) {
    const perms = member.permissions as import("discord.js").PermissionsBitField;
    if (perms && typeof perms !== "string" && perms.has(PermissionFlagsBits.Administrator)) return true;
  }
  const adminEnvId = process.env.ADMIN_DISCORD_ID || "";
  if (adminEnvId && interaction.user.id === adminEnvId) return true;
  try {
    const linked = await getLinkedUser(interaction.user.id);
    if (linked?.role === "admin") return true;
  } catch {}
  return false;
}

/** Parse "30d", "12h", "7d12h" or a bare number (days). */
export function parseDuration(input: string): { days: number; hours: number } | null {
  const s = input.trim().toLowerCase();
  if (/^\d+$/.test(s)) return { days: parseInt(s, 10), hours: 0 };
  const m = s.match(/^(?:(\d+)\s*d)?\s*(?:(\d+)\s*h)?$/);
  if (!m) return null;
  const days = m[1] ? parseInt(m[1], 10) : 0;
  const hours = m[2] ? parseInt(m[2], 10) : 0;
  if (days === 0 && hours === 0) return null;
  return { days, hours };
}

// ---------------------------------------------------------------------------
// Smooth channel renamer — emoji + normalized kebab name
// ---------------------------------------------------------------------------

const CHANNEL_EMOJI_RULES: [RegExp, string][] = [
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

export function smoothChannelName(current: string): string {
  // Strip leading emojis/symbols, keep the words
  let name = current.replace(/^[^a-z0-9]+/, "");
  name = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (!name) name = "channel";
  const emoji = CHANNEL_EMOJI_RULES.find(([re]) => re.test(name))?.[1] ?? "✨";
  return `${emoji}-${name}`;
}

// ---------------------------------------------------------------------------
// Command definitions
// ---------------------------------------------------------------------------

export function getCommandBuilders(): RESTPostAPIApplicationCommandsJSONBody[] {
  const commands = [
    new SlashCommandBuilder()
      .setName("ticket-panel")
      .setDescription("Post the support ticket panel in this channel"),
    new SlashCommandBuilder().setName("license").setDescription("Show your active license, tier, quota and expiry"),
    new SlashCommandBuilder()
      .setName("redeem")
      .setDescription("Redeem a license key — syncs instantly with your web dashboard")
      .addStringOption((o) => o.setName("key").setDescription("License key, e.g. abeam-key-xxxx").setRequired(true)),
    new SlashCommandBuilder()
      .setName("admin-generate-license")
      .setDescription("Generate a redeemable license key (admin only)")
      .addStringOption((o) => o.setName("tier").setDescription("Tier label, e.g. STARTER, PRO").setRequired(true))
      .addStringOption((o) =>
        o.setName("duration").setDescription("Duration: 30d, 12h, 7d12h (bare number = days)").setRequired(true),
      )
      .addIntegerOption((o) => o.setName("slots").setDescription("Bot slots the key grants").setMinValue(1)),
    new SlashCommandBuilder()
      .setName("announce")
      .setDescription("Post a clean announcement embed (admin only)")
      .addStringOption((o) => o.setName("title").setDescription("Announcement title").setRequired(true).setMaxLength(200))
      .addStringOption((o) => o.setName("message").setDescription("Announcement body").setRequired(true).setMaxLength(2000))
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to post in (default: here)").addChannelTypes(ChannelType.GuildText),
      ),
    new SlashCommandBuilder()
      .setName("changelog")
      .setDescription("Post a versioned changelog embed (admin only)")
      .addStringOption((o) => o.setName("version").setDescription("Version, e.g. v1.2.0").setRequired(true))
      .addStringOption((o) => o.setName("added").setDescription("Comma-separated list of additions").setRequired(true).setMaxLength(1000))
      .addStringOption((o) => o.setName("fixed").setDescription("Comma-separated list of fixes").setMaxLength(1000))
      .addStringOption((o) => o.setName("improved").setDescription("Comma-separated list of improvements").setMaxLength(1000))
      .addChannelOption((o) =>
        o.setName("channel").setDescription("Channel to post in (default: here)").addChannelTypes(ChannelType.GuildText),
      ),
    new SlashCommandBuilder().setName("purchase-panel").setDescription("Post the plan showcase embed with a Buy License button (admin only)"),
    new SlashCommandBuilder().setName("setup-logs").setDescription("Create the logs-signups/purchases/bots/errors channels (admin only)"),
    new SlashCommandBuilder().setName("rename-smooth-channel").setDescription("Rename this channel to a clean emoji-prefixed name (admin only)"),
  ];
  return commands.map((c) => c.toJSON());
}

/** Register slash commands for one guild (instant — no global delay). */
export async function syncCommandsToGuild(client: import("discord.js").Client, guildId: string): Promise<void> {
  try {
    await client.application?.commands.set(getCommandBuilders(), guildId);
  } catch (err) {
    console.warn(`[discord-bot] command sync failed for guild ${guildId}: ${err instanceof Error ? err.message : err}`);
  }
}

// ---------------------------------------------------------------------------
// Interaction dispatch
// ---------------------------------------------------------------------------

export async function handleInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
    } else if (interaction.isStringSelectMenu() && interaction.customId === "ticket:open") {
      await openTicketFromSelect(interaction);
    } else if (interaction.isButton() && interaction.customId.startsWith("ticket:")) {
      await handleTicketButton(interaction);
    }
  } catch (err) {
    console.warn(`[discord-bot] interaction failed: ${err instanceof Error ? err.message : err}`);
    try {
      if (interaction.isRepliable()) {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: "Something went wrong — try again in a moment.", flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: "Something went wrong — try again in a moment.", flags: MessageFlags.Ephemeral });
        }
      }
    } catch {}
  }
}

async function handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  switch (interaction.commandName) {
    case "ticket-panel":
      return cmdTicketPanel(interaction);
    case "license":
      return cmdLicense(interaction);
    case "redeem":
      return cmdRedeem(interaction);
    case "admin-generate-license":
      return cmdGenerateLicense(interaction);
    case "announce":
      return cmdAnnounce(interaction);
    case "changelog":
      return cmdChangelog(interaction);
    case "purchase-panel":
      return cmdPurchasePanel(interaction);
    case "setup-logs":
      return cmdSetupLogs(interaction);
    case "rename-smooth-channel":
      return cmdRenameSmooth(interaction);
    default:
      await interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral });
  }
}

function denyEmbed(): ReturnType<typeof brandEmbed> {
  return brandEmbed({
    title: "Not allowed",
    description: "You don't have permission to use this command.",
    color: BRAND.rose,
  });
}

async function replyDenied(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.reply({ embeds: [denyEmbed()], flags: MessageFlags.Ephemeral });
}

// ---------------------------------------------------------------------------
// Command implementations
// ---------------------------------------------------------------------------

async function cmdTicketPanel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const siteUrl = await getSiteUrl();
  await postTicketPanel(interaction, siteUrl);
}

async function cmdLicense(interaction: ChatInputCommandInteraction): Promise<void> {
  const linked = await getLinkedUser(interaction.user.id);
  if (!linked) {
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "No linked account",
          description:
            "Your Discord isn't linked to the dashboard yet.\nLog in on the website using **Login with Discord** with this same account, then run `/license` again.",
          color: BRAND.amber,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const status = await getUserLicenseStatus(linked.id);
  const embed = brandEmbed({
    title: "Your license",
    description: status.hasActiveLicense
      ? `Active — **${status.availableSlots}** of **${status.totalSlots}** bot slots free.`
      : "No active license. Redeem a key with `/redeem` or grab one from the shop.",
    color: status.hasActiveLicense ? BRAND.emerald : BRAND.slate,
  });
  embed.setAuthor({ name: linked.username, iconURL: interaction.user.displayAvatarURL() });
  embed.addFields(
    { name: "Quota", value: `${status.usedSlots} / ${status.totalSlots} slots used`, inline: true },
    {
      name: "Expires",
      value: status.nextExpiry ? `${relative(status.nextExpiry)}\n${fullDate(status.nextExpiry)}` : "—",
      inline: true },
  );
  if (status.activeLicenses.length > 0) {
    const lines = status.activeLicenses
      .slice(0, 5)
      .map((l) => `\`${l.slots} slots\` · ${l.timeLeft}${l.reason ? ` · ${l.reason}` : ""}`);
    embed.addFields({ name: "Active grants", value: lines.join("\n") });
  }
  const siteUrl = await getSiteUrl();
  const rows = siteUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Renew Now").setStyle(ButtonStyle.Link).setURL(`${siteUrl}/#shop`),
          new ButtonBuilder().setLabel("Open Dashboard").setStyle(ButtonStyle.Link).setURL(siteUrl),
        ),
      ]
    : [];
  await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
}

async function cmdRedeem(interaction: ChatInputCommandInteraction): Promise<void> {
  const linked = await getLinkedUser(interaction.user.id);
  if (!linked) {
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "No linked account",
          description:
            "Log in on the website using **Login with Discord** with this same account first — then `/redeem` syncs straight to your dashboard.",
          color: BRAND.amber,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const key = interaction.options.getString("key", true).trim();
  try {
    const license = await redeemLicenseKey(linked.id, key);
    logDiscordEvent("purchase", {
      title: "License redeemed",
      description: `<@${interaction.user.id}> redeemed a key in Discord.`,
      color: BRAND.emerald,
      fields: [
        { name: "User", value: linked.username, inline: true },
        { name: "Slots", value: String(license.slots), inline: true },
        { name: "Expires", value: relative(license.expiresAt), inline: true },
      ],
    });
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "License activated",
          description: `**${license.slots}** bot slots added — synced to your dashboard instantly.`,
          color: BRAND.emerald,
        }).addFields(
          { name: "Expires", value: `${relative(license.expiresAt)}\n${fullDate(license.expiresAt)}`, inline: true },
          { name: "Quota now", value: `${license.slots} slots`, inline: true },
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "Redeem failed",
          description: err instanceof Error ? err.message : "Failed to redeem key.",
          color: BRAND.rose,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function cmdGenerateLicense(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const tier = interaction.options.getString("tier", true).trim().slice(0, 40);
  const durationStr = interaction.options.getString("duration", true);
  const slots = interaction.options.getInteger("slots") ?? 1;
  const parsed = parseDuration(durationStr);
  if (!parsed) {
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "Bad duration",
          description: 'Use formats like `30d`, `12h` or `7d12h` (a bare number means days).',
          color: BRAND.rose,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  try {
    const linked = await getLinkedUser(interaction.user.id);
    const created = await createLicenseKey({
      slots,
      durationDays: parsed.days,
      durationHours: parsed.hours,
      reason: `Tier: ${tier}`,
      createdBy: linked?.id,
    });
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "License key generated",
          description: `Share this with the buyer — they redeem it in Discord with \`/redeem\` or on the website.`,
          color: BRAND.emerald,
        }).addFields(
          { name: "Key", value: `\`${created.key}\`` },
          { name: "Tier", value: tier, inline: true },
          { name: "Slots", value: String(slots), inline: true },
          { name: "Duration", value: `${parsed.days}d ${parsed.hours}h`, inline: true },
        ),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "Generate failed",
          description: err instanceof Error ? err.message : "Failed to generate key.",
          color: BRAND.rose,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function cmdAnnounce(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const title = interaction.options.getString("title", true);
  const message = interaction.options.getString("message", true);
  const picked = interaction.options.getChannel("channel");
  const target = interaction.guild?.channels.cache.get(picked?.id ?? interaction.channelId);
  if (!target || target.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Pick a text channel", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const siteUrl = await getSiteUrl();
  const embed = brandEmbed({ title, description: message, color: BRAND.indigo });
  const rows = siteUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("View Web Dashboard").setStyle(ButtonStyle.Link).setURL(siteUrl),
        ),
      ]
    : [];
  await target.send({ embeds: [embed], components: rows });
  await interaction.reply({
    embeds: [brandEmbed({ title: "Announcement posted", description: `Sent to <#${target.id}>.`, color: BRAND.emerald })],
    flags: MessageFlags.Ephemeral,
  });
}

async function cmdChangelog(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const version = interaction.options.getString("version", true).trim().slice(0, 30);
  const added = interaction.options.getString("added", true);
  const fixed = interaction.options.getString("fixed");
  const improved = interaction.options.getString("improved");
  const picked = interaction.options.getChannel("channel");
  const target = interaction.guild?.channels.cache.get(picked?.id ?? interaction.channelId);
  if (!target || target.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Pick a text channel", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const divider = "───────────────────";
  let description = `**${version}** · <t:${Math.floor(Date.now() / 1000)}:D>\n${divider}\n\n**Added**\n${bullets(added)}`;
  if (fixed) description += `\n\n${divider}\n\n**Fixed**\n${bullets(fixed)}`;
  if (improved) description += `\n\n${divider}\n\n**Improved**\n${bullets(improved)}`;

  const embed = brandEmbed({ title: "Changelog", description, color: BRAND.indigo });
  const siteUrl = await getSiteUrl();
  const rows = siteUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Full Notes").setStyle(ButtonStyle.Link).setURL(siteUrl),
        ),
      ]
    : [];
  await target.send({ embeds: [embed], components: rows });
  await interaction.reply({
    embeds: [brandEmbed({ title: "Changelog posted", description: `Sent to <#${target.id}>.`, color: BRAND.emerald })],
    flags: MessageFlags.Ephemeral,
  });
}

async function cmdPurchasePanel(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const plans = (await db.select().from(shopPlans).where(eq(shopPlans.active, "true"))).sort(
    (a, b) => a.price - b.price,
  );
  if (plans.length === 0) {
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "No plans yet",
          description: "Add plans in the admin panel (Shop Management) first.",
          color: BRAND.amber,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const target = interaction.guild?.channels.cache.get(interaction.channelId);
  if (!target || target.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Run this inside a server text channel", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const siteUrl = await getSiteUrl();
  const embeds = plans.map((plan) => {
    const features: string[] = JSON.parse(plan.features || "[]");
    const finalPrice = plan.discount > 0
      ? Math.round(plan.price * (1 - plan.discount / 100) * 100) / 100
      : plan.price;
    const embed = brandEmbed({
      title: `${plan.tier}${plan.popular === "true" ? " — most popular" : ""}`,
      color: plan.popular === "true" ? BRAND.violet : BRAND.emerald,
    });
    embed.setDescription(
      features.length > 0 ? bullets(features.slice(0, 6).join(",")) : `Run ${plan.bots} bots, ${plan.hours}h a day.`,
    );
    embed.addFields(
      { name: "Price", value: `$${finalPrice} / month`, inline: true },
      { name: "Bot slots", value: String(plan.bots), inline: true },
      { name: "Runtime", value: `${plan.hours}h / day`, inline: true },
    );
    return embed;
  });
  const rows = siteUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Buy License").setStyle(ButtonStyle.Link).setURL(`${siteUrl}/#shop`),
          new ButtonBuilder().setLabel("View Web Dashboard").setStyle(ButtonStyle.Link).setURL(siteUrl),
        ),
      ]
    : [];
  await target.send({ embeds, components: rows });
  await interaction.reply({
    embeds: [brandEmbed({ title: "Purchase panel posted", color: BRAND.emerald })],
    flags: MessageFlags.Ephemeral,
  });
}

async function cmdSetupLogs(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const guild = interaction.guild;
  if (!guild) return;
  const wanted = ["logs-signups", "logs-purchases", "logs-bots", "logs-errors"];
  const created: string[] = [];
  const skipped: string[] = [];
  for (const name of wanted) {
    const exists = guild.channels.cache.some((c) => c.name === name);
    if (exists) {
      skipped.push(`#${name}`);
      continue;
    }
    try {
      await guild.channels.create({ name, type: ChannelType.GuildText });
      created.push(`#${name}`);
    } catch (err) {
      console.warn(`[discord-bot] could not create #${name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  const embed = brandEmbed({
    title: "Log channels ready",
    color: BRAND.emerald,
  });
  embed.setDescription(
    [
      created.length > 0 ? `**Created**\n${created.map((c) => `- ${c}`).join("\n")}` : "",
      skipped.length > 0 ? `**Already exist**\n${skipped.map((c) => `- ${c}`).join("\n")}` : "",
      "\nWebsite events now flow into these channels while the bot is online.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function cmdRenameSmooth(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const channel = interaction.guild?.channels.cache.get(interaction.channelId);
  if (!interaction.inGuild() || !channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Run this inside a server text channel", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const oldName = channel.name;
  const newName = smoothChannelName(oldName);
  if (newName === oldName) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Already smooth", description: `\`${oldName}\` is good to go.`, color: BRAND.emerald })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  try {
    await channel.setName(newName, `Smooth rename by ${interaction.user.tag}`);
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "Channel renamed",
          description: `\`${oldName}\` → **${newName}**`,
          color: BRAND.emerald,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "Rename failed",
          description: /rate limit/i.test(msg)
            ? "Discord limits channel renames to 2 per 10 minutes — try again shortly."
            : msg,
          color: BRAND.rose,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  }
}
