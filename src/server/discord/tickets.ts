import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
  type TextChannel,
} from "discord.js";
import { db } from "@/db";
import { discordTickets } from "@/db/schema";
import { and, desc, eq, ne } from "drizzle-orm";
import { getUserLicenseStatus } from "@/lib/license";
import { brandEmbed, BRAND, fullDate } from "./embeds";
import { botState } from "./state";
import { OWNER_DISCORD_IDS } from "./settings";
import { getLinkedUser, isAdminExecutor } from "./commands";

export const TICKET_CATEGORIES = [
  { value: "support", label: "Support", emoji: "🎧", description: "General help with the service" },
  { value: "billing", label: "Billing", emoji: "💳", description: "Payments, invoices and license keys" },
  { value: "bug", label: "Bug Report", emoji: "🐞", description: "Something is broken" },
];

const STAFF_ROLE_HINTS = ["staff", "support", "moderator", "mod", "helper", "admin"];

// ---------------------------------------------------------------------------
// Panel
// ---------------------------------------------------------------------------

export async function postTicketPanel(
  interaction: ChatInputCommandInteraction,
  siteUrl: string,
): Promise<void> {
  const channel = interaction.channel;
  if (!channel || channel.type !== ChannelType.GuildText) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Run this inside a server text channel", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const embed = brandEmbed({
    title: "Support Tickets",
    description:
      "Need a hand? Pick a category below and a private channel will open for you and the team.\nYour dashboard account details are attached automatically if your Discord is linked.",
    color: BRAND.emerald,
  });
  if (siteUrl) embed.addFields({ name: "Dashboard", value: siteUrl, inline: false });
  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ticket:open")
      .setPlaceholder("Select a category…")
      .addOptions(
        TICKET_CATEGORIES.map((c) => ({
          label: c.label,
          value: c.value,
          description: c.description,
          emoji: c.emoji,
        })),
      ),
  );
  await channel.send({ embeds: [embed], components: [row] });
  await interaction.reply({
    embeds: [brandEmbed({ title: "Ticket panel posted", color: BRAND.emerald })],
    flags: MessageFlags.Ephemeral,
  });
}

// ---------------------------------------------------------------------------
// Open a ticket
// ---------------------------------------------------------------------------

export async function openTicketFromSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply("Tickets only work inside a server.");
    return;
  }
  const category = TICKET_CATEGORIES.find((c) => c.value === interaction.values[0]) ?? TICKET_CATEGORIES[0];

  // One open ticket per user
  const [existing] = await db
    .select()
    .from(discordTickets)
    .where(
      and(
        eq(discordTickets.guildId, guild.id),
        eq(discordTickets.openerDiscordId, interaction.user.id),
        eq(discordTickets.status, "open"),
      ),
    )
    .orderBy(desc(discordTickets.createdAt))
    .limit(1);
  if (existing) {
    await interaction.editReply(`You already have an open ticket: <#${existing.channelId}>`);
    return;
  }

  // Tickets category (create on first use)
  let ticketsCategory = guild.channels.cache.find(
    (c) => c.type === ChannelType.GuildCategory && c.name.toLowerCase() === "tickets",
  );
  if (!ticketsCategory) {
    try {
      ticketsCategory = await guild.channels.create({ name: "Tickets", type: ChannelType.GuildCategory });
    } catch (err) {
      console.warn(`[discord-bot] could not create Tickets category: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Sequential ticket number
  const guildTickets = await db
    .select({ id: discordTickets.id })
    .from(discordTickets)
    .where(eq(discordTickets.guildId, guild.id));
  const number = String(guildTickets.length + 1).padStart(4, "0");
  const cleanUser = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 12) || "user";
  const channelName = `ticket-${number}-${cleanUser}`;

  // Permission overwrites: private to opener + staff, hidden from @everyone
  const staffRoles = guild.roles.cache.filter((r) =>
    STAFF_ROLE_HINTS.some((h) => r.name.toLowerCase().includes(h)),
  );
  try {
    const ticketChannel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: ticketsCategory?.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: interaction.user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles,
          ],
        },
        ...staffRoles.map((role) => ({
          id: role.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageMessages,
          ],
        })),
      ],
    });

    const linked = await getLinkedUser(interaction.user.id);
    await db.insert(discordTickets).values({
      guildId: guild.id,
      channelId: ticketChannel.id,
      openerDiscordId: interaction.user.id,
      webUserId: linked?.id ?? null,
      category: category.value,
      status: "open",
    });

    // Intro embed — auto-filled account details when the Discord is linked
    const embed = brandEmbed({
      title: `${category.emoji} ${category.label} ticket`,
      description: `Welcome <@${interaction.user.id}> — describe your issue and the team will be with you shortly.`,
      color: BRAND.emerald,
    });
    embed.addFields(
      { name: "Opened by", value: interaction.user.tag, inline: true },
      { name: "Category", value: category.label, inline: true },
    );
    if (linked) {
      const status = await getUserLicenseStatus(linked.id);
      embed.addFields(
        { name: "Dashboard account", value: linked.username, inline: true },
        {
          name: "License",
          value: status.hasActiveLicense
            ? `${status.usedSlots}/${status.totalSlots} slots used${
                status.nextExpiry ? ` · expires ${fullDate(status.nextExpiry)}` : ""
              }`
            : "none",
          inline: false,
        },
      );
    } else {
      embed.addFields({
        name: "Dashboard account",
        value: "not linked — log in on the website with Discord to link",
        inline: false,
      });
    }
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId("ticket:close").setLabel("Close").setEmoji("🔒").setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId("ticket:transcript").setLabel("Save Transcript").setEmoji("📋").setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId("ticket:claim").setLabel("Claim").setEmoji("✋").setStyle(ButtonStyle.Primary),
    );
    await ticketChannel.send({ content: `<@${interaction.user.id}>`, embeds: [embed], components: [row] });

    await interaction.editReply(`Ticket open: <#${ticketChannel.id}>`);
  } catch (err) {
    console.warn(`[discord-bot] ticket create failed: ${err instanceof Error ? err.message : err}`);
    await interaction.editReply(
      "Could not create the ticket channel — make sure the bot has Manage Channels and Manage Roles permissions.",
    );
  }
}

// ---------------------------------------------------------------------------
// Ticket buttons
// ---------------------------------------------------------------------------

async function getTicket(interaction: ButtonInteraction) {
  const [ticket] = await db
    .select()
    .from(discordTickets)
    .where(eq(discordTickets.channelId, interaction.channelId))
    .limit(1);
  return ticket ?? null;
}

async function isStaff(interaction: ButtonInteraction): Promise<boolean> {
  if (interaction.user.id === interaction.user.id && (await isAdminExecutor(interaction))) return true;
  const member = interaction.member as import("discord.js").GuildMember | null;
  const roles = member?.roles;
  if (roles && "cache" in roles && roles.cache) {
    const hasStaffRole = roles.cache.some((r) =>
      STAFF_ROLE_HINTS.some((h) => r.name.toLowerCase().includes(h)),
    );
    if (hasStaffRole) return true;
  }
  return false;
}

export async function handleTicketButton(interaction: ButtonInteraction): Promise<void> {
  const action = interaction.customId.split(":")[1];
  if (action === "close") return closeTicket(interaction);
  if (action === "transcript") return saveTranscript(interaction);
  if (action === "claim") return claimTicket(interaction);
}

async function closeTicket(interaction: ButtonInteraction): Promise<void> {
  const ticket = await getTicket(interaction);
  if (!ticket || ticket.status === "closed") {
    await interaction.reply({
      embeds: [brandEmbed({ title: "This ticket is already closed", color: BRAND.amber })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Opener or staff may close
  const staff = await isStaff(interaction);
  if (ticket.openerDiscordId !== interaction.user.id && !staff) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Only the opener or staff can close this ticket", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply();
  await db
    .update(discordTickets)
    .set({ status: "closed", closedAt: new Date() })
    .where(eq(discordTickets.id, ticket.id));
  const channel = interaction.channel;
  try {
    if (channel && "setName" in channel) {
      await channel.setName(`closed-${channel.name.replace(/^closed-/, "").slice(0, 90)}`);
    }
  } catch {}
  await interaction.editReply({
    embeds: [
      brandEmbed({
        title: "Ticket closed",
        description: `Closed by <@${interaction.user.id}>. This channel will be deleted in 30 seconds — save a transcript first if you need one.`,
        color: BRAND.rose,
      }),
    ],
  });
  setTimeout(() => {
    void (async () => {
      try {
        await channel?.delete();
      } catch {}
    })();
  }, 30_000);
}

async function saveTranscript(interaction: ButtonInteraction): Promise<void> {
  const staff = await isStaff(interaction);
  if (!staff) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Staff only", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const channel = interaction.channel as TextChannel | null;
  if (!channel) {
    await interaction.editReply("Channel unavailable.");
    return;
  }
  try {
    const collected = await channel.messages.fetch({ limit: 200 });
    const messages = [...collected.values()].reverse();
    const lines = messages.map((m) => {
      const time = m.createdAt.toISOString().replace("T", " ").slice(0, 19);
      const content = m.content || "(no text content)";
      return `[${time} UTC] ${m.author.tag}: ${content}`;
    });
    const header = `Transcript of #${channel.name} — generated ${new Date().toISOString()}\n${"=".repeat(60)}\n\n`;
    const note = botState().degraded
      ? "\nNOTE: Message Content Intent is disabled — message text may be missing. Enable it in the Discord Developer Portal for full transcripts.\n\n"
      : "\n";
    const file = new AttachmentBuilder(Buffer.from(header + note + lines.join("\n"), "utf-8"), {
      name: `transcript-${channel.name}.txt`,
    });
    await channel.send({
      embeds: [
        brandEmbed({
          title: "Transcript saved",
          description: `Saved by <@${interaction.user.id}> — ${messages.length} messages.`,
          color: BRAND.indigo,
        }),
      ],
      files: [file],
    });
    await interaction.editReply("Transcript saved to the channel.");
  } catch (err) {
    console.warn(`[discord-bot] transcript failed: ${err instanceof Error ? err.message : err}`);
    await interaction.editReply("Could not build the transcript — check my Read Message History permission.");
  }
}

async function claimTicket(interaction: ButtonInteraction): Promise<void> {
  const ticket = await getTicket(interaction);
  if (!ticket || ticket.status === "closed") {
    await interaction.reply({
      embeds: [brandEmbed({ title: "This ticket is closed", color: BRAND.amber })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  // Claim is reserved for the owner only.
  if (!OWNER_DISCORD_IDS.has(interaction.user.id)) {
    await interaction.reply({
      embeds: [brandEmbed({ title: "Owner only", description: "Only the server owner can claim tickets.", color: BRAND.rose })],
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  await db
    .update(discordTickets)
    .set({ status: "claimed", claimedByDiscordId: interaction.user.id })
    .where(eq(discordTickets.id, ticket.id));
  await interaction.reply({
    embeds: [
      brandEmbed({
        title: "Ticket claimed",
        description: `<@${interaction.user.id}> is handling this ticket.`,
        color: BRAND.emerald,
      }),
    ],
  });
}
