import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { brandEmbed, BRAND } from "./embeds";
import { bullets } from "./utils";

// Shared builder for the purchase panel — used both when the panel is posted
// (/purchase-panel) and when it auto-edits after website changes, so the two
// can never drift apart.

export type PanelPlan = {
  id: string;
  tier: string;
  price: number;
  bots: number;
  hours: number;
  features: string;
  popular: string;
  discount: number;
};

export function planFinalPrice(plan: PanelPlan): number {
  return plan.discount > 0 ? Math.round(plan.price * (1 - plan.discount / 100) * 100) / 100 : plan.price;
}

export function buildPurchasePanelPayload(
  plans: PanelPlan[],
  siteUrl: string,
): { embeds: ReturnType<typeof brandEmbed>[]; components: ActionRowBuilder<any>[] } {
  const embed = brandEmbed({
    title: "License Plans",
    description:
      "Pick a plan below to see the details, then grab your license — paid in LTC, key delivered instantly.",
    color: BRAND.emerald,
  });
  if (siteUrl) embed.addFields({ name: "Dashboard", value: siteUrl, inline: false });
  for (const plan of plans) {
    embed.addFields({
      name: `${plan.tier}${plan.popular === "true" ? " ⭐" : ""} — $${planFinalPrice(plan)}/mo`,
      value: `${plan.bots} bot slots · ${plan.hours}h/day runtime`,
      inline: false,
    });
  }

  const select = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("plan:buy")
      .setPlaceholder("Choose a plan to purchase…")
      .addOptions(
        plans.slice(0, 25).map((plan) => ({
          label: plan.tier.slice(0, 100),
          value: plan.id,
          description: `$${planFinalPrice(plan)}/mo · ${plan.bots} bots · ${plan.hours}h/day`.slice(0, 100),
          emoji: plan.popular === "true" ? "⭐" : undefined,
        })),
      ),
  );
  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [select];
  if (siteUrl) {
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setLabel("Buy License").setStyle(ButtonStyle.Link).setURL(`${siteUrl}/#shop`),
        new ButtonBuilder().setLabel("View Web Dashboard").setStyle(ButtonStyle.Link).setURL(siteUrl),
      ),
    );
  }
  return { embeds: [embed], components: rows };
}

/** Plan detail card shown when a buyer picks a plan from the dropdown. */
export function buildPlanDetailPayload(
  plan: PanelPlan,
  siteUrl: string,
): { embeds: ReturnType<typeof brandEmbed>[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  let features: string[] = [];
  try {
    features = JSON.parse(plan.features || "[]");
  } catch {}
  const embed = brandEmbed({
    title: `${plan.tier}${plan.popular === "true" ? " — most popular" : ""}`,
    description:
      (features.length > 0 ? bullets(features.slice(0, 8).join(",")) : `Run ${plan.bots} bots, ${plan.hours}h a day.`) +
      "\n\nPay with Litecoin — your license key is delivered instantly after payment.",
    color: plan.popular === "true" ? BRAND.violet : BRAND.emerald,
  });
  embed.addFields(
    { name: "Price", value: `$${planFinalPrice(plan)} / month`, inline: true },
    { name: "Bot slots", value: String(plan.bots), inline: true },
    { name: "Runtime", value: `${plan.hours}h / day`, inline: true },
  );
  const rows = siteUrl
    ? [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setLabel("Buy License").setStyle(ButtonStyle.Link).setURL(`${siteUrl}/#shop`),
        ),
      ]
    : [];
  return { embeds: [embed], components: rows };
}
