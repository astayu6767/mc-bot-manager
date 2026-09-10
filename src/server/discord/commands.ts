import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type Interaction,
  type RESTPostAPIApplicationCommandsJSONBody,
  type StringSelectMenuInteraction,
} from "discord.js";
import { db } from "@/db";
import { bots, shopPlans, users } from "@/db/schema";
import { asc, eq } from "drizzle-orm";
import { getUserLicenseStatus, redeemLicenseKey, createLicenseKey } from "@/lib/license";
import { logDiscordEvent } from "@/lib/eventLog";
import { brandEmbed, BRAND, fullDate, relative } from "./embeds";
import { bullets, parseDuration, smoothChannelName } from "./utils";
import { getSiteUrl } from "./settings";
import { buildPlanDetailPayload, buildPurchasePanelPayload } from "./purchasePanel";
import { savePanelRef } from "./panels";
import { botState } from "./state";
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
    new SlashCommandBuilder()
      .setName("purge")
      .setDescription("Bulk delete recent messages (admin only)")
      .addIntegerOption((o) => o.setName("amount").setDescription("How many messages to delete (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption((o) => o.setName("user").setDescription("Only delete messages from this user"))
      .addStringOption((o) => o.setName("contains").setDescription("Only delete messages containing this text").setMaxLength(200))
      .addBooleanOption((o) => o.setName("bots").setDescription("Only delete messages sent by bots")),
    new SlashCommandBuilder().setName("bots").setDescription("List your bots with their online/offline status"),
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
    } else if (interaction.isStringSelectMenu() && interaction.customId === "plan:buy") {
      await handlePlanSelect(interaction);
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
    case "purge":
      return cmdPurge(interaction);
    case "bots":
      return cmdBots(interaction);
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
  const { embeds, components } = buildPurchasePanelPayload(plans, siteUrl);
  const sent = await target.send({ embeds, components });
  // Track the message so it auto-edits whenever plans change on the website.
  await savePanelRef(target.guild.id, target.id, sent.id);
  await interaction.reply({
    embeds: [brandEmbed({ title: "Purchase panel posted", color: BRAND.emerald })],
    flags: MessageFlags.Ephemeral,
  });
}

async function handlePlanSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const planId = interaction.values[0];
  const [plan] = await db.select().from(shopPlans).where(eq(shopPlans.id, planId));
  if (!plan || plan.active !== "true") {
    await interaction.editReply("That plan is no longer available.");
    return;
  }
  const siteUrl = await getSiteUrl();
  const { embeds, components } = buildPlanDetailPayload(plan, siteUrl);
  await interaction.editReply({ embeds, components });
}

async function cmdSetupLogs(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const guild = interaction.guild;
  if (!guild) return;
  const botId = interaction.client.user?.id;
  const staffRoles = guild.roles.cache.filter((r) =>
    ["staff", "support", "moderator", "mod", "helper", "admin"].some((h) => r.name.toLowerCase().includes(h)),
  );
  // Log channels are staff-only: @everyone loses view access; the person who
  // ran the command, staff roles and the bot keep full access.
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages,
      ],
    },
    ...(botId
      ? [
          {
            id: botId,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ]
      : []),
    ...staffRoles.map((role) => ({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
      ],
    })),
  ];

  const wanted = ["logs-signups", "logs-purchases", "logs-bots", "logs-errors"];
  const created: string[] = [];
  const locked: string[] = [];
  const failed: string[] = [];
  for (const name of wanted) {
    const existing = guild.channels.cache.find(
      (c) => c.name === name && c.type === ChannelType.GuildText,
    ) as import("discord.js").TextChannel | undefined;
    if (existing) {
      // Retro-lock channels created before the privacy fix.
      try {
        await existing.permissionOverwrites.set(overwrites);
        locked.push(`#${name}`);
      } catch (err) {
        console.warn(`[discord-bot] could not lock #${name}: ${err instanceof Error ? err.message : err}`);
        failed.push(`#${name}`);
      }
      continue;
    }
    try {
      await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        permissionOverwrites: overwrites,
      });
      created.push(`#${name}`);
    } catch (err) {
      console.warn(`[discord-bot] could not create #${name}: ${err instanceof Error ? err.message : err}`);
      failed.push(`#${name}`);
    }
  }
  const embed = brandEmbed({
    title: "Log channels ready",
    description:
      "These channels are private — only you, staff roles and the bot can see them. Website events flow in while the bot is online.",
    color: BRAND.emerald,
  });
  embed.addFields(
    { name: "Created", value: created.length > 0 ? created.map((c) => `- ${c}`).join("\n") : "—", inline: true },
    { name: "Locked (already existed)", value: locked.length > 0 ? locked.map((c) => `- ${c}`).join("\n") : "—", inline: true },
    { name: "Failed", value: failed.length > 0 ? failed.map((c) => `- ${c}`).join("\n") : "—", inline: true },
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


// ---------------------------------------------------------------------------
// /purge — Carl-bot style bulk delete
// ---------------------------------------------------------------------------

async function cmdPurge(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!(await isAdminExecutor(interaction))) return replyDenied(interaction);
  const channel = interaction.guild?.channels.cache.get(interaction.channelId);
  if (!interaction.inGuild() || !channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Run this inside a server text channel", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const member = interaction.member as import("discord.js").GuildMember | null;
  if (!member?.permissions?.has(PermissionFlagsBits.ManageMessages)) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Missing permission", description: "You need the **Manage Messages** permission to purge.", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const amount = interaction.options.getInteger("amount", true);
  const user = interaction.options.getUser("user");
  const contains = interaction.options.getString("contains")?.toLowerCase().trim();
  const onlyBots = interaction.options.getBoolean("bots") ?? false;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const collected = await channel.messages.fetch({ limit: 100 });
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // bulk delete only works < 14 days
    let skippedOld = 0;
    let skippedFilter = 0;
    const deletable: string[] = [];
    for (const m of [...collected.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp)) {
      if (deletable.length >= amount) break;
      if (m.pinned) {
        skippedFilter++;
        continue;
      }
      if (m.createdTimestamp < cutoff) {
        skippedOld++;
        continue;
      }
      if (user && m.author.id !== user.id) {
        skippedFilter++;
        continue;
      }
      if (onlyBots && !m.author.bot) {
        skippedFilter++;
        continue;
      }
      if (contains && !m.content.toLowerCase().includes(contains)) {
        skippedFilter++;
        continue;
      }
      deletable.push(m.id);
    }

    if (deletable.length === 0) {
      await interaction.editReply("Nothing matched — messages are older than 14 days, pinned, or no filter matched.");
      return;
    }
    await channel.bulkDelete(deletable, true);
    const notes: string[] = [];
    if (skippedOld > 0) notes.push(`${skippedOld} skipped (older than 14 days — Discord won't bulk-delete those)`);
    if (skippedFilter > 0) notes.push(`${skippedFilter} skipped by filters/pinned`);
    const state = botState();
    if (contains && state.degraded) notes.push("heads-up: Message Content Intent is off, so text filtering may have missed messages");
    const filters = [
      user ? `user: ${user.tag}` : null,
      contains ? `contains: "${contains}"` : null,
      onlyBots ? "bots only" : null,
    ].filter(Boolean);

    const embed = brandEmbed({
      title: "Purge complete",
      description: `Deleted **${deletable.length}** message${deletable.length === 1 ? "" : "s"}${filters.length > 0 ? ` (${filters.join(" · ")})` : ""}.`,
      color: BRAND.emerald,
    });
    if (notes.length > 0) embed.addFields({ name: "Notes", value: notes.join("\n"), inline: false });
    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    console.warn(`[discord-bot] purge failed: ${err instanceof Error ? err.message : err}`);
    await interaction.editReply(
      "Purge failed — I need the **Manage Messages** permission and access to this channel's history.",
    );
  }
}

// ---------------------------------------------------------------------------
// /bots — list your bots + status
// ---------------------------------------------------------------------------

const BOT_STATUS_META: Record<string, { emoji: string; label: string }> = {
  online: { emoji: "🟢", label: "online" },
  connecting: { emoji: "🟡", label: "connecting" },
  error: { emoji: "🔴", label: "error" },
  offline: { emoji: "⚫", label: "offline" },
};

async function cmdBots(interaction: ChatInputCommandInteraction): Promise<void> {
  const linked = await getLinkedUser(interaction.user.id);
  if (!linked) {
    await interaction.reply({
      embeds: [
        brandEmbed({
          title: "No linked account",
          description:
            "Log in on the website using **Login with Discord** with this same account first — then /bots shows your dashboard bots.",
          color: BRAND.amber,
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const myBots = await db
    .select()
    .from(bots)
    .where(eq(bots.userId, linked.id))
    .orderBy(asc(bots.createdAt));
  const status = await getUserLicenseStatus(linked.id);
  const siteUrl = await getSiteUrl();

  const embed = brandEmbed({
    title: "Your bots",
    description:
      myBots.length === 0
        ? "No bots yet — create one from the dashboard."
        : `**${myBots.length}** bot${myBots.length === 1 ? "" : "s"} · ${status.usedSlots}/${status.totalSlots} slots used`,
    color: myBots.length > 0 ? BRAND.emerald : BRAND.slate,
  });
  embed.setAuthor({ name: linked.username, iconURL: interaction.user.displayAvatarURL() });
  if (myBots.length > 0) {
    const lines = myBots.slice(0, 25).map((b) => {
      const meta = BOT_STATUS_META[b.status] ?? BOT_STATUS_META.offline;
      return `${meta.emoji} **${b.name}** — ${meta.label}`;
    });
    embed.addFields({ name: "Bots", value: lines.join("\n"), inline: false });
  }
  const rows = siteUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Open Dashboard").setStyle(ButtonStyle.Link).setURL(siteUrl),
        ),
      ]
    : [];
  await interaction.reply({ embeds: [embed], components: rows, flags: MessageFlags.Ephemeral });
}
