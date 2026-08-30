import { getCurrentUser } from "@/lib/auth";
import { db } from "@/db";
import { invoices, shopPlans } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { calculateLtcAmount, generateLtcInvoiceAddress, getOwnerLtcAddress, createDefaultPlansIfEmpty } from "@/lib/shop";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return Response.json({ error: "Unauthorized" }, { status: 401 });
  
  if (me.role === "admin") {
    const all = await db.select().from(invoices).orderBy(desc(invoices.createdAt)).limit(100);
    return Response.json({ invoices: all });
  } else {
    const mine = await db.select().from(invoices).where(eq(invoices.userId, me.id)).orderBy(desc(invoices.createdAt)).limit(50);
    return Response.json({ invoices: mine });
  }
}

export async function POST(req: Request) {
  const me = await getCurrentUser();
  if (!me) {
    return Response.json({ error: "Not logged in - please login properly" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { planId } = body;
    if (!planId) return Response.json({ error: "planId required" }, { status: 400 });

    await createDefaultPlansIfEmpty();
    const [plan] = await db.select().from(shopPlans).where(eq(shopPlans.id, planId));
    if (!plan || plan.active !== "true") {
      return Response.json({ error: "Plan not found or inactive" }, { status: 404 });
    }

    const finalPrice = Math.round(plan.price * (1 - plan.discount / 100) * 100) / 100;
    const { ltcAmount } = await calculateLtcAmount(finalPrice);
    const { address, privateKeyWif } = generateLtcInvoiceAddress();
    const ownerAddress = await getOwnerLtcAddress();

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 min expiry

    const [invoice] = await db.insert(invoices).values({
      userId: me.id,
      planId: plan.id,
      amountUSD: finalPrice,
      amountLTC: ltcAmount,
      ltcAddress: address,
      ltcPrivateKey: privateKeyWif,
      ownerLtcAddress: ownerAddress,
      status: "pending",
      expiresAt,
    }).returning();

    return Response.json({ 
      invoice: {
        id: invoice.id,
        planId: invoice.planId,
        amountUSD: invoice.amountUSD,
        amountLTC: invoice.amountLTC,
        ltcAddress: invoice.ltcAddress,
        ownerLtcAddress: invoice.ownerLtcAddress,
        status: invoice.status,
        expiresAt: invoice.expiresAt,
        createdAt: invoice.createdAt,
        tier: plan.tier,
        bots: plan.bots,
        hours: plan.hours,
      }
    });
  } catch (e) {
    console.error("Invoice create error", e);
    return Response.json({ error: e instanceof Error ? e.message : "Failed to create invoice" }, { status: 500 });
  }
}
