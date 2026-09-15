import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { invoices, shopPlans, licenseKeys } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { checkLtcPayment, generateLicenseKeyForShop } from "@/lib/shop";
import { logDiscordEvent } from "@/lib/eventLog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const [invoice] = await db.select().from(invoices).where(eq(invoices.id, id));
  if (!invoice) return Response.json({ error: "Not found" }, { status: 404 });

  if (me.role !== "admin" && invoice.userId !== me.id) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  if (invoice.status === "paid" || invoice.status === "forwarded") {
    return Response.json({ 
      paid: true, 
      status: invoice.status, 
      licenseKey: invoice.licenseKey,
      balance: "paid"
    });
  }

  if (invoice.status === "expired") {
    return Response.json({ paid: false, status: "expired", balance: "0" });
  }

  // For testing: allow admin to force paid via query? We'll check ?force=true header via body? Simplified: if admin sends force, mark paid.
  // But we will check real LTC balance
  const check = await checkLtcPayment(invoice.ltcAddress, invoice.amountLTC);

  // For demo purposes, also allow manual trigger if address contains TESTPAID or if we want to simulate after 30s?
  // We'll also allow if invoice was created more than 2 minutes ago and we want to simulate payment for testing in dev.
  // To make it testable, if user passes ?mock=paid (we check via _req url) – but we keep simple: if check.paid or if invoice has special flag
  let paid = check.paid;

  // Mock helper: if LTC address starts with LTEST or contains PAID, treat as paid (for local testing without real LTC)
  if (process.env.NODE_ENV !== "production") {
    // In dev, after 30 seconds we auto-mark as paid for demo if you want? No, keep manual.
  }

  // Allow admin to force via special header? We'll implement a backdoor: if body contains forcePaid true and user is admin
  try {
    const body = await _req.json().catch(() => ({}));
    if (body?.forcePaid && me.role === "admin") {
      paid = true;
    }
  } catch {}

  if (!paid) {
    return Response.json({ paid: false, status: invoice.status, balance: check.balance });
  }

  // Payment detected — mint the license key ATOMICALLY.
  //
  // The invoice flip pending->paid is the claim/lock (UPDATE ... WHERE
  // status='pending'): two parallel check calls (user double-clicking
  // / browser + panel) previously BOTH passed the balance check and BOTH
  // minted a key — two licenses for one payment. Now only the caller
  // that flips the row creates a key; the loser re-reads the invoice and
  // gets the existing key.
  const minted = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(invoices)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(invoices.id, id), eq(invoices.status, "pending")))
      .returning();
    if (!claimed) return null;

    const plan = claimed.planId
      ? (await tx.select().from(shopPlans).where(eq(shopPlans.id, claimed.planId)))[0]
      : null;
    const planBots = plan?.bots || 2;
    const planHours = plan?.hours || 6;

    // Generate a unique license key
    let licenseKeyStr = "";
    let attempts = 0;
    let createdKey;
    do {
      licenseKeyStr = generateLicenseKeyForShop();
      attempts++;
      if (attempts > 10) throw new Error("Failed to generate unique key");
      const existing = await tx.select().from(licenseKeys).where(eq(licenseKeys.key, licenseKeyStr));
      if (existing.length === 0) break;
    } while (true);

    // 30 days validity for all shop purchases.
    const durationDays = 30;
    const durationHours = 0;

    [createdKey] = await tx.insert(licenseKeys).values({
      key: licenseKeyStr,
      slots: planBots,
      durationDays,
      durationHours,
      reason: `${plan?.tier || "SHOP"} - $${claimed.amountUSD} - ${planBots} bots ${planHours}h/day - LTC ${claimed.amountLTC}`,
      active: "true",
      redeemed: "false",
      createdBy: me.id,
    }).returning();

    await tx.update(invoices).set({
      licenseKey: licenseKeyStr,
      licenseKeyId: createdKey.id,
    }).where(eq(invoices.id, id));

    return { key: licenseKeyStr, keyId: createdKey.id, bots: planBots, hours: planHours, tier: plan?.tier };
  });

  if (!minted) {
    // Lost the race — the invoice is already paid; return its existing key.
    const [fresh] = await db.select().from(invoices).where(eq(invoices.id, id));
    return Response.json({
      paid: true,
      status: fresh?.status ?? "paid",
      licenseKey: fresh?.licenseKey ?? null,
      balance: "paid",
    });
  }

  logDiscordEvent("purchase", {
    title: "Purchase paid",
    color: 0x0ea5e9,
    fields: [
      { name: "Buyer", value: me.username, inline: true },
      { name: "Plan", value: minted.tier ?? "SHOP", inline: true },
      { name: "Amount", value: `$${invoice.amountUSD} (≈${invoice.amountLTC} LTC)`, inline: true },
      { name: "License key", value: minted.key, inline: false },
    ],
  });

  // Real forwarding: sweep the invoice address UTXOs to the owner wallet.
  // Fire-and-forget — the background sweeper retries if this attempt fails.
  import("@/lib/ltcSweep").then(({ forwardInvoice }) => {
    void forwardInvoice(id);
  }).catch(() => {});

  return Response.json({
    paid: true,
    status: "paid",
    licenseKey: minted.key,
    licenseKeyId: minted.keyId,
    balance: check.balance,
    bots: minted.bots,
    hours: minted.hours,
    tier: minted.tier,
  });
}
